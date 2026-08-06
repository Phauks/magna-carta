# claude/review-campaign-2-financial

**Scope.** Read-only adversarial review of the financial area merged since the first review campaign:
`packages/trust/` (all five slices — foundation, movements, close precondition, two-person
disbursement authorization, reconciliation), `packages/billing/`, `packages/sequence-numbering/`,
their worker routes (`apps/worker/src/routes/trust.ts`,
`apps/worker/src/routes/trust-reconciliation.ts`, `apps/worker/src/routes/billing.ts`), the
statements those packages compose, and their fitness suites. Hunting real defects with consequences:
money correctness, invariant escape hatches, cross-firm and permission binding, the two-person
control, reconciliation honesty, plan quality, redaction.

**Files this stream writes.** Docs only, no source changes:

- `docs/reviews/2026-08-06-campaign-2-financial.md` (new)
- `changelog.d/review-campaign-2-financial.md` (new)
- this note

**Overlap risk.** None expected — the stream touches no file any builder owns. The findings name
source files but do not edit them; fixes are for the owning streams to pick up.
