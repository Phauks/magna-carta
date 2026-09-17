---
worktree: /home/user/magna-carta
area: File manager list geometry and scale; the status-change panel; no-reflow inside modals
status: building
touches: packages/design-system/src/lib/components/data-table, apps/web/src/lib/file-manager, apps/web/src/lib/matters, docs/conventions/file-manager-rulings.md, docs/conventions/design-corrections.md, tooling
---

The owner's round of 2026-09-16 on the file manager and two modals. In the list: the row-mark slot
is put back on one line with the cell's content (it was breaking every first cell onto a second
line), the scale control is made to scale the list and not only the icon grid, the last row keeps
its hairline, the File Type column loses its mono face, and Location leaves the browse set. In the
modals: the status-change panel becomes two-sided, and a press inside a modal stops growing the
modal. A source gate is added for that last one, so the pattern cannot come back.
