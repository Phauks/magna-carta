---
worktree: C:/dev/magna-carta-worktrees/claude/unified-billing-table-layout-qatnm4
area: one surface for the five money sections, wearing the file manager's frame; the Trust section's first real surface
status: review
touches: apps/web/src/lib/money, apps/web/src/lib/trust, apps/web/src/lib/time/time-ledger.svelte, apps/web/src/lib/costs/cost-ledger.svelte, apps/web/src/lib/billing/bill-register.svelte, apps/web/src/lib/billing/fee-ledger.svelte, apps/web/src/routes/(app)/matters/[id]/{time,fees,costs,billing,trust}, apps/web/src/lib/matters/sections.ts, apps/web/src/lib/activity, docs/conventions/design-corrections.md, roadmap.d/financial.md, docs/user/features
---

Time, Fees, Costs, Billing and Trust render inside one `MoneySurface`: a toolbar strip flush under the
section strip carrying the money sub-parts, the surface's own acts and the view controls; the grid
connected to it; the counts strip on the bottom edge. A layout preference keeps the framed look as the
alternative. Trust gains a ledger built whole against the trust movement record, waiting on a read of
the firm's trust accounts. A concurrent stream should not touch the four financial ledgers' frames or
the matter section pages under Money.
