---
worktree: C:/dev/magna-carta-worktrees/claude/tasks-spacing-search-inconsistency-7qvxdn
area: The one page inset (Tasks, Time, Magnus) and the task list's search control
status: review
touches: apps/web/src/routes/(app)/tasks, apps/web/src/routes/(app)/time, apps/web/src/routes/(app)/magnus, apps/web/src/lib/matters/task-list.svelte, tooling/lint-page-inset, docs/conventions/design-corrections.md, package.json, vite.config.ts
---

Puts Tasks, Time and Magnus back on the shared page inset — each drew a second `p-24` inside the App
Shell's own — and adds `lint:page-inset` so a fourth screen cannot. It also replaces the task list's
hand-rolled search box with the design system's `ScreenSearch`. The task list is shared by the
member's own work list and the matter's Tasks section, so both screens move together: a concurrent
stream touching either should expect the control row to have been re-ordered into search, create,
clear. The new lint registers itself through `package.json` (the governance job derives its roster
from the `lint:*` scripts) and `vite.config.ts` (the Vitest project list), so a stream editing either
file will overlap here.
