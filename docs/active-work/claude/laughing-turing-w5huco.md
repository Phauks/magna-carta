---
worktree: /home/user/magna-carta
area: Safe Website Viewer — Live streams the remote browser (screencast frames out, pointer and keyboard in), guarded per document for the whole session
status: review
touches: packages/safe-browse/src, apps/api-worker/src/safe-browse, apps/api-worker/src/routes/safe-browse-live.ts, apps/api-worker/src/routes/meetings.ts, apps/api-worker/src/chokepoint, apps/api-worker/src/app.ts, apps/api-worker/test, apps/api-worker/openapi, packages/api-client, apps/web/src/lib/tools/safe-browse, apps/web/src/lib/api/socket-url.ts, apps/web/src/routes/(app)/safe-website-viewer, apps/web/test, docs/specs, docs/decisions/pending, docs/user/features/safe-website-viewer.md, docs/operating-costs.md, docs/Magna-Carta-White-Paper.md, roadmap.d/integrations.md
---

Live mode becomes a stream: the member's session object holds a WebSocket and a CDP connection to
their browser, forwards JPEG screencast frames one at a time, and dispatches their pointer, wheel,
keys and pasted text. Every document request is guarded through CDP's Fetch domain for the whole
session. The per-step navigate route is retired. Next: the country picker, once the location probe
has been run against the deployed service.
