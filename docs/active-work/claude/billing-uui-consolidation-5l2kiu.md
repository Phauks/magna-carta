---
worktree: C:/dev/magna-carta-worktrees/claude/billing-uui-consolidation-5l2kiu
area: Firm-level Money surfaces — /billing and /costs — consolidated with the matter's Money sections
status: building
touches: apps/web/src/lib/billing, apps/web/src/lib/costs, apps/web/src/lib/money, apps/web/src/lib/records, apps/web/src/lib/matters/cost-api.ts, apps/web/src/lib/time/time-ledger.svelte, apps/web/src/lib/navigation/destinations.ts, apps/web/src/routes/(app)/billing, apps/web/src/routes/(app)/costs, apps/web/src/routes/(app)/fees, apps/web/src/routes/(app)/matters/[id]/fees, apps/api-worker/src/routes/costs.ts, apps/api-worker/src/routes/billing.ts, apps/api-worker/src/routes/fees.ts, packages/billing, packages/fees, packages/database/src/per-firm-schema.ts, docs/specs, roadmap.d/financial.md, status.d/3-3-costs-expenses-disbursements.md, status.d/3-4-billing-and-invoicing.md, changelog.d
---

Billing and Costs become places you can go, and the matter's sections stop being the only home for
either. The sidebar's Billing row is a Soon stub over a listing that already answers firm-wide, and
Costs is not in the sidebar's Money group at all; both matter sections carry ledger machinery no
firm-level surface can reuse because the invoice window and the bill columns require a matter.

This stream decouples that machinery so one component set serves both scopes, adds the firm-wide
cost period listing the contract does not serve yet (the shape `GET /api/v1/time-entries` already
has), and gives the invoice listing the matter filter and the display names the matter tab's own
design registered as gaps 1 and 6.

A second pass closes the gaps the first one left where the fix was a projection rather than a
build: `cost_entry.created_at` and `.created_by` were in the table from the baseline schema and
never reached the wire, so Date Entered and Entered By said "not served" about facts the database
was holding. Both are served now, with the recorder's name resolved by a `member` outer join; the
cost detail read shares the listing's own statement instead of being a third shape; `invoiceId` is
read where the surfaces still claimed it was not; and the bill's address lives once, as `billHref`
in the money surface.

A third pass builds the FEE work-in-progress store, reversing the 2026-08-26 ruling that Fees is not
a work-in-progress surface — the owner's 2026-09-03 removal of the arrangement from that screen took
the ruling's own justification with it. `fee_entry`, `packages/fees`, the fee routes, the claim the
widened `invoice_wip_claim` admits, and the matter's Fees ledger wired to all of it. What Costs and
Fees share is hoisted into `apps/web/src/lib/records/` rather than copied.

Concurrent streams: do not edit `apps/web/src/lib/billing/*`, `apps/web/src/lib/costs/*`,
`apps/web/src/lib/money/*`, `apps/web/src/lib/records/*`, or the Money group of `destinations.ts` / `sections.ts` while this is in
flight.
