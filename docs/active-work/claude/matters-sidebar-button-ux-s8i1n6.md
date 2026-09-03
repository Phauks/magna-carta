---
worktree: C:/dev/magna-carta-worktrees/claude/matters-sidebar-button-ux-s8i1n6
area: The pane toggle moves to the counts strip on the four ledgers and the file manager, behind one shared component
status: review
touches: apps/web/src/lib/records (pane-toggle.svelte, index.ts), apps/web/src/lib/{time,billing,costs}/*-ledger.svelte, apps/web/src/lib/billing/bill-register.svelte, apps/web/src/lib/file-manager/{file-manager.svelte,file-manager-toolbar.svelte,file-manager-footer.svelte}, apps/web/src/routes/developer-console/pane-toggle-placements, apps/web/src/lib/developer/dev-fixtures.ts, packages/design-system/src/lib/components/button, docs/conventions/{design-corrections.md,file-manager-rulings.md}
---

The four financial ledgers each drew a row above their table whose only occupant, most of the time,
was the details-pane toggle. The candidates were built as real UI first
(`/developer-console/pane-toggle-placements`, which stays as the record of what was weighed); the
owner chose the counts strip's inline end, on every surface including the file manager, with both of
the file manager's toggles kept for now.

Landed: one shared `PaneToggle` in `$lib/records`, used by Time, Fees, Costs, Billing and the file
manager's footer; the ledgers' rows now render only when a filter or Review needs them; the file
manager's toolbar carries neither the create control nor the toggles; every glyph in that footer
stepped down to the new `icon-sm` Button size so one band wears one chrome.

A concurrent stream touching a ledger's action row, the file-manager toolbar or its footer will
collide here.
