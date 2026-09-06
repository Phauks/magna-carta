---
worktree: C:/dev/magna-carta-worktrees/claude/file-manager-ui-refinements-50iilv
area: File manager — the owner's round-seventeen corrections, plus the document base every screen inherits
status: review
touches: apps/web/src/lib/file-manager, apps/web/src/app.css, apps/web/src/routes/(app)/matters/[id]/files, packages/design-system/src/lib/styles, packages/design-system/src/lib/components/data-table, packages/design-system/src/lib/components/folder-tree, docs/conventions/file-manager-rulings.md, docs/conventions/design-corrections.md
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
