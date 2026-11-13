---
category: Fixed
audience: public
---

**The grid's header right-click menu is owned by the header row, not by each header cell.** Unticking the column whose heading summoned the menu unmounted that cell's `ContextMenu.Root` and closed the menu mid-choice. One menu now hangs off the row (`packages/design-system/src/lib/components/data-table/data-table-grid.svelte`), records which cell was right-clicked, and resolves that column against every column rather than the visible ones, so it stays open through any number of ticks until Escape or a press outside. Once its own column is hidden, the menu offers Show in place of Hide. Pinned by a new step in the DataTableGrid "Columns and pinning" story.

## Public

**A table's Columns list stays open while you choose several columns.** You can tick and untick as many columns as you like, including the one whose heading you right-clicked, and the list closes when you press Escape or click elsewhere.
