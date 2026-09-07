---
worktree: C:/dev/magna-carta-worktrees/claude/file-manager-ui-refinements-50iilv
area: The owner's 2026-09-06 walk — file manager, calendar create control, header hovers, custody register, and the document base every screen inherits
status: review
touches: apps/web/src/lib/file-manager, apps/web/src/lib/calendar, apps/web/src/lib/custodian, apps/web/src/lib/components/app-shell.svelte, apps/web/src/lib/matters/sections.ts, apps/web/src/app.css, apps/web/src/routes/(app)/matters/[id], apps/web/src/routes/(app)/calendar, apps/web/src/routes/(app)/custodian, packages/design-system/src/lib/styles, packages/design-system/src/lib/components/data-table, packages/design-system/src/lib/components/folder-tree, packages/design-system/src/lib/components/tooltip, tooling/lint-matter-create-control, docs/conventions/file-manager-rulings.md, docs/conventions/design-corrections.md
---

Five corrections against the deployed file manager: the toolbar's own search field is gone (one
matter is searched from one place, the matter header), the rail's empty-folder sentence is gone, the
table header menu's display settings moved out of the Columns submenu into the menu's root, the icon
view's settings control moved to the LEFT of the list/icon swapper so the swapper stops moving, and
the breadcrumb's black-in-dark-mode defect is fixed at its root.

That last one reaches every screen, not this one: the document declared no `color-scheme` and no
root text colour, so anything the design system had not explicitly coloured was painted in the
browser's light-mode system colours whatever the theme said. The fix is one new stylesheet,
`packages/design-system/src/lib/styles/base.css`, imported by both the app entry and the catalog
preview — a concurrent stream touching either entry file, or the folder tree's `emptyMessage`
default, or `DataTable.GridHeadMenu`, should expect to meet this branch.

The same walk then took three more: the calendar's create control (a hand-built "Record" dropdown
replaced by the design system's `CreateControl`, reading the bare "New" — which adds
`CREATE_SEVERAL_KINDS` to the matter section registry and widens the create-control gate to walk the
calendar's routes), the top bar's four hover names (which adds a `child` snippet to
`Tooltip.Trigger`), and the custody register's location rail (removed; Location is a column).
