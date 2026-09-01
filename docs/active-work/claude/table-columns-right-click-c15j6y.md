---
worktree: C:/dev/magna-carta-worktrees/claude/table-columns-right-click-c15j6y
area: Every column control (filter, hide, pin, the roster) moves into the column header's own right-click menu
status: review
touches: packages/design-system/src/lib/components/data-table, packages/design-system/src/lib/components/context-menu, packages/design-system/src/stories, apps/web/src/lib/{billing,costs,time,conflicts,custodian,file-manager,tools}, apps/web/src/routes, docs/conventions/design-corrections.md, docs/user/features
---

Every column control moves into the column header's own right-click menu: the per-surface `Columns`
button and the in-header filter funnel are both deleted, replaced by `GridHeadMenu` (filter, hide,
pin, and the Columns roster) which `DataTable.Grid` renders per header cell. The cell keeps only the
filter's mark. `DataTable.GridColumnsMenu` is gone from the design system and the button is deleted
from all twelve call sites. Anything touching
`packages/design-system/src/lib/components/data-table` or a list surface's action row will conflict.
