# slice-3-5-operating-general-ledger

**Started:** 2026-07-09 · **Stage:** design complete, awaiting owner review (no code yet).

Slice 3·5 — Operating accounting / general ledger. Extends the append-only ledger to the firm's
operating books: chart-of-accounts product, firm-scoped account resolver, posting dimensions,
fiscal-period close, accounts payable, and financial-statement read models.

Design: [`docs/specs/2026-07-09-slice-3-5-operating-general-ledger-design.md`](../specs/2026-07-09-slice-3-5-operating-general-ledger-design.md).

## Files this stream expects to touch

- **New:** `packages/general-ledger/`, `packages/accounting-periods/`
- **Schema:** `packages/database/src/per-firm-schema.ts` — adds columns to `ledger_account` and
  `ledger_line`; new `accounting_lock`, `period_close_event`, `vendor_bill`, `vendor_bill_line`;
  widens the `cost_entry.source` CHECK by one value
- **Migration:** one new per-firm migration (monotonic timestamp identifier)
- **Registries:** `packages/access-control/src/registry.ts`, `packages/identifiers/src/registry.ts`
- **Worker:** new route modules + `app.ts` registration; OpenAPI snapshot + `@magna-carta/api-client`
  regenerated
- **Fixtures:** `packages/fixtures/` — load profile, and the product chart alongside the demo chart
- **Fragments:** `docs/decisions/pending/`, `changelog.d/`, `status.d/`

## Overlap watch

- **`monotonic-migration-ids`** (live worktree) — owns `packages/database/src/migration.ts` and the
  migration generate wrapper. This stream generates a migration, so sync `main` before generating and
  use a monotonic timestamp identifier, never a `00NN` slot.
- **`cost_entry.source` CHECK** belongs to slice 3·3 (merged). Widening it is an expand-contract change
  to a shipped table — flagged deliberately, not incidental.
- **3·2 Trust** (design in progress, no worktree) — shares the new `@magna-carta/accounting-periods`
  leaf and must call `assertPostingAllowed` on its posting path. Co-ordinate before either lands.
- **3·4 Billing** (not started) — consumes `resolveAccount`. This stream landing first is what spares
  3·4 an interim account-resolution seam.

## Housekeeping noticed, not owned by this stream

`docs/active-work/slice-3-3-costs.md` is stale — 3·3 is merged to `main` and has no worktree. Its note
should have been deleted when the branch merged.
