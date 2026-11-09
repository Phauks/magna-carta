---
worktree: cloud session (claude/project-thread-ygn1ue)
area: notifications screen as the one grid; restore endpoint for dismissed notifications
status: building
touches: apps/web/src/routes/(app)/notifications, apps/web/src/lib/notifications, packages/notifications, apps/api-worker/src/http/routes/notifications, docs/conventions/design-corrections.md, docs/user/features/your-notifications.md
---

Rebuilds the notifications screen on DataTable.Grid with read and dismissed kept apart, and adds a
restore route. Runs beside the task-screen stream, which owns the grid's group-by work in
packages/design-system; this stream does not touch the design system. Group By on notifications
follows that stream's merge.
