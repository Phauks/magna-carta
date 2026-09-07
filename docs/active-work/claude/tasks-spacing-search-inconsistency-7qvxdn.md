---
worktree: C:/dev/magna-carta-worktrees/claude/tasks-spacing-search-inconsistency-7qvxdn
area: Tasks and Time — page inset, and the task list's search control
status: review
touches: apps/web/src/routes/(app)/tasks, apps/web/src/routes/(app)/time, apps/web/src/lib/matters/task-list.svelte
---

Brings the Tasks and Time screens back onto the shared page inset (both drew a second `p-24` inside
the App Shell's own) and replaces the task list's hand-rolled search box with the design system's
`ScreenSearch`. The task list is shared by the member's own work list and the matter's Tasks
section, so both screens move together — a concurrent stream touching either should expect the
control row to have been re-ordered into search, create, clear.
