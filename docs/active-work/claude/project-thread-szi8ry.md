---
worktree: cloud session (no local worktree)
area: web screen-read caching (session read, matter record, Home route load)
status: review
touches: apps/web/src/lib/matters/matters-api.ts, apps/web/src/lib/matters/matter-record.ts, apps/web/src/lib/access/session-permissions.svelte.ts, apps/web/src/routes/(app)/+layout.ts, apps/web/src/routes/(app)/matters/[id]/+layout.ts, apps/web/src/routes/(app)/home/+page.ts
---

Moves the session read and the matter record onto the one query cache so screens stop paying a serial `/api/v1/me` round trip before their own read. Leaves the calendar route and `src/lib/calendar/` alone for the calendar redesign stream.
