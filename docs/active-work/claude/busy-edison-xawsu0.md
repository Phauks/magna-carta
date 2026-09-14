---
worktree: C:/dev/magna-carta-worktrees/claude/busy-edison-xawsu0
area: ScreenSearch on every Workspace screen, and the gate that keeps it there
status: building
touches: apps/web/src/routes/(app)/*, apps/web/src/lib/{calendar,magnus,conflicts,notifications}, apps/api-worker/src/routes/{magnus,conflicts,notifications}.ts, packages/{magnus,conflicts,notifications,data-access}, tooling/lint-workspace-search, package.json, docs/conventions/design-corrections.md
---

Every shipped Workspace destination gets the one screen-search control in its header's action row,
and a new fitness function (`pnpm run lint:workspace-search`) refuses both directions of drift: a
Workspace screen with no answer about searching, and a Workspace screen that hand-rolls a search box
instead of using `ScreenSearch`. Converting the two hand-rolled boxes (Matters, Directory) touches
those two route pages only; the gate is new and collides with nothing.
