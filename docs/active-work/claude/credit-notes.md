---
branch: claude/credit-notes
worktree: .claude/worktrees/credit-notes
area: billing — corrections after finalization (credit notes, client credits, write-offs, reversals) and the contingency shrunk-basis residual
status: building
touches: packages/billing/, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, packages/data-access/src/pii-registry.ts, apps/worker/src/per-firm-migrations.ts, apps/worker/src/routes/billing.ts, apps/worker/src/routes/matters.ts, apps/worker/src/contracts/problem-types.ts, apps/worker/test/, packages/api-client/, docs/user/features/, changelog.d/, docs/decisions/pending/, status.d/3-4-billing-and-invoicing.md, roadmap.d/financial.md
---

The last named gap in the billing spine: a finalized invoice is immutable by trigger, so every
correction after finalization has to be a second permanent record. This stream builds those records
— the credit note and its lines, the client credit a credit note opens when it outruns what is still
unpaid, the write-off, and the reversal of a mistaken application — plus the matter-close block on an
open client credit.

It also closes the **contingency shrunk-basis residual**. The over-billing fitness report sums
finalized contingency fee lines, and a credit note cannot touch an invoice line, so before this
stream the one record that resolves the residual could never clear the report that found it. A
credit-note line may now name the invoice line it corrects, and both the composer's offset and the
fitness report read billed-net-of-credits.

No trust write shape and no trust statement: the reversal of a trust-transfer application is refused
by name, because reversing one would mean composing a trust entry from billing.

Migration taken: `20260813T000000_billing-credit-notes` (idx 56).
