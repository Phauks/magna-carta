---
worktree: /home/user/magna-carta
area: file manager — carry the owner's Docket artifact corrections into the built surface
status: building
touches: apps/web/src/lib/file-manager, apps/web/src/lib/matters, apps/web/src/routes/(app)/matters, packages/design-system/src/lib/components/{button,data-table,resizable,folder-tree}, packages/file-manager/src, apps/api-worker/src/routes
---

Carrying the owner's file-manager artifact rulings into apps/web: the Fees section split out of
Billing, the toolbar/footer/sidebar chrome corrections (quiet ghost buttons, square edges, no
grip handles, collapse-in-place panes), the rail's full right-click menu, the Upload dialog that
uploads while the destination is chosen, and the Deleted Files + History views over new
files.listDeleted / files.restore / files.history routes. Concurrent streams should stay out of
apps/web/src/lib/file-manager and the four design-system components named above until this lands.
