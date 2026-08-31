---
worktree: /home/user/magna-carta
area: file manager — carry the owner's Docket artifact corrections into the built surface
status: building
touches: apps/web/src/lib/file-manager, apps/web/src/lib/matters, apps/web/src/lib/time, apps/web/src/routes/(app)/matters, apps/web/src/routes/(app)/conflicts, packages/design-system/src/lib/components/{button,data-table,resizable,folder-tree,record-window,folder-glyph}, packages/file-manager/src, packages/matters/src, packages/timekeeping/src, packages/database/src/per-firm-schema.ts, apps/api-worker/src/routes
---

Carrying the owner's file-manager artifact rulings into apps/web: the Fees section split out of
Billing, the toolbar/footer/sidebar chrome corrections (quiet ghost buttons, square edges, no
grip handles, collapse-in-place panes), the rail's full right-click menu, the Upload dialog that
uploads while the destination is chosen, and the Deleted Files + History views over new
files.listDeleted / files.restore / files.history routes. The same stream carries the Time Sheet
round (the record window's footer verbs, menu and attachment dropzone; rows whose description sits
beneath the fields), and the consultation number: a prospective matter now draws a tentative number
from its own sequence at creation, which added `matter.consultation_number` and
`numbering_scheme.purpose`. Concurrent streams should stay out of apps/web/src/lib/file-manager,
apps/web/src/lib/time, packages/matters/src/numbering and the design-system components named above
until this lands.
