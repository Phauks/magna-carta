# claude/billing-3-4-2-trust-application

**Scope.** Billing sub-slice 3·4·2, the trust half: applying trust funds to a finalized invoice. The
one application door (`invoice_application` + the `applied_minor` delta), the invoice-backed
satisfier for trust's `EarnedFeePrecondition` — which today refuses every transfer — and the
end-to-end apply-funds service that merges trust's two-linked-entry transfer with the application
into one batch.

**Deliberately out of scope, and staying deferred:** credit notes, client credits, write-offs,
reversals, and the credit-note-after-transfer hard case. The design deferred the last one honestly
(the money is already the firm's, and un-writing it is a firm-funds decision the platform will not
make); this stream keeps it deferred and leaves a seam note rather than half-building it.

**Files expected to be touched**

- `packages/billing/src/application.ts`, `earned-fee.ts`, `apply-trust-funds.ts`, `statements.ts`,
  `types.ts`, `billing-validation.ts`, `fitness.ts`, `queries.ts`, `package.json`, `CLAUDE.md`
- `packages/billing/test/` — new suites, plus the dedicated no-double-credit test
- `packages/database/drizzle/per-firm/20260806T060000_billing-trust-application.sql` (+ journal,
  snapshot), `packages/database/src/per-firm-schema.ts`
- `packages/data-access/src/pii-registry.ts` (the new table's classification)
- `apps/worker/src/per-firm-migrations.ts`, `src/routes/billing.ts`,
  `src/contracts/problem-types.ts`, `test/billing-routes.test.ts`,
  `test/contracts/problem.test.ts`, `openapi/openapi.json`
- `packages/api-client/src/` (regenerated)
- `changelog.d/billing-trust-application.md`, `status.d/3-4-billing-and-invoicing.md`

**Coordination.** Takes journal idx 41, tag `20260806T060000_billing-trust-application`, against the
head `20260806T050000_magnus-conversations` (idx 40). A concurrent stream carrying no migration does
not collide; whichever of two migration-bearing branches merges second retags.

No change to `@magna-carta/trust` — that is the test that the seam is in the right place. Billing
composes no trust statement and reimplements no trust rule.
