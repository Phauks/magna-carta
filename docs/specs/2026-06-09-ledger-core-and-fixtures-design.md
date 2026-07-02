# Append-only ledger core + fixtures harness — design (slice 0·3)

**Status:** Approved design, pre-implementation. **Decides:** ADR-0072. **Builds on:** ADR-0008 (append-only double-entry ledger), ADR-0061 (money), ADR-0062 (identifiers), ADR-0063/0064 as amended (single-`batch()` write path), ADR-0065 (migrations), ADR-0071 (package layout), ADR-0034 + white paper _Synthetic data & fixtures_ (fixtures), ADR-0055 (time model). **Prepares for:** ADR-0009 (no-negative trust, Phase 3), Phase 3 Financial Core.

The double-entry ledger as a domain module behind the firm-scoped data-access layer — append-only, balanced entries, corrections as new reversing entries, never edits — plus the deterministic fixtures harness whose factories call the ledger's real write paths. The first real consumer of the slice 0·2 primitives.

## 1. Schema (per-firm lineage, `@magna-carta/database`)

Four tables join `per-firm-schema.ts`. All primary keys are identifier handles (ADR-0062); all money columns are integer minor units (ADR-0061); all instants/dates are ISO-8601 TEXT (ADR-0055).

### 1.1 `ledger_account` — the structural account model

The full structural shape, no chart-of-accounts product (no CRUD UI/API, no numbering scheme — Phase 3 adds the product layer on this unchanged schema).

| column              | type                                                        | notes                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | TEXT PK, `acct_` handle                                     | new registry prefix `ledgerAccount: "acct"`                                                                                                                      |
| `name`              | TEXT NOT NULL                                               |                                                                                                                                                                  |
| `type`              | TEXT NOT NULL, enum `asset/liability/equity/income/expense` | normal balance is **derived in code** (asset/expense = debit-normal; liability/equity/income = credit-normal) — never a column (one home per fact)               |
| `currency`          | TEXT NOT NULL, ISO-4217                                     | always `USD` now; accounts are single-currency, lines inherit (ADR-0061)                                                                                         |
| `parent_account_id` | TEXT NULL, self-FK                                          | the subledger seam — "Dana Smith's trust ledger" is a child of Client Trust Liability; a child must share its parent's `type` and `currency` (service-validated) |
| `active`            | INTEGER NOT NULL DEFAULT 1                                  | soft close; accounts are never deleted (append-only discipline extends to the account dimension)                                                                 |
| `created_at`        | TEXT NOT NULL, UTC instant                                  |                                                                                                                                                                  |

### 1.2 `ledger_entry` — the transaction header

| column              | type                                          | notes                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                | TEXT PK, `led_` handle                        | prefix already registered                                                                                                                                                                                          |
| `description`       | TEXT NOT NULL                                 | non-empty (service-validated; CHECK `length(description) > 0` backs it)                                                                                                                                            |
| `effective_date`    | TEXT NOT NULL, `YYYY-MM-DD`                   | the bookkeeping fact — what statements/reconciliation key off; backdating allowed, future-dating refused (§3.3); a bare civil date per ADR-0055 — **no zone column**, zone resolution is a caller/boundary concern |
| `recorded_at`       | TEXT NOT NULL, UTC instant                    | when the row was posted — system-set, immutable, the audit truth; the gap between the two dates is itself audit signal                                                                                             |
| `reverses_entry_id` | TEXT NULL, FK → `ledger_entry.id`, **UNIQUE** | first-class correction link; UNIQUE makes double-reversal structurally impossible even under a concurrent race (the loser's batch rolls back)                                                                      |

An entry's reversed/active status is **derived from the link** — never a mutated flag. No UPDATE ever touches this table.

### 1.3 `ledger_line` — the money

Encoding: **direction + always-positive amount** (the Modern Treasury shape). Chosen over signed single-column and two-column debit/credit because it structurally eliminates the silent sign-flip — the bug class where a flipped sign still balances and nothing catches it. Direction must be _stated_ as data; negative/zero lines are impossible at the schema.

| column         | type                                             | notes                                                         |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `id`           | TEXT PK, `lln_` handle                           | new registry prefix `ledgerLine: "lln"`                       |
| `entry_id`     | TEXT NOT NULL, FK → `ledger_entry.id`            |                                                               |
| `account_id`   | TEXT NOT NULL, FK → `ledger_account.id`          | leaf accounts only (service-validated, §3.3)                  |
| `line_index`   | INTEGER NOT NULL                                 | stable display/export order; UNIQUE(`entry_id`, `line_index`) |
| `direction`    | TEXT NOT NULL, enum `debit/credit`               |                                                               |
| `amount_minor` | INTEGER NOT NULL, **CHECK (`amount_minor` > 0)** | 2dp minor units (ADR-0061); currency inherited from account   |

No currency column on the line: ADR-0061 fixes "accounts single-currency, postings inherit," and §3.3 enforces one currency per entry, so the account's tag is authoritative.

**Balance rule (the invariant of ADR-0008):** for every entry, `SUM(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END) = 0`, with ≥ 2 lines. Enforced in the service before composition; re-verified table-wide by a fitness query (§6).

### 1.4 `account_balance` — materialized balance + the bounds seam

One row per account, **created in the same batch as the account**. Balances are stored in **normal-balance terms** (positive = normal: a healthy trust liability reads positive), so bounds read the way trust rules, bank statements, and auditors state them.

| column              | type                              | notes                                                  |
| ------------------- | --------------------------------- | ------------------------------------------------------ |
| `account_id`        | TEXT PK, FK → `ledger_account.id` |                                                        |
| `balance_minor`     | INTEGER NOT NULL DEFAULT 0        | normal-balance terms                                   |
| `min_balance_minor` | INTEGER NULL                      | NULL = unbounded; trust sets `0` in Phase 3 (ADR-0009) |
| `max_balance_minor` | INTEGER NULL                      | NULL = unbounded                                       |
| `updated_at`        | TEXT NOT NULL, UTC instant        |                                                        |

**CHECK constraint — the enforcement mechanism:**

```sql
CHECK ((min_balance_minor IS NULL OR balance_minor >= min_balance_minor)
   AND (max_balance_minor IS NULL OR balance_minor <= max_balance_minor))
```

D1 has no interactive transactions; a failed CHECK inside the posting batch is the **only** mechanism that aborts the whole transaction on a business condition. Every posting batch carries one `UPDATE account_balance SET balance_minor = balance_minor + :delta, updated_at = :now WHERE account_id = :id` per touched account (delta in normal-balance terms: `+amount` when the line's direction matches the account's normal balance, else `-amount`). When Phase 3 sets a trust child's `min_balance_minor = 0`, an overdrawing disbursement violates the CHECK → the entire batch (idempotency record, entry, lines, balances, outbox) rolls back. Zero retrofit of the write path.

Materializing now (rather than derive-by-SUM until trust needs it) was chosen deliberately: the alternative changes the shape of every posting batch in Phase 3, right when the stakes are highest. Cost: the balance row is derived state — a fitness query proves `SUM(lines) = balance` (§6).

## 2. Domain module — `@magna-carta/ledger`

The first **domain package**, establishing the pattern later domains (matters, billing, trust) follow. Dependencies (acyclic, per ADR-0070/0071 exports-map discipline): `ledger → data-access → database → identifiers`, `ledger → money`.

Placement rationale: ledger invariants are domain rules; `data-access` stays the generic safe-access layer. Schema stays in `database` (structure vs. access vs. domain — three seams).

### 2.1 `postEntry`

The posting service validates **in memory**, then **composes statements** — it runs no logic mid-transaction (D1 single-`batch()` reality, ADR-0063/0064 amendments). It plugs into the slice 0·2 chokepoint as an effect producer for `composeEffectBatch` / `runIdempotentEffect`.

Input: `{ description, effectiveDate, lines: [{ accountId, direction, amount: Money }, …] }` plus the injected clock (§5.1) and account snapshot. Flow:

1. Validate (§3.3) against loaded account rows.
2. Mint ids client-side (`led_`, `lln_` — ADR-0062 makes up-front batch binding possible).
3. Compose, in order: `INSERT ledger_entry` → `INSERT ledger_line` ×N → `UPDATE account_balance` per touched account → outbox row `ledger.entry.posted` (payload: `{ entryId }` — ids only, ADR-0038).
4. The idempotent runner wraps it: `[INSERT completed idempotency record, …the above]`, one atomic `batch()`.

### 2.2 `reverseEntry`

`reverseEntry({ entryId, description, effectiveDate })`: loads the original, refuses if it doesn't exist or is already reversed (polite pre-check; the UNIQUE on `reverses_entry_id` catches the concurrent race — the loser's batch rolls back), then composes the exact mirror entry (same lines, directions flipped, same amounts) with `reverses_entry_id` set, through the same batch path. Balance updates are the mirror's own — no special casing.

The Phase 3 adjustment workflow (reverse + repost as one operation, replacement links, correction-reason taxonomy) composes on these primitives — `reverseEntry` + `postEntry` in one batch plus an additive nullable column later; zero retrofit.

### 2.3 `createAccount`

`createAccount({ name, type, currency, parentAccountId? })`: validates (parent exists, shares type + currency), composes `[INSERT ledger_account, INSERT account_balance (0, unbounded)]` through the same idempotent path. Closing an account is a later state-change service; no delete exists. A parent that already carries postings is refused (`parent-has-postings`) — the creation-side half of the leaf-only invariant, closing the sequential hole where an account posts first and gains children later.

## 3. Invariants & validation

### 3.1 Scoping principle

Slice 0·3 enforces **what makes the ledger a ledger**; consumer rules (trust, billing, GL) arrive with their consumers and plug into seams that already exist (bounds columns, `effective_date`, the reversal link).

### 3.2 Schema-level (CHECKs — hold even against future buggy callers)

- `amount_minor > 0`; `direction IN ('debit','credit')`.
- Balance bounds CHECK (§1.4) — the batch-abort mechanism.
- `reverses_entry_id` UNIQUE — no double reversal.
- `length(description) > 0`.

### 3.3 Service-level (validated before composition)

- **Balanced entry, ≥ 2 lines** — the definition of double-entry.
- **Single currency per entry** — can't fire while USD-only, but it's what makes "sum to zero" meaningful; one comparison.
- **Accounts exist and are active.**
- **Leaf accounts only** — an account with children takes no postings; a parent's balance is a roll-up. Forbidden from the first row because retrofitting after mixed data exists is miserable.
- **Effective date sane** — valid ISO calendar date; backdating allowed by design; **no future-dating** beyond "today" resolved against the injected clock (a ledger records what happened; scheduled transactions are a Phase 3+ workflow concern).
- **Non-empty description** — the difference between an audit trail and a number pile.
- **Reversal targets** an existing, un-reversed entry.

### 3.4 Deferred, with named landing spots

- **No-negative trust** (ADR-0009): mechanism ships now; no account gets bounds until Phase 3 trust sets them per jurisdiction profile.
- **Period close** ("no posting into closed months"): Phase 3 GL; `effective_date` is the seam.
- **Account-type posting warnings** ("income normally isn't debited"): warnings not invariants — correcting entries legitimately violate them; UI/reporting, later.
- **Account closing service, CoA product, multi-currency** (column present, no FX — ADR-0061).

## 4. Time model

Both date fields are ISO-8601 TEXT — different subsets by **kind** (ADR-0055): `effective_date` is a calendar date (`2026-06-27`), `recorded_at` a UTC instant (`2026-07-01T16:42:09Z`). The civil date is never widened to a timestamp: a timestamp drags in a zone, and then a check "dated June 27" renders June 26 or 28 depending on the viewer. Both sort lexicographically (statement-period range queries are plain TEXT comparisons). The service takes an injected clock (`now(): Temporal.Instant`) — production passes the real clock; fixtures pass the fixed clock; the future-dating rule and `recorded_at` both resolve against it.

## 5. Fixtures harness — `@magna-carta/fixtures`

**The rule (white paper _Synthetic data & fixtures_):** fixtures call real domain write-paths, never raw inserts — valid by construction, doubling as integration coverage of those write paths.

**The canonical write path is the domain service, not HTTP.** Factories call `postEntry`/`reverseEntry`/`createAccount` directly against a local D1 (Miniflare / `node:sqlite` per the established test pattern) — the same validation, the same `composeEffectBatch`, the same statements. When the API arrives (slice 0·5), factories do **not** migrate to HTTP; the domain service remains the canonical write path forever and HTTP is one caller of it.

### 5.1 `FixtureContext` — one seed carries all determinism

Built from a single seed; same seed → byte-identical database (and that property is itself a regression test: re-run, diff rows). _Amended 2026-06-10 (post-build review):_ byte-identical **excepting outbox row ids** — they are minted unseeded inside `@magna-carta/data-access` (`insertOutboxMessageStatement` exposes no `randomSource` seam, deliberately: widening a data-access API for a fixtures-only nicety was rejected); the determinism test compares outbox rows without `id`, and the exception is documented in the fixtures package `CLAUDE.md`. Holds the three nondeterminism sources the white paper bans:

- **Seeded faker** — names, descriptions.
- **Fixed clock** — starts at an anchor instant, advances only when scenarios explicitly move it (entries get distinct, reproducible `recorded_at`s; `effective_date`s derive from it). Wall-clock time is banned.
- **Seeded identifier source** — `seededRandomSource` from `@magna-carta/identifiers` (the slice 0·2 seam, first consumer).

### 5.2 Layered factories

- **Primitive factories** — `anAccount()`, `aBalancedEntry()`: small, parameterized, plausible single objects.
- **Named scenarios** — short stories told through real service calls **with assertions baked in**, doubling as write-path integration tests:
  - `retainerDeposit` — clean two-line posting.
  - `trustCorrection` — post + first-class reversal; asserts the link and mirrored balances.
  - `boundsRejection` — sets a min bound, attempts an overdraw, **asserts the whole batch failed** (the §1.4 mechanism, proven).
  - `multiLineSettlement` — a balanced N-line entry exercising allocation.
- **Demo-firm bundle** — `seedDemoFirm()`: the demo chart of accounts plus ~a dozen entries telling a coherent story (deposits, a disbursement, one correction).

### 5.3 Demo chart of accounts — boundary

A tiny (10–15 account) small-law-firm CoA lives in the fixtures package, **explicitly marked demo data**: Operating Bank, Trust Bank (IOLTA), Client Trust Liability (+ demo client children), A/R, Fee Income, expense buckets. It is _not_ a Phase 3 product CoA template and must not quietly become one — the product CoA gets designed in Phase 3.

### 5.4 Production guard

Seeding entry points take an explicit opt-in (e.g. `{ allowSeeding: true }` on a non-production target) and assert the environment is local/preview/CI — generation can never run against production (white paper requirement). The fixtures package is never imported by production worker code (boundary rule per ADR-0070). _Amended 2026-06-10 (post-build review):_ the dependency-cruiser rule that mechanizes the import boundary is **not built yet** — it arrives with the coherence-tooling work per the walking-skeleton plan; until then the boundary holds by the fail-closed opt-in guard (the only layer that works in the Workers runtime, where `process.env` does not exist) and convention.

### 5.5 Deferred

The R2 document layer, volume load profile (thousands of matters), and snapshot artifacts wait for consumers — per the roadmap, "the volume load profile as the ledger gains consumers." The demo bundle stays minimal until matters/clients exist to hang richness on.

## 6. Enforcement & fitness functions (ADR-0051)

- **Sum-to-zero, table-wide:** a fitness query asserts every entry balances (`HAVING SUM(CASE …) <> 0` returns no rows).
- **Balance consistency:** per account, `SUM(lines in normal-balance terms) = account_balance.balance_minor`.
- **Append-only:** no UPDATE/DELETE statement targets `ledger_entry`/`ledger_line` anywhere in the codebase (source scan; `account_balance` UPDATE is the sanctioned exception, `ledger_account.active` the second once the closing service exists). _Shipped 2026-06-10 (post-build review)_ as the ledger's append-only source-scan test, matching literal and constant-interpolated table names.
- **Leaf-only backstop** _(added 2026-06-10, post-build review)_: `parentAccountsWithPostingsStatement` re-proves table-wide that no parent account carries direct postings — the backstop for the acknowledged createAccount/postEntry cross-batch race that the write-path pre-checks cannot close (cross-row predicates cannot abort a D1 batch). `assertLedgerFitness` runs every fitness query at the seeding chokepoint and in tests, so a new query is automatically part of every proof.
- **Schema fitness (existing):** TEXT identifier PKs, INTEGER `*_minor` columns — already enforced by `@magna-carta/database` tests; the new tables ride them.
- **Determinism:** the seed-twice-diff-rows fixtures test.

## 7. Test plan

Per-package Vitest (the established per-package invocation pattern). `@magna-carta/ledger`: validation unit tests (every §3.3 rule, accept + reject), statement-composition tests, and real-SQL tests against `node:sqlite` proving the batch semantics — CHECK-violation rollback (bounds), UNIQUE race on `reverses_entry_id`, balance updates. `@magna-carta/fixtures`: scenario assertions (which are themselves ledger integration tests) + the determinism test. `@magna-carta/database`: migration + schema tests for the four tables ride the existing harness.

## 8. Out of scope (this slice)

API endpoints (slice 0·5 wires the ledger behind the contract pipeline), auth/firm provisioning (0·4), Queue consumers of `ledger.entry.posted`, trust bounds values and jurisdiction profiles (Phase 3), period close, CoA product, the WIP store (time is WIP, not ledger postings — white paper _Time tracking_), reporting/trial balance UI.

## 9. Documentation & corrections riding the implementation commits

- ADR-0072 (this design) in the Decision Log; ROADMAP + CHANGELOG same-commit discipline.
- **ROADMAP correction:** the slice 0·3 side-task ("API implementing-library spike") was already resolved early — ADR-0066 decided the library and the spike suite validated it empirically (see CHANGELOG). The roadmap line is corrected rather than re-promised.
- `docs/conventions/invariants.md` gains the ledger-core invariants (balanced entries, leaf-only posting) alongside the existing append-only rule when the code lands.
- A per-package `CLAUDE.md` for `@magna-carta/ledger` and `@magna-carta/fixtures` (area template), restating the invariants that bind there.
