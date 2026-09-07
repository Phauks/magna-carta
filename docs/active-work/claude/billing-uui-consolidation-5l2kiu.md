---
worktree: C:/dev/magna-carta-worktrees/claude/billing-uui-consolidation-5l2kiu
area: Firm-level Money surfaces — /billing and /costs — consolidated with the matter's Money sections
status: building
touches: apps/web/src/lib/billing, apps/web/src/lib/costs, apps/web/src/lib/money, apps/web/src/lib/navigation/destinations.ts, apps/web/src/routes/(app)/billing, apps/web/src/routes/(app)/costs, apps/api-worker/src/routes/costs.ts, apps/api-worker/src/routes/billing.ts, packages/billing/src/queries.ts, docs/specs, roadmap.d/financial.md, status.d/3-4-billing-and-invoicing.md, changelog.d
---

Billing and Costs become places you can go, and the matter's sections stop being the only home for
either. The sidebar's Billing row is a Soon stub over a listing that already answers firm-wide, and
Costs is not in the sidebar's Money group at all; both matter sections carry ledger machinery no
firm-level surface can reuse because the invoice window and the bill columns require a matter.

This stream decouples that machinery so one component set serves both scopes, adds the firm-wide
cost period listing the contract does not serve yet (the shape `GET /api/v1/time-entries` already
has), and gives the invoice listing the matter filter and the display names the matter tab's own
design registered as gaps 1 and 6.

Concurrent streams: do not edit `apps/web/src/lib/billing/*`, `apps/web/src/lib/costs/*`,
`apps/web/src/lib/money/*`, or the Money group of `destinations.ts` / `sections.ts` while this is in
flight.
