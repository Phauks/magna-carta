---
worktree: C:/dev/magna-carta-worktrees/claude/table-hover-effect-cutoff-7d1qy4
area: The row hover's reach down a table frame, and the gilt scroll-edge hint as one shared component (sidebar + the grid's side edges)
status: building
touches: packages/design-system/src/lib/components/scroll-edge-hint, packages/design-system/src/lib/components/sidebar, packages/design-system/src/lib/components/data-table, packages/design-system/src/lib/styles/components.css, packages/design-system/package.json, changelog.d/
---

Two threads from one owner report. The first is diagnosis: the row hover stops where the records
stop while the framed table surface keeps running to the bottom of the screen, so a table with fewer
rows than frame reads as a table whose hover quit halfway. The second is a build: the sidebar's gilt
scroll-edge rule becomes `ScrollEdgeHint` in the design system, the sidebar moves onto it, and the
grid wears it on its inline edges so a table says there are more columns to the side.

Concurrent streams also in the table: `claude/table-columns-right-click-c15j6y` and
`claude/table-component-consolidation-gp4dpd` (both in review). This stream's only edit inside
`data-table-grid.svelte` is the frame shell around the existing scrollport, and `data-table.css` is
left alone; sequence against those two if either is still open when this lands.
