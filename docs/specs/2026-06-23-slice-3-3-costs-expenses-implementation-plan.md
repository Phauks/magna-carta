# Slice 3·3 — Costs & expenses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the firm's per-matter cost/disbursement WIP store with a generalized platform-fee cost-recovery seam, sharing the time-entry lifecycle via a new extracted `@magna-carta/billing-core`.

**Architecture:** A new `@magna-carta/costs` domain package (mirrors `@magna-carta/timekeeping`) over a per-firm `cost_entry` WIP table; costs move through the SAME Draft→Submitted→Approved→Billed lifecycle as time, so that lifecycle + the single review-gate setting are first extracted out of `timekeeping` into a shared `@magna-carta/billing-core`. Capture is manual + bulk-grid + receipt-attach + an automated **first per-firm queue consumer** that maps a canonical `recoverable-charge` event into matter disbursements per a category-keyed firm recovery policy. The ledger is never touched (WIP→A/R is 3·4).

**Tech Stack:** TypeScript (Node + Cloudflare Workers), Drizzle (per-firm SQLite), Hono + `@hono/zod-openapi`, `@cloudflare/vitest-pool-workers` (Miniflare), `vite-plus` (`vp`), integer-minor money via `@magna-carta/money`.

**Design spec:** [`2026-06-23-slice-3-3-costs-expenses-design.md`](2026-06-23-slice-3-3-costs-expenses-design.md). Read it before starting.

## Global Constraints

- **Money is integer minor units** (`amount_minor`); rates `rate_e4`. **No floats** on any money value. Minutes/quantities are integers.
- **Every write goes through the data-access chokepoint** (`runIdempotentEffect` / `commitEffectBatch`), is **audited** (`domainAuditStatement`), and is **firm-scoped**. `audit_log.metadata` stays NULL (no privileged content). Mutating routes declare `idempotency: "required"`.
- **No process-doc references** (`ADR-NNNN`, `"slice 3·3"`, `"Task N"`, `"spec §"`) in any source / test / OpenAPI `description` string — enforced by `pnpm run lint:process-refs`. Docs (specs, ADRs, STATUS, ROADMAP, CLAUDE.md) may cite freely.
- **No emojis** anywhere (source, tests, docs, commits).
- **Full names, no shorthand** (golden rule 12): no `db`/`dal`/`id`-style abbreviations beyond the codebase's accepted encoding suffixes (`...Minor`, `...E4`).
- **Append-only / freeze:** corrections to a `billed`/`void` row are new rows (void + re-create), never destructive UPDATEs; every mutating UPDATE carries a `WHERE status NOT IN ('billed','void')` guard.
- **CHECK enums stated in SQL** for every status/class/source/currency column.
- **Run `pnpm exec vp check` (0 errors) after every task** — `vitest` never typechecks; a green test run is not a green typecheck.
- **The worker's 66-file Miniflare suite OOMs.** Run worker tests ONE file at a time by full path: `cd apps/worker && pnpm exec vp test run test/<file>.test.ts`. NEVER the whole suite, NEVER `-- <substring>` (it runs all 66). Package tests (`pnpm --filter <pkg> test`, node-sqlite) are light and may run whole.
- **Commit with explicit `git add <paths>`** — never `git add -A`; never add `.superpowers/`.
- **Worktree:** `C:/dev/magna-carta-worktrees/slice-3-3-costs`, branch `slice-3-3-costs`, off `main`. Run all build commands from there.

---

## File structure

**New package `packages/billing-core/`** (the shared WIP lifecycle, extracted from timekeeping):

- `src/lifecycle.ts` — `BillableStatus`, the gate-on/off transition tables, `isFrozen`, `canTransition`, `assertTransition` (throws generic `IllegalTransitionError`).
- `src/lifecycle-error.ts` — `IllegalTransitionError`.
- `src/review-gate.ts` — `approvalRequiredDefinition` (key `billing.approval_required`, `FirmSettingDefinition<boolean>`, default `false`).
- `src/index.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `test/lifecycle.test.ts`.

**New package `packages/costs/`** (the costs domain, mirrors `timekeeping`):

- `src/cost-entry-statements.ts` · `src/cost-entry-service.ts` · `src/cost-validation.ts` · `src/queries.ts` · `src/recoverable-charge.ts` (the canonical event + the recovery mapping) · `src/recovery-policy.ts` (the category-keyed setting) · `src/index.ts` + package scaffolding + tests.

**Modified:**

- `packages/timekeeping/src/lifecycle.ts` → re-export from billing-core (or delete + rewire imports); `src/settings.ts` → import the gate from billing-core; `src/time-entry-service.ts` → map `IllegalTransitionError`.
- `packages/database/src/per-firm-schema.ts` → `cost_entry` table; new per-firm migration + journal/snapshot; `packages/database/src/per-firm-schema.ts` UTBMS seed extended with E-series (or a seed migration).
- `packages/identifiers/src/registry.ts` + `types.ts` → `costEntry` handle.
- `packages/access-control/src/registry.ts` → `costs:track`, `costs:approve`.
- `apps/worker/src/routes/billing/costs.ts` (new) · `apps/worker/src/index.ts` (the per-firm QUEUE consumer) · `apps/worker/src/costs/recoverable-charge-consumer.ts` (new) · `apps/worker/src/costs/shipping-cost-recovery.ts` (the producer adapter, new).
- `apps/worker/openapi/openapi.json` (regenerated) · `apps/worker/test/conformance.test.ts`.
- `packages/fixtures/src/load-profile/` → `CostVolume`.
- Fitness: `apps/worker/test/timekeeping-wip-ledger-fitness.test.ts` + `timekeeping-freeze-fitness.test.ts` → generalize to cover `billing-core` + `costs` (rename to `billing-wip-ledger-fitness` / `billing-freeze-fitness`).

---

## Task 1: Extract the WIP lifecycle into `@magna-carta/billing-core`

**Files:**

- Create: `packages/billing-core/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/lifecycle-error.ts`, `src/lifecycle.ts`, `test/lifecycle.test.ts`
- Template to copy verbatim then generalize: `packages/timekeeping/src/lifecycle.ts` (the transition tables, `isFrozen`, `canTransition`, `assertTransition`).
- Template for package scaffold: `packages/timekeeping/package.json` + `tsconfig.json` + `vitest.config.ts` (copy, rename to `@magna-carta/billing-core`, drop deps it doesn't need — billing-core has NO runtime deps).

**Interfaces:**

- Produces: `type BillableStatus = "draft" | "submitted" | "approved" | "billed" | "void"`; `isFrozen(status: BillableStatus): boolean`; `canTransition(from: BillableStatus, to: BillableStatus, gateOn: boolean): boolean`; `assertTransition(from: BillableStatus, to: BillableStatus, gateOn: boolean): void` (throws `IllegalTransitionError`); `class IllegalTransitionError extends Error { readonly from: BillableStatus; readonly to: BillableStatus; readonly gateOn: boolean }`.

- [ ] **Step 1: Scaffold the package.** Copy `packages/timekeeping/{package.json,tsconfig.json,vitest.config.ts}` into `packages/billing-core/`. Set `"name": "@magna-carta/billing-core"`. Remove every dependency except `@magna-carta/tsconfig` (devDep) — this package is pure logic with no runtime deps. Add the package to the workspace (it is auto-discovered by `pnpm-workspace.yaml`'s `packages/*`). Add subpath exports for `./lifecycle` and `./review-gate` in `package.json` `exports` (copy the `exports` shape from `timekeeping/package.json`).

- [ ] **Step 2: Write `IllegalTransitionError`.**

```ts
// packages/billing-core/src/lifecycle-error.ts
import type { BillableStatus } from "./lifecycle.ts";

// A move that the WIP state machine refuses. Domain packages catch this and re-throw their own
// validation error (TimeEntryValidationError / CostValidationError) so the HTTP layer maps it to 409.
export class IllegalTransitionError extends Error {
  constructor(
    readonly from: BillableStatus,
    readonly to: BillableStatus,
    readonly gateOn: boolean,
  ) {
    super(
      `cannot move a billable item from ${from} to ${to} (review gate ${gateOn ? "on" : "off"})`,
    );
    this.name = "IllegalTransitionError";
  }
}
```

- [ ] **Step 3: Write the failing lifecycle test.** Copy `packages/timekeeping/test/lifecycle.test.ts` into `packages/billing-core/test/lifecycle.test.ts`; rename `TimeEntryStatus` → `BillableStatus`, import from `../src/lifecycle.ts`; change the expected throw in the illegal-transition case to `IllegalTransitionError` (instead of `TimeEntryValidationError`). Keep every truth-table case (both gate states, the void-from-anywhere rule, the gate-off drain `submitted/approved → billed`, terminal-freeze).

- [ ] **Step 4: Run it — expect FAIL (module missing).**
      Run: `cd packages/billing-core && pnpm exec vitest run test/lifecycle.test.ts`
      Expected: FAIL — `Cannot find module '../src/lifecycle.ts'`.

- [ ] **Step 5: Write `lifecycle.ts`.** Copy `packages/timekeeping/src/lifecycle.ts` verbatim, then: rename the type `TimeEntryStatus` → `BillableStatus` everywhere; replace `import { TimeEntryValidationError } from "./time-entry-validation.ts"` with `import { IllegalTransitionError } from "./lifecycle-error.ts"`; in `assertTransition`, `throw new IllegalTransitionError(from, to, gateOn)`. The two transition `Map`s, `isFrozen`, `canTransition` are unchanged (just the type name). Update the file's lead comment to say "billable item" not "time entry".

- [ ] **Step 6: Write `src/index.ts`** re-exporting `./lifecycle.ts` + `./lifecycle-error.ts` (and `./review-gate.ts` after Task 2).

- [ ] **Step 7: Run the test — expect PASS.**
      Run: `cd packages/billing-core && pnpm exec vitest run test/lifecycle.test.ts`
      Expected: PASS (all transition cases).

- [ ] **Step 8: `vp check` + commit.**
      Run: `cd ../.. && pnpm exec vp check` → 0 errors.

```bash
git add packages/billing-core packages/pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(billing-core): extract the shared WIP lifecycle as a standalone package"
```

(If `pnpm-lock.yaml`/workspace didn't change, omit them. Run `pnpm install` first if the new package isn't linked.)

---

## Task 2: Move the review gate into billing-core; rewire timekeeping; re-verify 3·1 green

**Files:**

- Create: `packages/billing-core/src/review-gate.ts`, `packages/billing-core/test/review-gate.test.ts`
- Modify: `packages/timekeeping/src/settings.ts` (remove `approvalRequiredDefinition`, import from billing-core), `packages/timekeeping/src/lifecycle.ts` (replace with a re-export shim OR delete and rewire importers), `packages/timekeeping/src/time-entry-service.ts` (map `IllegalTransitionError → TimeEntryValidationError`), `packages/timekeeping/package.json` (add `@magna-carta/billing-core` dep), every timekeeping/worker importer of `time.approval_required` or `TimeEntryStatus`/`assertTransition` from `./lifecycle.ts`.

**Interfaces:**

- Produces: `billing-core/review-gate.ts` exports `approvalRequiredDefinition: FirmSettingDefinition<boolean>` with `key: "billing.approval_required"`, `defaultValue: false`. Timekeeping re-exports `TimeEntryStatus = BillableStatus` for back-compat within the package.
- Consumes: `FirmSettingDefinition` from `@magna-carta/data-access/scoped-setting-statements` (the existing definition type — read `timekeeping/src/settings.ts:1-20` for the exact import + shape).

- [ ] **Step 1: Write the gate definition + test.** Move `approvalRequiredDefinition` from `timekeeping/src/settings.ts` into `packages/billing-core/src/review-gate.ts`, changing `key: "time.approval_required"` → `key: "billing.approval_required"` (no firms exist, so the rename is free and makes it domain-neutral). Copy its surrounding comment. Add `test/review-gate.test.ts` asserting `approvalRequiredDefinition.key === "billing.approval_required"` and `approvalRequiredDefinition.defaultValue === false`. `@magna-carta/billing-core` now needs `@magna-carta/data-access` as a dep (for the `FirmSettingDefinition` type import) — add it.

- [ ] **Step 2: Rewire timekeeping's lifecycle + gate imports.** In `timekeeping/src/settings.ts`, delete the moved definition and `export { approvalRequiredDefinition } from "@magna-carta/billing-core/review-gate"` (keep the same export name so timekeeping's routes are unchanged). In `timekeeping/src/lifecycle.ts`, replace the file body with re-exports: `export { canTransition, isFrozen, assertTransition, type BillableStatus as TimeEntryStatus } from "@magna-carta/billing-core/lifecycle";` (preserve the `TimeEntryStatus` alias so the rest of timekeeping compiles unchanged). Add `@magna-carta/billing-core` to `timekeeping/package.json` dependencies.

- [ ] **Step 3: Map the generic error at the timekeeping boundary.** In `time-entry-service.ts`, wrap the `assertTransition` call site(s): catch `IllegalTransitionError` and re-throw `new TimeEntryValidationError("illegal-transition", error.message)`. (Search the service for `assertTransition(`; there is one transition helper — wrap it.) Import `IllegalTransitionError` from `@magna-carta/billing-core/lifecycle`.

- [ ] **Step 4: Update the gate setting key references.** Grep the repo for `"time.approval_required"`: `git grep -n "time.approval_required"`. Update each (the worker route that resolves it, any seed/test) to consume `approvalRequiredDefinition` by import rather than the literal — or update the literal to `"billing.approval_required"`. There must be no remaining `time.approval_required` literal.

- [ ] **Step 5: Run the FULL 3·1 verification — it MUST stay green.**
      Run (package): `pnpm --filter @magna-carta/timekeeping test` → expect the same pass count as on main (the lifecycle move is behavior-preserving).
      Run (worker, single files): `cd apps/worker && pnpm exec vp test run test/live-timer-do.test.ts` then `test/time-entries-routes.test.ts` then `test/timer-routes.test.ts` then `test/e2e/slice-3-1-e2e.test.ts` then `test/conformance.test.ts` — all green.
      Run: `cd ../.. && pnpm exec vp check` → 0 errors.
      If anything 3·1 fails, the extraction changed behavior — fix the rewire, do not weaken the test.

- [ ] **Step 6: Commit.**

```bash
git add packages/billing-core packages/timekeeping apps/worker
git commit -m "refactor(timekeeping): consume the shared billing-core lifecycle + review gate"
```

---

## Task 3: `cost_entry` schema + migration

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts` (add the `cost_entry` table + the `vendor` Directory party-role seed if seeds live in schema; check how 3·1 seeded — `git grep -n "party_role\|seedPartyRole" packages/database`).
- Create (generated): `packages/database/drizzle/per-firm/00NN_<name>.sql` + `meta/00NN_snapshot.json` + updated `meta/_journal.json` (via `pnpm --filter @magna-carta/database run generate-per-firm-migrations`).
- Modify: `apps/worker/src/per-firm-migrations.ts` (import + register the new migration), `apps/worker/test/per-firm-migrations.test.ts` (assert the new tables apply).

**Interfaces:**

- Produces: the `cost_entry` table with the columns from design §3.1; indexes `(matter_id, status)`, `(status, incurred_date)`, partial-unique on `recovery_ref WHERE recovery_ref IS NOT NULL`.

- [ ] **Step 1: Add the `cost_entry` drizzle table.** In `per-firm-schema.ts`, after the timekeeping tables, add (model the column helpers + `check()` + `index()` on the existing `time_entry` table definition in the same file):

```ts
export const costEntry = sqliteTable(
  "cost_entry",
  {
    id: text("id").primaryKey().$type<CostEntryId>(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matter.id),
    vendorId: text("vendor_id"), // nullable Directory entity id
    incurredDate: text("incurred_date").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    costClass: text("cost_class").notNull(), // hard | soft
    billable: integer("billable").notNull(), // 0/1
    utbmsExpenseCodeId: text("utbms_expense_code_id").references(() => utbmsCode.id),
    description: text("description").notNull().default(""),
    receiptFileId: text("receipt_file_id"), // nullable File Manager doc
    status: text("status").notNull(), // draft|submitted|approved|billed|void
    kickBackReason: text("kick_back_reason"),
    source: text("source").notNull(), // manual|grid|recovery
    recoveryCategory: text("recovery_category"),
    recoveryRef: text("recovery_ref"),
    invoiceId: text("invoice_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [
    check("cost_entry_cost_class_check", sql`${table.costClass} IN ('hard','soft')`),
    check(
      "cost_entry_status_check",
      sql`${table.status} IN ('draft','submitted','approved','billed','void')`,
    ),
    check("cost_entry_source_check", sql`${table.source} IN ('manual','grid','recovery')`),
    check("cost_entry_billable_check", sql`${table.billable} IN (0,1)`),
    check("cost_entry_currency_check", sql`${table.currency} IN ('USD')`),
    index("cost_entry_matter_status_index").on(table.matterId, table.status),
    index("cost_entry_status_incurred_date_index").on(table.status, table.incurredDate),
    uniqueIndex("cost_entry_recovery_ref_unique")
      .on(table.recoveryRef)
      .where(sql`${table.recoveryRef} IS NOT NULL`),
  ],
);
```

Import `CostEntryId` from `@magna-carta/identifiers/types` (added in Task 4 — for now add it there first, or land Task 4's identifier before this; reorder so the identifier exists). Use the same `currency` CHECK set as `time_entry` (copy it).

- [ ] **Step 2: Generate the migration.**
      Run: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`
      Expected: writes `drizzle/per-firm/00NN_<random>.sql` (NN = next slot after `0021_outgoing_talon`) containing `CREATE TABLE cost_entry` + the indexes, plus `meta/00NN_snapshot.json` and an updated `_journal.json`. Inspect the SQL: confirm all CHECK enums + the partial unique index are present.

- [ ] **Step 3: Register the migration in the worker runner.** In `apps/worker/src/per-firm-migrations.ts`, add `import costsSql from "@magna-carta/database/drizzle/per-firm/00NN_<name>.sql";` and the map entry `"00NN_<name>": costsSql,` (follow the existing entries' exact shape — see the file's import block + map).

- [ ] **Step 4: Write the migration test.** In `packages/database/test/` (find the per-firm-migration test, e.g. `per-firm-schema.test.ts`), add a test that applies all migrations and asserts `cost_entry` exists with the status/class CHECK enforced (insert a bad `cost_class` → expect throw) and the partial unique on `recovery_ref` (two NULLs allowed, two equal non-NULLs rejected). Model it on the 3·1 `0016`/`time_entry` schema tests.
      Run: `pnpm --filter @magna-carta/database test` → PASS.

- [ ] **Step 5: `vp check` + commit.**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm apps/worker/src/per-firm-migrations.ts packages/database/test
git commit -m "feat(database): cost_entry per-firm table + migration"
```

---

## Task 4: `costEntry` identifier + `@magna-carta/costs` scaffold + validation error

**Files:**

- Modify: `packages/identifiers/src/registry.ts` (add `costEntry: "costEntry"`), `src/types.ts` (`export type CostEntryId = Identifier<"costEntry">`), the prefixes test.
- Create: `packages/costs/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/cost-validation.ts}` + a prefixes test.

**Interfaces:**

- Produces: `CostEntryId`; `class CostValidationError extends Error { readonly code: CostValidationCode }` where `type CostValidationCode = "not-found" | "draft-only" | "frozen-entry" | "illegal-transition" | "non-positive-amount" | "utbms-required" | "empty-patch"`.

- [ ] **Step 1: Add the identifier.** In `identifiers/src/registry.ts` add `costEntry: "costEntry",` with a one-line comment (model the timekeeping prefixes block). In `types.ts` add `export type CostEntryId = Identifier<"costEntry">;`. Add a prefixes-test assertion (`prefixFor("costEntry") === "costEntry"`).
      Run: `pnpm --filter @magna-carta/identifiers test` → PASS.

- [ ] **Step 2: Scaffold `@magna-carta/costs`.** Copy `timekeeping/{package.json,tsconfig.json,vitest.config.ts}`; rename to `@magna-carta/costs`; depend on `@magna-carta/billing-core`, `@magna-carta/data-access`, `@magna-carta/identifiers`, `@magna-carta/money`, `@magna-carta/database`. Add `exports` subpaths (`./cost-entry-service`, `./cost-entry-statements`, `./cost-validation`, `./recoverable-charge`, `./recovery-policy`, `./queries`).

- [ ] **Step 3: Write `cost-validation.ts`** (mirror `timekeeping/src/time-entry-validation.ts` exactly, renamed):

```ts
export type CostValidationCode =
  | "not-found"
  | "draft-only"
  | "frozen-entry"
  | "illegal-transition"
  | "non-positive-amount"
  | "utbms-required"
  | "empty-patch";

export class CostValidationError extends Error {
  constructor(
    readonly code: CostValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "CostValidationError";
  }
}
```

- [ ] **Step 4: `pnpm install` + `vp check` + commit.**

```bash
git add packages/identifiers packages/costs pnpm-lock.yaml
git commit -m "feat(costs): costEntry identifier + @magna-carta/costs scaffold + validation error"
```

---

## Task 5: cost-entry statements

**Files:** Create `packages/costs/src/cost-entry-statements.ts` + `test/cost-entry-statements.test.ts`. **Template:** `packages/timekeeping/src/time-entry-statements.ts` (copy its structure: typed `SqlStatement` builders, `DraftPatch` iteration, the existence pre-read, the guarded transition UPDATE).

**Interfaces:**

- Produces: `insertCostEntryStatement(db, row)`; `selectCostEntryStatement(db, id)` returning `{ status, matterId, ... }`; `updateDraftCostStatement(db, id, patch: CostDraftPatch)`; `transitionCostStatusStatement(db, id, from, to, updatedAt)` (`WHERE id=? AND status=?`); `setCostKickBackReasonStatement(db, id, reason, updatedAt)` (`WHERE status NOT IN ('billed','void')`); `attachReceiptStatement` / `detachReceiptStatement`; `selectMatterEBillingStatement` (reuse timekeeping's or re-export); `type CostDraftPatch` (the editable fields: `vendorId?`, `incurredDate?`, `amountMinor?`, `currency?`, `costClass?`, `billable?`, `utbmsExpenseCodeId?`, `description?`).

- [ ] **Step 1: Write failing tests** for each statement against an in-memory node-sqlite db (copy the test harness from `timekeeping/test/time-entry-statements.test.ts`): insert + read back; `updateDraftCostStatement` only iterates `CostDraftPatch` keys; `transitionCostStatusStatement` matches 0 rows when the `from` status is stale; `setCostKickBackReasonStatement` does NOT touch a `billed` row. Assert exact column writes.
- [ ] **Step 2: Run — expect FAIL** (`cd packages/costs && pnpm exec vitest run test/cost-entry-statements.test.ts`).
- [ ] **Step 3: Implement `cost-entry-statements.ts`** following the time-entry template, with the `cost_entry` columns from Task 3. The transition statement: `UPDATE cost_entry SET status = ?, updated_at = ? WHERE id = ? AND status = ?`. The kick-back statement: `... SET kick_back_reason = ?, updated_at = ? WHERE id = ? AND status NOT IN ('billed','void')`. `updateDraftCostStatement` iterates only `CostDraftPatch` keys (do NOT include `status`/`invoice_id`/`recovery_*`).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: `vp check` + commit** (`git add packages/costs/src/cost-entry-statements.ts packages/costs/test/...`).

---

## Task 6: cost-entry service (capture + lifecycle)

**Files:** Create `packages/costs/src/cost-entry-service.ts` + `test/cost-entry-service.test.ts`. **Template:** `packages/timekeeping/src/time-entry-service.ts` (the `ClockPort`/`actorUserId`/`randomSource` options, `EffectWrite` returns, `domainAuditStatement`, the pre-read-existence-then-transition pattern, the `IllegalTransitionError → CostValidationError` mapping).

**Interfaces:**

- Produces: `CostServiceOptions { clock: ClockPort; actorUserId: UserId|null; randomSource?: RandomSource }`; `captureCost(db, input: CaptureCostInput, options): { costEntryId: string; effect: EffectWrite }`; `updateDraftCost(db, id, patch, options): { effect }`; `submitCost`/`approveCost`/`kickBackCost`/`voidCost`(db, id, gateOn, options[, reason]): `{ effect }`. `CaptureCostInput { id?: CostEntryId; matterId; vendorId?; incurredDate; amountMinor; currency; costClass: "hard"|"soft"; billable; utbmsExpenseCodeId?; description; source: "manual"|"grid"|"recovery"; recoveryCategory?; recoveryRef? }`.
- Consumes: `assertTransition`/`isFrozen`/`IllegalTransitionError` from `@magna-carta/billing-core/lifecycle`; `approvalRequiredDefinition` from `@magna-carta/billing-core/review-gate`.

- [ ] **Step 1: Write failing tests** (copy `time-entry-service.test.ts` harness): `captureCost` writes a `recorded`... (note: initial status is `draft`) row with `status='draft'`, audited, integer amount; `captureCost` with `amountMinor <= 0` throws `CostValidationError("non-positive-amount")`; capture with `eBilling` on + no `utbmsExpenseCodeId` throws `"utbms-required"`; `submitCost` on an unknown id throws `"not-found"` (pre-read, NO phantom audit row); `voidCost` from `draft` works; a transition refused by the gate throws `"illegal-transition"`; editing a `billed` row throws `"frozen-entry"`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement the service** per the template. Initial capture `status: "draft"`. Lifecycle ops pre-read existence (`selectCostEntryStatement`) → throw `not-found` if absent (no audit on unknown id — the phantom-audit guard), then `assertTransition(from, to, gateOn)` wrapped to re-throw `CostValidationError("illegal-transition", e.message)`, then compose the guarded transition statement + audit. `updateDraftCost` refuses non-`draft` (`draft-only`/`frozen-entry`) and empty patches (`empty-patch`). E-billing required-code check reuses `selectMatterEBillingStatement`.
- [ ] **Step 4: Run — expect PASS** (`pnpm --filter @magna-carta/costs test`).
- [ ] **Step 5: `vp check` + commit.**

---

## Task 7: cost routes — create / list / get / update + `costs:*` permissions

**Files:** Create `apps/worker/src/routes/billing/costs.ts` + `apps/worker/test/costs-routes.test.ts`. Modify `apps/worker/src/app.ts` (register the route bundle), `packages/access-control/src/registry.ts` (+ its test), the per-firm migration's seed (or the existing role-seed path — `git grep -n "time:track" packages/database` to find where 3·1 seeded its perms, mirror for `costs:track`/`costs:approve`). **Template:** `apps/worker/src/routes/timekeeping/time-entries.ts` (the `defineOpenAPIRoute` + chokepoint + `writeMeta` + error-mapping pattern).

**Interfaces:**

- Produces routes: `costs.create`, `costs.list`, `costs.get`, `costs.update`. Permission keys `costs:track` (create/update/list/get).
- Consumes: `captureCost`/`updateDraftCost` (Task 6); `resolveScopedSetting` + `approvalRequiredDefinition` (gate); the chokepoint `requireChokepointFirmContext`/`requireChokepointUserId`.

- [ ] **Step 1:** Add `costs:track`, `costs:approve` to `access-control/src/registry.ts` (mirror the `time:*` block — read it) + update its registry test's expected set. Add the seeds to the role-seed path used by 3·1 (Owner/Admin/Attorney/Paralegal get `costs:track`; Owner/Admin/Billing get `costs:approve` — match time's seed roles).
- [ ] **Step 2: Write failing route tests** (copy the `time-entries-routes.test.ts` harness — seed firm/owner, sign in): `POST /api/v1/costs` (manual, `source:"manual"`) → 201 + the row persisted with `status='draft'`, integer `amount_minor`; a `costs:track`-less member → 403; `GET /api/v1/costs?matterId=…` returns the matter's costs; `PATCH` a draft → 200; `PATCH` a non-existent id → 404 (no audit). Use the OOM-safe single-file run.
- [ ] **Step 3: Implement `costs.ts`** per the template: `defineOpenAPIRoute` for each, `writeMeta("costs.create", TRACK)` etc., resolve the gate where lifecycle is involved, map `CostValidationError` codes to HTTP (not-found→404; draft-only/frozen-entry/illegal-transition→409; non-positive-amount/utbms-required/empty-patch→422; permission→403). Register in `app.ts`.
- [ ] **Step 4: Run the single-file test — expect PASS.** Regenerate OpenAPI (`cd apps/worker && pnpm run emit-openapi`) — Task 13 finalizes conformance; for now keep `openapi-snapshot` green or defer its assertion to Task 13.
- [ ] **Step 5: `vp check` + commit.**

---

## Task 8: cost routes — batch (grid) + lifecycle transitions

**Files:** Modify `apps/worker/src/routes/billing/costs.ts` + `apps/worker/test/costs-routes.test.ts`.

**Interfaces:** Produces routes `costs.batch` (`POST /api/v1/costs/batch`), `costs.submit`/`costs.approve`/`costs.kickBack`/`costs.void`. `costs.approve`/`submit`/`kickBack` carry `costs:approve`; `void` carries `costs:track`. (Note: like time, `submit` is the author's action — but costs are matter-owned not user-owned; gate `submit` on `costs:track` and `approve`/`kickBack` on `costs:approve`. Confirm against the design's "no per-user self-scoping": submit = `costs:track`.)

- [ ] **Step 1: Write failing tests:** `POST /costs/batch` with two rows → both persisted in ONE write (assert both exist + one audit batch); a batch with an e-billing entry missing the UTBMS code → 422, neither row written (atomic); `submit`→`approve` (gate on) moves `draft→submitted→approved`; `void` a draft → `void`; `kickBack` requires `costs:approve` (a `costs:track`-only member → 403); a transition on a billed row → 409.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `costs.batch` composes N `captureCost` effects into one `runIdempotentEffect` batch (model the grid-batch in `time-entries.ts`). Lifecycle routes resolve the gate, call the service op, map errors. `submit` gated `TRACK`, `approve`/`kickBack` gated `APPROVE`.
- [ ] **Step 4: Run — expect PASS** (single-file).
- [ ] **Step 5: `vp check` + commit.**

---

## Task 9: receipt attach / unlink routes

**Files:** Modify `apps/worker/src/routes/billing/costs.ts` + test; statements from Task 5 (`attachReceiptStatement`/`detachReceiptStatement`).

**Interfaces:** Produces `costs.attachReceipt` (`POST /api/v1/costs/{id}/receipt` body `{ fileId }`), `costs.detachReceipt` (`DELETE …/receipt`). `costs:track`.

- [ ] **Step 1: Write failing tests:** attach sets `receipt_file_id`; attach to a non-existent cost → 404; attach to a `billed` cost → 409 (frozen); detach clears it. (No File Manager existence check beyond the FK — note the receipt fileId is trusted matter-rooted; a stricter cross-check is a documented follow-up.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the two routes + the statements through the chokepoint (audited; recorded/draft-or-any-non-frozen only — receipts can attach while unbilled).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: `vp check` + commit.**

---

## Task 10: the recoverable-charge event + the recovery policy

**Files:** Create `packages/costs/src/recoverable-charge.ts`, `packages/costs/src/recovery-policy.ts` + tests.

**Interfaces:**

- Produces: `interface RecoverableChargeLine { category: string; amountMinor: number; kind: "pass_through" | "platform_fee"; description: string }`; `interface RecoverableChargeEvent { matterRef: string | null; currency: string; sourceRef: string; idempotencyKey: string; lines: RecoverableChargeLine[] }`; `recoverPlatformFeeDefinition(category: string): FirmSettingDefinition<boolean>` (key `cost.recover_platform_fee.${category}`, default `false`); `shouldRecover(line: RecoverableChargeLine, policyOn: boolean): boolean` (pass_through → always true; platform_fee → `policyOn`).

- [ ] **Step 1: Write failing tests:** `shouldRecover` returns true for any `pass_through` regardless of policy; for `platform_fee` returns the policy value; `recoverPlatformFeeDefinition("shipping_service_fee").key === "cost.recover_platform_fee.shipping_service_fee"`, default false.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the types + `shouldRecover` + the per-category definition factory (mirror `approvalRequiredDefinition`'s `FirmSettingDefinition` shape).
- [ ] **Step 4: Run — expect PASS** (`pnpm --filter @magna-carta/costs test`).
- [ ] **Step 5: `vp check` + commit.**

---

## Task 11: map a recoverable-charge event to cost entries

**Files:** Modify `packages/costs/src/recoverable-charge.ts` (add the mapping); test.

**Interfaces:** Produces `chargeToCaptureInputs(event: RecoverableChargeEvent, policy: (category: string) => boolean): CaptureCostInput[]` — for each line, if `shouldRecover(line, policy(line.category))`, emit a `CaptureCostInput` (`source: "recovery"`, `costClass: "hard"`, `billable: true`, `recoveryCategory: line.category`, `recoveryRef: event.sourceRef`, `matterId: event.matterRef`, `amountMinor`, `currency`, `incurredDate` from the caller/clock, `description`); skip non-recovered lines. A `null matterRef` → return `[]` (firm-administrative, no disbursement).

- [ ] **Step 1: Write failing tests:** a shipping-shaped event (postage `pass_through` + service fee `platform_fee`) with policy OFF → one input (postage only); with policy ON → two inputs; `matterRef: null` → `[]`; every emitted input has `source:"recovery"`, `recoveryRef`, `recoveryCategory`, integer `amountMinor`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `chargeToCaptureInputs`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: `vp check` + commit.**

---

## Task 12: the first per-firm queue consumer + the shipping producer adapter

**Files:** Create `apps/worker/src/costs/recoverable-charge-consumer.ts`, `apps/worker/src/costs/shipping-cost-recovery.ts`. Modify `apps/worker/src/index.ts` (register the per-firm `QUEUE` branch — mirror `CONTROL_PLANE_CONSUMERS`; read `index.ts` + `scheduled.ts` for the relay/message shape). Create `apps/worker/test/costs-recovery-consumer.test.ts`.

**Interfaces:**

- Consumes: `chargeToCaptureInputs` + `captureCost` (Tasks 6/11); `resolveScopedSetting` + `recoverPlatformFeeDefinition` (the policy); the per-firm queue `message { id, firmId, topic, payload }` shape.
- Produces: a per-firm queue dispatch keyed on `message.topic`; the `shipping.purchased` handler; emits `cost.recorded` per created cost.

- [ ] **Step 1: Write a failing handler test** (Miniflare, single-file): feed a `shipping.purchased` message (`{ shipmentId, postageCostMinor, serviceFeeMinor, currency }`) with a seeded shipment row carrying a `matter_ref`; assert (policy off) one `cost_entry` with `recovery_category='postage'`, `cost_class='hard'`, `billable=1`, `recovery_ref=shipmentId`; a redelivery of the same message creates NO second row (dedup on `message.id` + the DB partial-unique); a null-`matter_ref` shipment → no cost row; (policy on) a second `shipping_service_fee` row appears.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `shipping-cost-recovery.ts`: join the shipment row for `matter_ref`, build a `RecoverableChargeEvent` (postage→`pass_through`/`postage`; serviceFee→`platform_fee`/`shipping_service_fee`; `sourceRef`/`idempotencyKey`=shipmentId). `recoverable-charge-consumer.ts`: resolve the per-category policy, `chargeToCaptureInputs`, `captureCost` each through `runIdempotentEffect` (key derived from `${shipmentId}:${category}`), emit `cost.recorded`. Register the per-firm `QUEUE` branch in `index.ts`: resolve firm from `message.firmId`, dispatch on `message.topic`, dedup on `message.id`.
- [ ] **Step 4: Run — expect PASS** (single-file).
- [ ] **Step 5: `vp check` + commit.**

---

## Task 13: OpenAPI snapshot + conformance

**Files:** Regenerate `apps/worker/openapi/openapi.json`; modify `apps/worker/test/conformance.test.ts` (add the `costs.*` operations to the committed-operations list, the `costs → matter` resource binding in `RESOURCE_BY_PERMISSION_NAMESPACE`, any non-mutating read allow-list entry).

- [ ] **Step 1:** `cd apps/worker && pnpm run emit-openapi`. Run `pnpm exec vp test run test/contracts/openapi-snapshot.test.ts` — expect it to now require the snapshot you just emitted (commit it).
- [ ] **Step 2:** Add `costs: "matter"` to `RESOURCE_BY_PERMISSION_NAMESPACE`; add every `costs.*` operationId to the conformance committed-operations enumeration; run `pnpm exec vp test run test/conformance.test.ts` — expect PASS (permissionRegistry / auditedMutating / surfaceConsistency / errorIdCoverage / operationId / chokepointComposition all `[]`).
- [ ] **Step 3:** `pnpm run lint:process-refs` → no leak. `vp check` → 0 errors. Commit (`git add apps/worker/openapi/openapi.json apps/worker/test/conformance.test.ts`).

---

## Task 14: generalize the WIP-ledger + freeze fitness scans

**Files:** Modify `apps/worker/test/timekeeping-wip-ledger-fitness.test.ts` + `timekeeping-freeze-fitness.test.ts` (rename to `billing-wip-ledger-fitness` / `billing-freeze-fitness`); the `vitest.config.ts` `timekeepingPackageSources` virtual-module plugin → also serve `packages/costs/src` + `packages/billing-core/src`.

- [ ] **Step 1:** Extend the `vitest.config.ts` virtual-source plugin to include `packages/costs/src/**` and `packages/billing-core/src/**` (the plugin currently serves `packages/timekeeping/src`). Add a non-vacuity floor for each added source set.
- [ ] **Step 2:** Update both scans to glob the union (worker src + timekeeping + costs + billing-core). The WIP-ledger scan: no timekeeping/costs source writes a `ledger_*` row. The freeze scan: every mutating `cost_entry`/`time_entry` UPDATE carries the `status NOT IN ('billed','void')` guard except the allowlisted billing-lock. Run each single-file → expect PASS (0 offenders, floors satisfied). If a real offender surfaces, STOP and fix the source, do not weaken the scan.
- [ ] **Step 3:** `vp check` + commit.

---

## Task 15: `CostVolume` load profile

**Files:** Modify `packages/fixtures/src/load-profile/profile.ts` (+ bump version, extend `scaleProfile`), add `packages/fixtures/src/load-profile/costs-generate.ts` + `costs-measurements.ts` + `costs-measurements.test.ts`. **Template:** the 3·1 `TimeVolume` + `timekeeping-generate.ts` + `timekeeping-measurements.ts`.

- [ ] **Step 1:** Add `CostVolume` to `LedgerVolumeProfile` (entries per matter, hard/soft mix); bump the profile version; extend `scaleProfile`.
- [ ] **Step 2:** Write the plan-scan test (`EXPLAIN QUERY PLAN` over the per-matter unbilled-cost list `(matter_id, status)` and the consumer's lookups) with an empty allowlist — expect index walks, no full scans. Seed deterministically (no `Date.now`/random).
- [ ] **Step 3:** Implement the generator + measurements; run `pnpm --filter @magna-carta/fixtures test -- costs` → PASS. `vp check` + commit.

---

## Task 16: worker e2e journey

**Files:** Create `apps/worker/test/e2e/slice-3-3-e2e.test.ts`. **Template:** `slice-3-1-e2e.test.ts`.

- [ ] **Step 1: Write the journey** (single-file, OOM-safe): provision firm + matter + a Directory vendor; manual `POST /costs` (hard, billable) → draft; (gate on) submit → approve; a bulk `POST /costs/batch`; attach a receipt; a `shipping.purchased` event with a matter-bound shipment → assert the postage hard disbursement exists (policy off → no service-fee row); flip the `cost.recover_platform_fee.shipping_service_fee` setting on → a fresh shipment → the service-fee row appears; a null-matter shipment → no cost; assert a `billed`-locked cost refuses a PATCH (409). Assert integer amounts + persisted state at each hop.
- [ ] **Step 2: Run — expect RED then drive to GREEN** (`cd apps/worker && pnpm exec vp test run test/e2e/slice-3-3-e2e.test.ts`). If a real defect surfaces, fix the source.
- [ ] **Step 3:** `vp check` + commit.

---

## Task 17: docs — changelog, ADRs, area CLAUDE.md, STATUS/ROADMAP/active-work

**Files:** Create `changelog.d/slice-3-3-costs.md`, four `docs/decisions/pending/*.md` fragments (from design §11), `packages/billing-core/CLAUDE.md`, `packages/costs/CLAUDE.md`. Modify `STATUS.md` (3·3 row), `ROADMAP.md` (3·3 line), `docs/active-work/slice-3-3-costs.md` (→ built). **Convention:** changelog/decisions are FRAGMENTS — never hand-edit the rendered `CHANGELOG.md`/`Decision-Log.md` (assembled on main). Match the 3·1 fragment shapes (`git show main:changelog.d/slice-3-1-time-tracking.md`).

- [ ] **Step 1:** Write the four ADR fragments (billing-core extraction; the recoverable-charge seam + pass_through/platform_fee + the firm→client vs MC→firm boundary; first per-firm queue consumer; the `cost_entry` model). Write the changelog fragment. Write the two area CLAUDE.md files (mirror `packages/timekeeping/CLAUDE.md` — purpose, key files, invariants, gotchas).
- [ ] **Step 2:** Flip the `STATUS.md` 3·3 row + the `ROADMAP.md` 3·3 line to built; update the active-work note. Reference the migration by its generated name.
- [ ] **Step 3: Final gate.** `pnpm check` (fmt+lint+typecheck) clean; `pnpm run lint:process-refs` clean. Commit (`git add changelog.d docs/decisions/pending packages/billing-core/CLAUDE.md packages/costs/CLAUDE.md STATUS.md ROADMAP.md docs/active-work/slice-3-3-costs.md`).

---

## After the build

A final whole-branch adversarial review (the 5-angle pass like 3·1: domain/money, security/tenancy, concurrency/consumer-idempotency, API/contract/chokepoint, tests/fitness) before the main-sync + merge. Then sync `main` (expect a migration re-baseline if main advanced — remember drizzle-kit drops seed data, re-add the `costs:*` seeds + run e2e) and merge.

---

## Self-review

**Spec coverage:** §2 billing-core → Tasks 1–2. §3 cost_entry/schema/reuse → Tasks 3–5. §4 lifecycle/freeze/invariants → Tasks 6, 14. §5 capture surfaces + perms → Tasks 7–9. §6 recoverable-charge seam + recovery policy + shipping producer → Tasks 10–12. §7 first per-firm consumer → Task 12. §8 perms/settings → Tasks 7, 10. §10 testing/load-profile → Tasks 14–16. §11 ADRs → Task 17. All sections covered.

**Placeholder scan:** the mirror-tasks (5–9) reference an exact template `file:line` plus the concrete cost-domain deltas/signatures rather than reproducing the proven 200-line pattern verbatim — this is deliberate (reproducing it risks drift from the live pattern); each still names exact files, the produced signatures, and the test assertions. Novel tasks (1–2, 10–12, the schema) carry complete code.

**Type consistency:** `BillableStatus` (billing-core) aliased to `TimeEntryStatus` in timekeeping; `CostValidationError`/`CostValidationCode`, `CaptureCostInput`, `CostDraftPatch`, `RecoverableChargeEvent`/`Line`, `shouldRecover`, `chargeToCaptureInputs`, `recoverPlatformFeeDefinition` are used consistently across Tasks 4–12. The migration slot is "next after 0021_outgoing_talon" (resolved at generate time, Task 3).

**Ordering note:** Task 4 (the `costEntry` identifier) is referenced by Task 3's schema — land the identifier addition (Task 4 Step 1) before Task 3 Step 1, or fold the identifier into Task 3. Flagged for the implementer.
