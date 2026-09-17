---
worktree: /home/user/magna-carta (remote session)
area: The grid's per-column filters — a text column offers its values as a set, and a date filter's calendar stays inside the menu
status: review
touches: packages/design-system/src/lib/components/data-table/, packages/design-system/src/lib/components/context-menu/, packages/design-system/src/lib/components/dropdown-menu/, patches/bits-ui@2.18.1.patch, apps/web/src/lib/file-manager/file-columns.ts, docs/conventions/design-corrections.md, docs/conventions/file-manager-rulings.md
---

The owner's 2026-09-17 note on the tables' filters. Two corrections, both in the platform's one grid
so every surface takes them: a text column's filter is the checkbox set of its values (the grid
model's default flipped; the contains box survives only for a declared prose column), with the one
select control acting on the listed choices when the list is narrowed; and a submenu hosting a field
stays open while the field's own floating layer holds focus, which needed the pinned Bits patch to
also wrap the focus-outside event so `preventDefault()` can be honoured. Touches the two submenu
wrappers, the grid filter, the Bits patch, and the file manager's, upload intake's, conflicts' and
ledgers' column declarations.
