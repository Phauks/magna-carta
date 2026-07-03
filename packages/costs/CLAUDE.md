# @magna-carta/costs — CLAUDE.md

**Purpose.** The disbursement domain module: the per-matter cost work-in-progress (WIP) store + its
shared billing-core lifecycle, plus the generalized recoverable-charge seam (the canonical event a
producer emits and the pure mapping into cost captures). Validates in memory and composes statements
for the caller to commit through `@magna-carta/data-access`'s chokepoint; never runs logic mid-
transaction and never calls external services. Pure services returning `EffectWrite` with an injected
`ClockPort` + `actorUserId` + `randomSource` — no ambient clock/identity/RNG (the timekeeping /
shipment-service shape). Costs are WIP, NOT a ledger posting; a cost converges onto an invoice only at
billing (3·4), and this package never writes the ledger.

**Spec:**
[`docs/specs/2026-06-23-slice-3-3-costs-expenses-design.md`](../../docs/specs/2026-06-23-slice-3-3-costs-expenses-design.md).

## Key files / entry points

- `src/cost-entry-service.ts` — `captureCost` + the lifecycle transitions
  (`submit`/`approve`/`kickBack`/`void`) + receipt attach/detach; the e-billing UTBMS guard lives here.
- `src/cost-entry-statements.ts` — the `cost_entry` SQL (insert, freeze-guarded draft update, guarded
  status transition, kick-back reason, receipt link); the WIP-store shape.
- `src/cost-validation.ts` — `CostValidationError` / `CostValidationCode` (the 409 vocabulary).
- `src/recoverable-charge.ts` — `RecoverableChargeEvent`/`RecoverableChargeLine` + `chargeToCaptureInputs`
  (the pure event → cost-capture mapping; the per-line `recoveryRef` is derived here).
- `src/recovery-policy.ts` — `shouldRecover` + `recoverPlatformFeeDefinition` (the per-category firm
  policy `cost.recover_platform_fee.<category>`, default off).

## Invariants that apply here

- **Integer-minor money, no floats.** `amount_minor` is validated a positive whole number at capture;
  amounts pass through the recoverable-charge mapping unchanged.
- **The column is `disbursement_class`, NEVER `cost_class`.** Renamed to clear the money-naming
  conformance gate. The dotted setting key (`cost.recover_platform_fee.<category>`) is fine — the gate
  is column-name-only.
- **The freeze contract (column-level, not append-only).** On reaching `billed`/`void` a row's
  business columns freeze. Mutating UPDATEs carry a `status NOT IN ('billed','void')` guard (marked
  `fitness:allow-billing-lock` — it excludes frozen rows, it does not target a billing lock) as the
  backstop behind the service's pre-read refusal. Shared with timekeeping via `@magna-carta/billing-core`.
- **`recovery_ref` is the per-line composite `${sourceRef}:${category}`.** It is the idempotency floor
  (a partial-unique DB index on `recovery_ref` alone), so a multi-line event needs a distinct ref per
  line; the mapping assumes at most one line per category per event, and the producer adapters honour it.
- **Phantom-audit pre-read.** Every lifecycle/receipt op pre-reads the current row and throws
  not-found BEFORE composing any effect, so an unknown id can never produce a phantom audit row; the
  audit's `metadata` stays null (no privileged free-text in the shared audit log).
- **`.all()` + `results[0]`, never `.first()`.** The node-sqlite test adapter has no `.first()`.

## Dependencies & contracts

- Depends on `@magna-carta/billing-core` (the lifecycle + freeze + review gate), `@magna-carta/data-access`,
  `@magna-carta/database`, `@magna-carta/identifiers`, `@magna-carta/money`, `zod`. Pure and
  synchronous: produces statements for the caller to run; holds no D1 binding, does no I/O.
- `recoverable-charge.ts` imports `CaptureCostInput` as a TYPE only (`import type`) so it stays a
  runtime leaf — do not turn that into a value import or you create an import cycle with the service.

## Gotchas

- **Recovery captures are EXEMPT from the e-billing UTBMS-required check.** A billable cost on an
  e-billing matter normally needs a UTBMS expense code at capture, but a `source=recovery` line lands
  as uncoded draft WIP instead — dropping it would lose a real fronted disbursement. The coding
  requirement re-enforces at the 3·4 submit/bill gate; do not extend the capture-time check to
  recovered costs.
- **The cost → A/R posting is 3·4; the ledger is NEVER touched here.** No write in this package
  composes a `ledger_*` statement. Costs stay WIP until billing converts them.
- **Per-firm-migrations registration.** A new `cost_entry` migration must be registered in
  `per-firm-migrations.ts` (the per-firm applier reads from there, not the drizzle journal directly).
- **Conformance snapshot regen after route changes.** Cost routes ride the chokepoint with a generated
  OpenAPI snapshot + extended conformance — regenerate and commit the snapshot when a route shape changes.
