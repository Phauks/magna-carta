---
worktree: C:/dev/magna-carta-worktrees/claude/youthful-franklin-s4n2fw
area: Notification centre UI — the feed screen, the top-bar bell's live badge and popover, and the member's own per-category preference screen, over the already-shipped read and preference APIs
status: building
touches: apps/web/src/lib/notifications, apps/web/src/routes/(app)/notifications, apps/web/src/routes/(app)/settings/notifications, apps/web/src/lib/components/app-shell.svelte, apps/web/src/lib/settings/settings-sections.ts, roadmap.d/notifications.md, status.d, changelog.d, STATUS.md, STATUS.json
---

Builds the two notification surfaces that were `awaiting-screen`: the notification centre feed and
the member's own preference matrix. No server work — `GET /api/v1/notifications`, its unread count,
the three settle routes and `GET/PATCH /api/v1/notifications/preferences` all ship already; this
stream is the client that finally reads them.

The one thing a concurrent stream should not step on: `apps/web/src/lib/components/app-shell.svelte`,
where the bell's placeholder popover becomes a live one, and `settings-sections.ts`, where a
`notifications` section is registered under the user band.
