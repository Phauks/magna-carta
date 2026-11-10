# Foundational data & runtime conventions — design

**Status:** Accepted (design) · **Date:** 2026-06-04 · **Owner:** Trevor Goldsmith
**White-paper home:** _Foundational data & runtime conventions_ (§9.3–§9.7)
**ADRs:** ADR-0061 (money) · ADR-0062 (identifiers) · ADR-0063 (idempotency) · ADR-0064 (transactional outbox) · ADR-0065 (schema migration & fleet)

This spec is the implementation-grade detail for five cross-cutting conventions decided in the white paper's _Foundational data & runtime conventions_ section. It does not restate the rationale (that lives in the white paper and the ADRs above) — it specifies data models, interfaces, flows, edge cases, and the test plan. The two already-settled members of §9 — the time model (ADR-0055) and durability on close (ADR-0057) — are out of scope here.

These five interlock: identifiers (0062) supply the UNIQUE-insert idiom that idempotency (0063) and the outbox (0064) rely on; idempotency + outbox give effectively-once effects; the fleet model (0065) is how every table below is migrated across firms. They are foundational and expensive to retrofit, so they are built in Phase 0 alongside the ledger core and the fixtures harness.

---

## 1. Money & currency (ADR-0061)

### 1.1 Storage

Two integer scales in D1, both `INTEGER` (SQLite 64-bit signed, ±~$92 quadrillion at cents):

| Kind                                                                       | Scale                 | Column convention                                                         | Example               |
| -------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- | --------------------- |
| Amount (balance, ledger posting, invoice-line total, payment, trust entry) | 2dp (cents)           | `*_minor INTEGER`                                                         | `45000` = $450.00     |
| Rate / unit price (hourly rate, expense unit cost)                         | 4dp (ten-thousandths) | `*_rate_e4 INTEGER`                                                       | `4500000` = $450.0000 |
| Currency                                                                   | —                     | `currency TEXT` (ISO-4217), on the ledger account or standalone money row | `'USD'`               |

- Ledger accounts are single-currency; a posting inherits its account's currency. No FX rate table, no revaluation.
- **Forbidden:** `REAL`/float money columns; storing an amount at 4dp; storing a rate at 2dp. A fitness function (§1.5) rejects these in CI by inspecting the Drizzle schema.

### 1.2 TS types

```ts
// Branded, immutable. Backed by Dinero.js v2 (Dinero<bigint>) internally.
type Money = { readonly __brand: "Money" /* dinero<bigint> @ scale 2 + currency */ };
type Rate = { readonly __brand: "Rate" /* dinero<bigint> @ scale 4 + currency */ };
type Ratio = {
  readonly __brand: "Ratio" /* dimensionless decimal, e.g. tax/interest/contingency % */;
};
```

The in-house `money` module is the only surface the app/DAL uses; Dinero is never imported directly outside it (swappable-seam discipline, enforced by a dependency-boundary fitness function).

> **Amendment (2026-06-08, ADR-0061):** the in-memory representation is `Dinero<number>` (Dinero's default **number** calculator, JS safe-integer amounts), **not** `Dinero<bigint>`. Amounts never approach 2^53 ($90T at cents / $900B at a 4-dp rate) in legal practice management, so number arithmetic is exact across our range; and dinero 2.0.2's bigint build is broken for `multiply`/`transformScale`/`allocate`/`toDecimal`. Storage is unchanged (`*_minor`/`*_rate_e4` `INTEGER`). The seam makes a future swap to a `decimal.js` custom calculator (arbitrary precision, verified working) a one-file change if amounts ever exceed 2^53.

**Operations** (all immutable, currency-checked — mixing currencies throws):
`money(minor, currency)` · `rate(e4, currency)` · `add` · `subtract` · `multiplyByQuantity(money, qty)` · `percentOf(money, ratio)` · `allocate(money, weights[]) → Money[]` (largest-remainder) · the named rounding helpers (§1.3) · `format(money) → string` (`Intl.NumberFormat`, explicit currency) · `toMinor`/`fromMinor` (DB boundary).

`Rate × quantity` (e.g. hourly rate × hours, unit cost × units) produces a high-precision intermediate (Dinero `transformScale`), rounded to `Money` (2dp) **only** at the invoice-line boundary.

### 1.3 Rounding — named boundary helpers

No global default. The mode is encoded by intent:

| Helper                      | Mode                 | Boundary                                                                                           |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `roundTax(amount)`          | half-up              | sales/use tax (SSUTA §324, Nevada is a member)                                                     |
| `roundInvoiceLine(amount)`  | half-away-from-zero  | invoice line totals (symmetric: a credit/discount line rounds to the same magnitude as the charge) |
| `roundLedger(amount)`       | banker's (half-even) | GL / financial-statement aggregation (GAAP, bias-free)                                             |
| `allocate(amount, weights)` | largest-remainder    | splits: contingency client/fee/cost/lien, payment application                                      |

- Raw `round(amount, mode)` requires an explicit `mode` (no default). A fitness function flags raw `round` calls outside the named helpers.
- Rounding happens only at these boundaries, never mid-calculation.

### 1.4 Key flows / edge cases

- **Contingency settlement statement:** gross recovery → `allocate` across [client, fee, cost-reimbursement, lien] weights → parts sum exactly to gross (no penny drift).
- **Payment application:** a payment `allocate`d across multiple open invoices, remainder distributed largest-remainder.
- **Tax on a taxable cost:** `percentOf(cost, taxRatio)` → `roundTax`. Item-vs-invoice basis is a per-jurisdiction setting (the tax engine, out of scope here) but always uses `roundTax`.
- **Rate change mid-matter:** rates are effective-dated (ADR-0033); each line resolves the rate in force on its date, stored at 4dp.

### 1.5 Enforcement

- Fitness function: no float arithmetic on money; no `REAL` money columns; rounding only via named helpers; Dinero imported only inside `money`.
- Fixtures (ADR-0034) construct all money through `money`/`rate`.

---

## 2. Identifiers (ADR-0062)

### 2.1 Format

`<prefix>_<token>` where `token` is a CSPRNG-random, URL-safe (nanoid alphabet `A-Za-z0-9_-`) string sized to ~126 bits (21 chars). Examples: `mat_V1StGXR8Z5jdHiopq2Cf`, `doc_8Kf3pQ2vN7mB4xR1Lw0Yt`.

- **Random, never time-encoded** (no UUIDv7/ULID/Snowflake).
- The handle is both the **D1 primary key** (`TEXT PRIMARY KEY`) and the public id in URLs/API/logs.
- Foreign keys store the referenced row's handle directly (no translation layer).

### 2.2 Prefix registry

A declarative table (registry-first, ADR-0051) mapping entity type → prefix → branded TS type:

| Entity                                  | Prefix  | Brand           |
| --------------------------------------- | ------- | --------------- |
| Matter                                  | `mat_`  | `MatterId`      |
| Document                                | `doc_`  | `DocumentId`    |
| Directory entity                        | `dir_`  | `DirectoryId`   |
| Invoice                                 | `inv_`  | `InvoiceId`     |
| Calendar event                          | `evt_`  | `EventId`       |
| Portal grant                            | `pgr_`  | `PortalGrantId` |
| Ledger entry                            | `led_`  | `LedgerEntryId` |
| Outbox message                          | `obx_`  | `OutboxId`      |
| Idempotency key (server-side record id) | `idr_`  | —               |
| User (control-plane, global)            | `usr_`  | `UserId`        |
| Firm (control-plane, global)            | `firm_` | `FirmId`        |

New entity types add a registry row; a conformance test asserts every persisted entity has a registered prefix and brand.

### 2.3 Generation

```ts
function newId<T extends EntityType>(type: T, rng: Rng = cryptoRng): BrandFor<T> { … }
```

- `cryptoRng` = `crypto.getRandomValues` (Workers-available). Fixtures inject a **seeded PRNG** (ADR-0034) so ids are byte-deterministic.
- Insert path: `INSERT … ON CONFLICT(id) DO NOTHING` style — on the (astronomically rare) collision, regenerate and retry (bounded retries, then error). The `UNIQUE` PK makes non-overlap a correctness guarantee.

### 2.4 Branded types

Branded string types per entity; the compiler rejects passing a `DocumentId` where a `MatterId` is expected. Brands are erased at runtime (the value is just the string), so they cost nothing on the wire.

### 2.5 Cross-database references

Per-firm rows referencing a global principal (e.g. `member.user_id`, `audit.actor_user_id`) store the control-plane `usr_`/`firm_` handle — handles cross DB boundaries where integer keys cannot. The matter **number** (ADR-0052) is a separate human/mutable alias column with redirect aliasing, never a key or FK target.

---

## 3. Idempotency (ADR-0063)

### 3.1 Table (per-firm D1)

```
idempotency_key(
  id            TEXT PRIMARY KEY,         -- idr_ handle (server record id)
  key           TEXT NOT NULL,            -- client-supplied Idempotency-Key
  fingerprint   TEXT NOT NULL,            -- hash(method + path + canonical body)
  status        TEXT NOT NULL,            -- 'in_progress' | 'completed'
  response_code INTEGER,                  -- captured on completion
  response_body TEXT,                     -- captured on completion (redacted per ADR-0038 rules)
  created_at    TEXT NOT NULL,            -- instant, ADR-0055
  UNIQUE(key)
)
```

Scope is the firm (the table lives in per-firm D1). The fingerprint includes the endpoint, so reusing one key across endpoints trips the mismatch path.

### 3.2 Middleware flow (mutation path)

1. If the route is `idempotency: optional` and no header present → proceed without a record.
2. Compute `fingerprint`. Attempt to **insert** `(key, fingerprint, status='in_progress')` **inside the same D1 transaction** that will perform the effect.
   - **Insert succeeds** → execute the handler; on completion, update the row to `completed` + captured response; commit. Return the response.
   - **Insert fails (UNIQUE)** → read the existing row:
     - `completed` + same fingerprint → **replay** stored response (do not execute).
     - `in_progress` + same fingerprint → **409** (a request with this key is running).
     - any status + **different fingerprint** → **422** (key reused for a different payload).

The UNIQUE insert _is_ the concurrency guard; no separate lock. Because the record and the effect share one D1 transaction, a crash between effect and record-write cannot leave them inconsistent.

### 3.3 Route metadata & enforcement

Each mutating route declares `idempotency: 'required' | 'optional'` in its OpenAPI/route metadata (ADR-0022). A conformance fitness function (ADR-0051) asserts every money/trust/payment/outbound-communication route is `required`.

### 3.4 Lifecycle & external pass-through

- TTL ~24h; a Cron job purges expired rows (ephemeral dedup state, not the record of truth).
- For payments, the same key (or a deterministic derivative) is passed to the processor (Helcim/Stripe honor `Idempotency-Key`), so the external charge dedups too. Reliable _outbound_ delivery is the outbox (§4).

### 3.5 Edge cases

- **Failure responses are stored too** — a retried operation that first failed replays the failure, never silently re-runs.
- **Body canonicalization** before hashing (stable key order) so semantically-identical bodies share a fingerprint.
- **Large bodies:** fingerprint is a hash, not the body; response capture respects the redaction allowlist (ADR-0038) — never store privileged content.

---

## 4. Transactional outbox (ADR-0064)

### 4.1 Table (per-firm D1)

```
outbox(
  id            TEXT PRIMARY KEY,         -- obx_ handle
  topic         TEXT NOT NULL,            -- e.g. 'payment.capture', 'comms.send', 'conflicts.recheck'
  payload       TEXT NOT NULL,            -- JSON, IDs + non-privileged fields only
  aggregate_key TEXT,                     -- for ordered topics (e.g. a matter/ledger id)
  seq           INTEGER,                  -- monotonic within aggregate_key
  status        TEXT NOT NULL,            -- 'pending' | 'dispatched' | 'failed'
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  dispatched_at TEXT
)
```

### 4.2 Write

The business change, the audit row, **and** the `outbox` row commit in **one D1 transaction**. The effect is recorded iff the change commits.

### 4.3 Relay

- **Floor (correctness):** a Cron-triggered Workflow sweeps each firm's `outbox WHERE status='pending'` and publishes to Cloudflare Queues, marking rows `dispatched` (the ADR-0050 cross-firm fan-out).
- **Latency seam:** after commit, the request pokes a per-firm relay Durable Object (alarm-driven) to drain immediately. Best-effort — correctness never depends on the poke; the sweep is the guarantee. Ship the sweep first (ADR-0039 measure-first).

### 4.4 Consumers

Queue-consumer Workers perform the real effect (payment capture, comms ports ADR-0047, conflicts re-check ADR-0013, search-index/projection updates) **idempotently**:

- Dedup on the outbox `id` (reuse the §3 idempotency record or a consumer-side processed-set).
- Queues are **at-least-once + unordered** → ordering-sensitive topics apply by `aggregate_key` + `seq` (skip stale / last-write-wins).
- Max attempts → **dead-letter** queue, surfaced to observability (ADR-0038).

### 4.5 Chokepoint & boundary

A handler that wrote to D1 must not enqueue/call-external directly — it goes through the outbox. A boundary fitness function fails CI on a handler that both writes D1 and directly calls a Queue/fetch to an external service. Exception: independent async work whose **job row is its own state** (e.g. a user-triggered conversion) may enqueue directly.

### 4.6 Sagas (multi-step)

Charge → post-to-ledger → send-receipt composes as a **saga via Workflows** with compensating actions, built on the outbox + idempotency primitives. Defined as a composition pattern; not built until a concrete flow needs it (YAGNI).

---

## 5. Schema migration & the database fleet (ADR-0065)

### 5.1 Tooling

- **Drizzle ORM** schemas in TS are the single source of truth for the DAL's generated types **and** for migrations (`drizzle-kit generate` from schema diffs). Two lineages: `control-plane` and `per-firm`, versioned independently.
- Drizzle sits **under** the firm-scoped DAL; the DAL still owns firm-scoping, `protected()`, audit, outbox, and idempotency.

### 5.2 Version tracking

- Each per-firm D1 carries a `_migrations` table (applied migration ids).
- The control-plane firm registry mirrors each firm's current schema version (one column on the existing registry row) → fleet-wide visibility.

### 5.3 Rollout orchestrator

A Cron-triggered Workflow (the shared fleet-fan-out primitive — backups ADR-0050, outbox relay §4):

1. List firms from the registry, filter to those below the target schema version.
2. Fan out with **bounded concurrency**; per firm, apply pending migrations in a transaction, update `_migrations` + the registry version.
3. **Failure isolation:** a firm that fails is quarantined + alerted (ADR-0038); the fleet continues.
4. **Idempotent/resumable:** re-running skips already-current firms.
5. Emit a migration-state report.

- **Eager:** active firms migrate in the fan-out.
- **Lazy:** dormant firms catch up on next access — the DAL checks the firm's version on connect and applies pending migrations before serving. (Seam over the eager floor.)
- **Control-plane migrations apply first** (single DB, separate lineage).
- **Provisioning:** a new firm's DB is created and brought to the current schema (runner's "v0 → apply all").

### 5.4 Expand-contract discipline

Every migration is backward-compatible with currently-deployed code. Order:

1. **Expand** — additive migration (new nullable column / new table), deployed first.
2. **Deploy** code that tolerates both old and new schema.
3. **Backfill** — populate new structures.
4. **Contract** — remove the old structure, after all code/firms are off it.

A fitness function flags a destructive change (DROP COLUMN, NOT-NULL-without-default, type narrowing) shipped in the same release as the code that needs it.

### 5.5 Safety nets

- Per-DB **Time Travel** (ADR-0050) = instant PITR if a migration corrupts one firm.
- Migrations tested against the **load-profile fixtures** (ADR-0034) and dry-run in CI.
- Restore drills (ADR-0050) exercise the import path.
- Built now: single-firm exercises the runner as a fleet of one.

---

## 6. Test plan

- **Money:** property tests — `allocate` always sums to the input; `add`/`subtract` associativity; round-trip `toMinor`/`fromMinor`; named-rounding tables (half-up tax, half-even GL); differential test a sample of operations against `decimal.js` to validate the Dinero wrapper. Scenario fixtures: contingency split, multi-invoice payment application, tax on a cost.
- **Identifiers:** generator collision-retry under a forced-collision RNG; brand-type negative compile tests (a `DocumentId` rejected where `MatterId` expected); fixtures determinism (same seed → same ids); prefix-registry conformance test.
- **Idempotency:** concurrent duplicate requests (one executes, one replays); replay returns identical stored response incl. failures; mismatched fingerprint → 422; in-progress → 409; crash-between-effect-and-record leaves them consistent (single-transaction property); TTL purge.
- **Outbox:** business-write rollback also rolls back the outbox row (atomicity); relay publishes exactly the pending set; consumer idempotency under redelivery; dead-letter after max attempts; ordered-topic skip-stale.
- **Fleet:** orchestrator skips current firms; isolates a failing firm; resumes after interruption; expand-contract migration applied with old+new code tolerant; lazy catch-up on a dormant firm; provisioning a fresh firm to current schema.

All test data flows through the write-path fixtures (ADR-0034), never raw inserts.

---

## 7. Implementation structure (slice 0·2 build)

The five conventions are realized as **four workspace packages**, split on the seam between _defining_ the data and _safely reaching_ it. Names are fully spelled out (golden rule 12, [`code-style.md`](../conventions/code-style.md)) — no `db`/`dal`/`ids` shorthand.

| Package                    | Plain-English purpose                     | Contents                                                                                             | Depends on                         |
| -------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `@magna-carta/money`       | All monetary math                         | `Money`/`Rate`/`Ratio` types, named rounding helpers, `allocate`, `format`; Dinero wrapped here only | — (Dinero.js)                      |
| `@magna-carta/identifiers` | How every row is named                    | identifier generator, prefix registry, branded identifier types, seeded random source for fixtures   | — (nanoid)                         |
| `@magna-carta/database`    | How the database is **defined & evolved** | Drizzle schemas (control-plane + per-firm), migration runner, fleet rollout orchestrator             | `identifiers`                      |
| `@magna-carta/data-access` | How the database is **safely reached**    | idempotency middleware, transactional outbox + relay; later: firm-scoping, `protected()`, audit      | `database`, `identifiers`, `money` |

**Why this seam, not others.** `money` and `identifiers` are pure leaves (no Cloudflare runtime, repo-dependency-free) → clean package edges, fast plain-Vitest tests, and a hard Dinero boundary enforced at module resolution. `database` (structure) and `data-access` (access) split on a genuine acyclic seam. Idempotency and outbox are **not** split into their own packages: they are mutually entangled through the shared D1 transaction (idempotency inserts inside the effect's transaction; outbox consumers reuse the idempotency record), so separate packages would force a circular dependency. They live together in `data-access`, separated by strict internal module boundaries + the §1.5/§3.3/§4.5 fitness functions instead. Dependency graph is strictly acyclic: `data-access → database → identifiers`, `data-access → money`.

**Build order (one vertical slice per package, each its own commit with tests + doc updates):**

1. `money` — pure, self-contained; establishes the package pattern. Property tests + differential test vs `decimal.js`.
2. `identifiers` — pure; generator + prefix-registry conformance + brand negative-compile tests + fixture determinism.
3. `database` — schemas + migration runner + fleet orchestrator ("a fleet of one" for now); expand-contract guard.
4. `data-access` — idempotency middleware, then transactional outbox + relay; idempotency-required + outbox-chokepoint fitness functions.

Each slice ships its fitness functions alongside the code they guard. The package-layout decision is recorded as an ADR in the same commit as slice 1 (golden rule 8).

## 8. Open items deferred to build

- Per-tier intervals/limits (idempotency TTL exact value, outbox sweep cadence, relay-DO alarm interval, migration concurrency bound) — the conventions bind now; the numbers arrive with the code (same intentional seam as ADR-0039).
- The Dinero-vs-in-house re-evaluation trigger (if ledger math moves to Rust→WASM per ADR-0024/0039) — the `money` seam makes this a wrapper swap.
- Saga catalog — written when the first multi-step external flow is built.
