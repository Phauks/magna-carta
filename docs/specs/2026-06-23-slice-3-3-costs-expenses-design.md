# Phase 3 · Slice 3·3 — Costs & expenses (disbursements) — design

**Status:** Draft (design) · **Date:** 2026-06-23 · **Owner:** Trevor Goldsmith
**White-paper home:** _Financial Core_ §17 (Costs and expenses) · **Slice map:** [`2026-06-21-phase-3-financial-core-slice-map.md`](2026-06-21-phase-3-financial-core-slice-map.md) §6 (3·3)
**Gates (all on `main`):** the append-only ledger (0·3, untouched here), Matters + Locations (1·1), Directory (1·3), the UTBMS catalog + the WIP lifecycle + the scoped-setting resolver (3·1), the transactional outbox + the per-firm `QUEUE` relay, `@magna-carta/money`, the File Manager (1·1).
**Builds on:** ADR-0078 (cheap-seam-now), ADR-0094 (shipping/postage subsystem + the cost-recovery seam), the 3·1 ADRs (lifecycle/review-gate, effective-dated rate engine, scoped-setting resolver).

This is the implementation-grade design for **costs & expenses** — the firm's per-matter disbursement WIP store, the generalized **platform-fee / cost-recovery seam** (shipping is the first producer), and the codebase's **first per-firm queue consumer**. Costs are work-in-progress that converge onto an invoice in 3·4; this slice never touches the ledger.

---

## 1. Scope & non-goals

**In scope.** A new `@magna-carta/costs` domain package: a per-matter `cost_entry` WIP store; manual + bulk-grid capture; receipt-document attachment; the generalized cost-recovery queue consumer with shipping wired as its only producer. Costs share the **same Draft→Submitted→Approved→Billed lifecycle and the same firm-configurable review gate** as time entries — realized by **extracting that lifecycle into a shared `@magna-carta/billing-core` package** that both `timekeeping` and `costs` (and later `billing`) consume. Backend-only; the UI rides slice 0·7.

**Explicit non-goals (named seams).**

- **Platform billing (Magna Carta → firm)** — the SaaS-side metering/invoicing of a firm for the features it uses (the postage service fee, future e-sign/SMS/voice fees) is a _separate subsystem_ and is **not** this slice. 3·3 only handles the firm→client recovery side.
- **cost → A/R posting + cost markup/blending** — the WIP→A/R ledger conversion and any markup happen at invoice finalize in **3·4**. 3·3 persists WIP and emits `cost.recorded`.
- **Future fee producers** — e-signature, SMS/text, voice/calling, OCR, conversion, etc. plug into the recoverable-charge seam as new categories + topics with **no consumer rewrite**; they are documented seams here, not built (their own features/slices wire them).
- **AI** — no receipt-OCR / auto-categorization (3·1 carries the candidate first AI feature).
- **Recurring / scheduled costs** — 3·7 (billing automations).

---

## 2. The shared lifecycle — `@magna-carta/billing-core` (extraction)

Time entries and cost entries are the same _kind_ of thing: **billable WIP that moves through one lifecycle onto an invoice**. They must therefore share **one** state machine and **one** review gate — not two copies. 3·1 built that lifecycle inside `@magna-carta/timekeeping` (`lifecycle.ts`); this slice lifts it into a shared home.

**Why a new package (evidence).** Of the 27 packages, none is a correct home: `ledger` is money-movement (WIP is explicitly _not_ a ledger posting), `data-access` is the data/chokepoint layer (a transition table is domain logic), `money` is pure arithmetic, and the domain packages (`matters`, `directory`, …) are the wrong domain. There is no `billing`/`wip`/`billable` package. A dedicated shared package is the right move; the dependency direction is clean (`timekeeping`, `costs`, `billing` all depend _down_ into `billing-core`, a leaf).

**What moves into `@magna-carta/billing-core`:**

- The WIP lifecycle: the status type (renamed `TimeEntryStatus` → **`BillableStatus`** — identical states `draft|submitted|approved|billed|void`), the two gate-on/gate-off transition tables, `isFrozen`, `canTransition`, and a generic `assertTransition` that throws a generic **`IllegalTransitionError`** (callers map it to their own validation error). This is a verbatim move of `timekeeping/lifecycle.ts` with the status-type rename and the error decoupled — **no behavior change**.
- The single shared review-gate setting: the **`approval_required`** scoped-setting _definition_ (currently in `timekeeping`), so one canonical gate governs both time and costs. The resolver itself stays in `data-access`; both domains resolve the same definition.

**Extraction safety (an early build task).** Create the package; move + generalize the lifecycle and the gate definition; rewire `timekeeping`'s imports and map `IllegalTransitionError → TimeEntryValidationError("illegal-transition")` at the timekeeping boundary; **re-run 3·1's full suite (timekeeping package + the worker time/timer/e2e/fitness/conformance) and confirm it stays green** before `costs` builds on top. The freeze fitness scan generalizes to scan `billing-core` + both consumers.

**Single gate, split-able later.** One `approval_required` gate is resolved for both time and costs. Because it flows through the scoped-setting precedence chain, a firm _could_ be given per-type override later (a `approval_required.cost` scope key) without a schema change — deferred until a firm asks.

---

## 3. Data model

### 3.1 `cost_entry` (one new per-firm table)

Mirrors `time_entry`'s WIP-store shape. Net-new, no expand-contract.

| Column                   | Notes                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                     | `costEntry_` handle PK                                                                                                                                                                                             |
| `matter_id`              | FK `matter` — required                                                                                                                                                                                             |
| `vendor_id?`             | nullable — a Directory entity id (`directory_organization` / `directory_person`); reuse a seeded `vendor` party-role, **no new vendor table**                                                                      |
| `incurred_date`          | the cost's effective date (reports read this, not `created_at`)                                                                                                                                                    |
| `amount_minor`           | integer minor units                                                                                                                                                                                                |
| `currency`               | TEXT, CHECK against the registered set; one currency per entry                                                                                                                                                     |
| `cost_class`             | CHECK `('hard','soft')` — hard = real money the firm advanced for the client (recoverable receivable); soft = firm-internal allocation (e.g. in-house copies), no external outlay                                  |
| `billable`               | 0/1 — resolved at creation (manual: user; recovery: policy)                                                                                                                                                        |
| `utbms_expense_code_id?` | nullable FK to the UTBMS catalog (E-series); **required at capture when `matter.e_billing` is on**. This is the user-facing "type" (decision: the UTBMS E-code _is_ the type — no separate firm cost-type catalog) |
| `description`            | freeform                                                                                                                                                                                                           |
| `receipt_file_id?`       | nullable — a File Manager document (the receipt/invoice image), matter-rooted                                                                                                                                      |
| `status`                 | CHECK `('draft','submitted','approved','billed','void')` — the **shared `BillableStatus`** lifecycle                                                                                                               |
| `kick_back_reason?`      | nullable — set on kick-back, cleared on resubmit (same contract as time; the reason is a business column, audit metadata stays NULL)                                                                               |
| `source`                 | CHECK `('manual','grid','recovery')` — capture provenance                                                                                                                                                          |
| `recovery_category?`     | nullable — for recovery-originated rows only (e.g. `postage`, `shipping_service_fee`; later `esign_fee`, …); drives recovery-policy resolution + 3·6 reporting                                                     |
| `recovery_ref?`          | nullable — the producer's source id (e.g. `shipmentId`); the consumer dedup/trace anchor                                                                                                                           |
| `invoice_id?`            | nullable — set at 3·4 finalize; the billing lock                                                                                                                                                                   |
| audit                    | `created_at` / `updated_at` / `created_by`; writes audited through the chokepoint                                                                                                                                  |

Indexes for the hot paths: `(matter_id, status)` (per-matter unbilled list — the 3·4 read), `(status, incurred_date)`, and a partial unique on `recovery_ref` where not null (one cost per recovered producer event — the consumer idempotency floor at the DB level).

### 3.2 Reused, no new tables

- **UTBMS catalog** — extend its seed with the **E-series expense codes** (3·1 shipped task/activity); the table and identifiers already exist.
- **Directory** — seed a `vendor` party-role; `vendor_id` references the existing entity tables.
- **File Manager** — `receipt_file_id` references an existing matter-rooted document.
- **Ledger** — untouched in 3·3.

---

## 4. Lifecycle, freeze & invariants

**Lifecycle** = the shared `billing-core` state machine. Gate **off**: `draft → billed` (with `submitted`/`approved → billed` drain). Gate **on**: `draft → submitted → approved → billed`, kick-back `submitted → draft`. `void` reachable from any non-terminal state. `billed`/`void` are terminal and **freeze** the row's business columns (a `WHERE status NOT IN ('billed','void')` guard on every mutating UPDATE, plus the freeze fitness scan generalized to `costs`). Corrections to a billed/void row are **append-only** (void + new entry), never destructive edits.

**Phase invariants honored** (slice-map §4): cost is **WIP, not a ledger posting** (no `ledger_entry` in 3·3; conversion at 3·4 — guarded by the WIP-ledger fitness scan generalized to `@magna-carta/costs`); **effective-dated** (`incurred_date`); **single currency per entry**; **idempotency** (the consumer dedups on the producer event id — the phase's shared idempotency theme).

---

## 5. Capture surfaces & routes

All through the chokepoint, permission namespace **`costs:*`** (`costs:track` for capture/edit/lifecycle; `costs:approve` for submit-review/approve/kick-back, mirroring time's split). A cost belongs to the **matter**, not the recorder, so there is **no per-user self-scoping** (unlike time entries) — `costs:track` holders capture/edit any matter's costs; reads are firm-scoped by tenancy.

| Route                                                                  | Purpose                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /api/v1/costs`                                                   | manual single capture                                                                              |
| `POST /api/v1/costs/batch`                                             | bulk grid — an array of rows in **one** idempotent chokepoint write                                |
| `POST /api/v1/costs/{id}/receipt` · `DELETE …/receipt`                 | link / unlink a File Manager receipt                                                               |
| `GET /api/v1/costs` (by matter / filters) · `GET /api/v1/costs/{id}`   | list / get                                                                                         |
| `PATCH /api/v1/costs/{id}`                                             | edit — **recorded/draft only** (frozen otherwise → 409)                                            |
| `POST /api/v1/costs/{id}/submit` · `/approve` · `/kick-back` · `/void` | the shared lifecycle transitions (gate-aware), `costs:approve` for submit-review/approve/kick-back |

OpenAPI snapshot regenerated; conformance extended (the `costs` operations, the `costs → matter` resource binding, `costs.previewQuickAdd`-style non-mutating reads if any). Integer-minor money in all schemas.

---

## 6. The generalized cost-recovery seam

The load-bearing abstraction. Rather than a shipping-specific handler, the seam is a **canonical recoverable-charge event** any feature emits, mapped by one consumer into matter disbursements per a firm recovery policy.

### 6.1 The canonical event

```
recoverable-charge {
  matterRef?, currency, sourceRef, idempotencyKey,
  lines: [ { category, amountMinor, kind: 'pass_through' | 'platform_fee', description } ]
}
```

- **`pass_through`** = real third-party money the firm advanced (postage, a court filing fee, an expert invoice). **Default: recovered** (a hard, billable matter disbursement).
- **`platform_fee`** = Magna Carta's own markup for providing the feature (the shipping service fee; future e-sign/SMS/voice fees). **Default: not recovered** — the firm absorbs it (it is already billed to the firm on the platform side, out of 3·3). A firm may opt a category in to pass it through.

The `kind`/`category` distinction — _did the firm advance real money, or is this our markup_ — is what makes the recovery defaults correct across every present and future producer.

### 6.2 The recovery policy

A **category-keyed firm setting** resolved through the 3·1 **scoped-setting resolver** (`cost.recover_platform_fee.<category>`, default off per category; `pass_through` lines ignore the policy and always recover). One canonical place to answer "does this firm pass this fee through to clients?", extensible by adding a category — no code change to the consumer's recovery decision.

### 6.3 Mapping to `cost_entry`

For each event line the consumer:

- **`pass_through`** → always create a `cost_entry` (`cost_class=hard`, `billable=1`, `source=recovery`, `recovery_category=<category>`, `recovery_ref=sourceRef`).
- **`platform_fee`** → create a `cost_entry` **only if** the recovery policy for that category is on (`cost_class=hard`, `billable=1`, recovered as a _separate, unblended_ line). If off, **no `cost_entry`** is created — the absorbed fee stays a pure platform-billing concern, out of 3·3.

A **null `matterRef`** = a firm-administrative use (no client) → the whole event is skipped (no disbursement). After creating the row(s), emit **`cost.recorded`** for 3·4 to pick up billable cost WIP at finalize.

### 6.4 Shipping — the only wired producer

`shipping.purchased` already emits `{ shipmentId, postageCostMinor, serviceFeeMinor, currency }` (`shipment-service.ts:127`). A thin **producer adapter** maps it to the canonical event: postage → `pass_through` (category `postage`), service fee → `platform_fee` (category `shipping_service_fee`), `sourceRef`/`idempotencyKey` = `shipmentId`, `matterRef` from the shipment row (`per-firm-schema.ts:1162`). Result, per the policy default: a hard billable postage disbursement always; the service fee billed as a separate unblended line **only** if the firm opted in.

---

## 7. The first per-firm queue consumer

3·3 stands up the per-firm consumer path the relay already publishes to but nothing yet consumes (`scheduled.ts` notes this). Register a per-firm `QUEUE` branch in `apps/worker/src/index.ts` (the symmetric analogue of `CONTROL_PLANE_CONSUMERS`): resolve the firm from `message.firmId`, dispatch on `message.topic`, and **dedup on `message.id`** (at-least-once delivery; overlapping Cron fires must be safe). The `recoverable-charge` handler is registered for the shipping topic; the dispatch table is the extension point for future producers. The DB partial-unique on `recovery_ref` is the second idempotency floor (defense in depth) so a redelivery cannot double-create a disbursement.

---

## 8. Permissions & settings

- **Permissions:** `costs:track`, `costs:approve` in `@magna-carta/access-control`; seeded to the roles that capture/review costs (Owner/Admin/Attorney/Paralegal capture; Owner/Admin/Billing approve — mirror time's seeds), in the new migration.
- **Settings (via the scoped-setting resolver):** the shared `approval_required` gate (now defined in `billing-core`); the per-category `cost.recover_platform_fee.<category>` recovery policy (default off).

---

## 9. Seams / deferred (restated)

cost→A/R posting + markup (3·4) · platform billing MC→firm (separate subsystem) · e-sign / SMS / voice / OCR fee producers (new category + topic, no consumer rewrite) · receipt-OCR / AI (none — 3·1 owns the AI feature) · recurring costs (3·7) · per-type review-gate split (deferred until asked).

---

## 10. Testing & load profile

Mirrors 3·1: TDD via subagent-driven-development. Package unit tests (node-sqlite) for the `costs` services + the `billing-core` lifecycle (the latter re-proving the transition truth table under both gate states after the move); worker route + e2e tests (Miniflare, **single-file runs** to dodge the suite OOM); the **WIP-ledger** and **freeze** fitness scans generalized to cover `@magna-carta/billing-core` + `@magna-carta/costs`; conformance + OpenAPI snapshot; a **`CostVolume`** sub-profile added to the load profile (`profile.ts`) measuring the per-matter unbilled-cost list + the consumer throughput (plan-scan clean). An e2e proving: capture → (gate on) submit → approve; a `shipping.purchased` event → the postage disbursement (always) + the service fee line (only with recovery on); a null-matter shipment → no cost; the cost freezes at `billed`.

---

## 11. Decisions to record (ADR fragments)

1. **`@magna-carta/billing-core`** — extract the shared WIP lifecycle + the review-gate definition out of `timekeeping`; one workflow for time and costs (and 3·4 billing).
2. **The recoverable-charge seam** — the canonical event + `pass_through` vs `platform_fee` kind + the category-keyed recovery policy; the firm→client recovery boundary vs the MC→firm platform-billing boundary.
3. **First per-firm queue consumer** — the per-firm `QUEUE` dispatch + dedup contract.
4. **`cost_entry` model** — UTBMS-E-code-as-type, hard/soft class, append-only freeze, the per-matter unbilled-cost read for 3·4.

---

## 12. Starting seams (file:line anchors on `main`)

- Lifecycle to extract: `packages/timekeeping/src/lifecycle.ts` (pure; only imports `time-entry-validation.ts`).
- WIP-store template: `packages/timekeeping/src/time-entry-statements.ts` + `time-entry-service.ts` (ClockPort + actor + `domainAuditStatement` + `newIdentifier`, returns `EffectWrite`).
- Scoped-setting resolver: `packages/data-access/src/scoped-setting-statements.ts` (the gate + recovery policy).
- Producer: `packages/data-access/src/shipment-service.ts:127` (`shipment.purchased`); shipment row `packages/database/src/per-firm-schema.ts:1162` (`matter_ref`, `postage_cost_minor`, `service_fee_minor`).
- Consumer registration: `apps/worker/src/index.ts` (the `CONTROL_PLANE_CONSUMERS` analogue) + `scheduled.ts` (the relay note).
- Money: `packages/money/src/money.ts` (integer-minor, no floats).
- Route/chokepoint pattern: `apps/worker/src/routes/timekeeping/time-entries.ts` (the clean `defineOpenAPIRoute` template).
