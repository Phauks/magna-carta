---
worktree: /home/user/magna-carta (remote session)
area: The tasks screen — the closed work moves below the list, and the search and create control move into the screen header
status: review
touches: apps/web/src/lib/matters/task-list.svelte, apps/web/src/routes/(app)/tasks/+page.svelte, docs/conventions/design-corrections.md, docs/user/features/tasks.md, changelog.d/
---

The owner's correction on the tasks screen: the Done and Cancelled boxes leave the row above the
list, what is closed is asked for below the rows instead, and the search and New Task sit where
every other main screen keeps them.

`TaskList` no longer decides where its own controls sit: it renders them into a `screenHeader`
snippet the host provides, so `/tasks` seats them in its masthead's action row while a matter's
Tasks section keeps drawing the row under its heading. The hand-rolled clear control is replaced by
`DataTable.ClearFilters`, and narrowing is now the search alone.

Concurrent streams: do not edit `apps/web/src/lib/matters/task-list.svelte` or the tasks routes
while this is in flight.
