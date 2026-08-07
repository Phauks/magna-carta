---
branch: claude/billing-fee-models
worktree: /home/user/magna-carta/.claude/worktrees/billing-fee-models
area: Billing fee models — arrangements (hourly/flat fee/contingency/retainer), recoveries, retainer replenishment, multi-matter render shape
status: building
touches: packages/billing, packages/database (per-firm schema + migration 0049), packages/identifiers, packages/data-access (pii-registry), apps/worker (billing routes, conformance list, OpenAPI), packages/api-client (regenerated), status.d/3-4-billing-and-invoicing.md, changelog.d/, docs/decisions/pending/, docs/user/features/
---

Builds all four fee models on the shipped invoice spine per the owner's docket direction: the
effective-dated append-only `matter_billing_arrangement` (a fee change is a new version), flat-fee
line composition with zero-amount claims, contingency computed at invoice time from recorded
`matter_recovery` rows, retainer floor status plus `retainer_replenishment_request` records, and the
multi-matter invoice render shape (per-matter pages plus summary, firm's choice) as a column snapshot
at finalize plus the render-model derivation. Migration idx 49, tag 20260807T060000. No new trust
write shapes — trust money still moves only through the existing earned-fee application. A
concurrent stream should not touch packages/billing or the per-firm migration journal.
