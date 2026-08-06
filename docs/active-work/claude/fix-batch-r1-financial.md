# claude/fix-batch-r1-financial

**Scope.** Fix batch R1: every finding recorded in
[`docs/reviews/2026-08-06-campaign-2-financial.md`](../reviews/2026-08-06-campaign-2-financial.md)
(3 high, 4 medium, 6 low) — the financial area's trust, billing, and reconciliation surfaces.

The anchor is H1: a matter's trust leaf must derive its client from `matter_party`, the link billing
already treats as canonical, instead of accepting whatever the caller asserted.

**Files expected to touch.**

- `packages/matters/src/matter-party.ts` (new — the one home for the matter→client derivation),
  `packages/matters/package.json`
- `packages/trust/src/` — `account-tree.ts`, `movements.ts`, `transfer.ts`, `statements.ts`,
  `three-way-proof.ts`, `matching.ts`, `statement-import.ts`, `fitness.ts`,
  `trust-validation.ts`, `disbursement-authorization.ts`, `CLAUDE.md`, `test/`
- `packages/billing/src/` — `finalize.ts`, `draft.ts`, `queries.ts`, `statements.ts`, `fitness.ts`,
  `billing-validation.ts`, `package.json`, `test/`
- `apps/worker/src/routes/` — `trust.ts`, `trust-reconciliation.ts`, `billing.ts`
- `apps/worker/openapi/openapi.json`, `packages/api-client/` (regenerated)
- `apps/worker/test/` — `trust-routes.test.ts`, `trust-reconciliation-routes.test.ts`,
  `billing-routes.test.ts`, `trust-authorization-routes.test.ts`, `matter-close-trust.test.ts`
- `changelog.d/fix-batch-r1-financial.md`, `docs/reviews/2026-08-06-campaign-2-financial.md`
  (per-finding status lines)

**No migration.** The fixes are code-level; nothing here adds or alters a per-firm table.
