---
worktree: C:/dev/magna-carta-worktrees/claude/hopeful-cannon-tsrczb
area: The left rail's information architecture — five groups, sub-menu clusters, tools as top-level abilities, favorites
status: review
touches: apps/web/src/lib/navigation, apps/web/src/lib/components/app-shell.svelte, apps/web/src/lib/components/drag-reorder.svelte.ts, apps/web/src/lib/screen, apps/web/src/lib/tools, apps/web/src/routes/(app), packages/tools, packages/design-system/src/lib/components/sidebar, roadmap.d, docs/conventions, STATUS.md
---

The owner's navigation round of 2026-09-16, worked end to end. The rail regroups (Favorites, My Desk,
Workspace, Money, Firm, Tools); every tool becomes a top-level ability at `/<id>` and the `/tools`
index is retired; the Tools group folds into subject clusters behind a new sidebar sub-menu part;
Firm Usage leaves the tool catalog for the Firm group; Customize's star becomes an eye and the star
becomes a real favorite, saved from every screen's header. Also in the round: the drag-to-reorder
stutter, the missing grip, and the Soon badge that long labels were clipping.

Anything touching `apps/web/src/lib/navigation`, the app shell, the design-system sidebar, or the
tool catalog will conflict with this stream. The five tool route directories moved out of
`(app)/tools/` to the top level, so a branch adding a screen under `(app)/tools` is building on a
directory that no longer exists.
