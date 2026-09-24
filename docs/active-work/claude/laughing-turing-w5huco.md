---
worktree: /home/user/magna-carta
area: Safe Website Viewer — download everything a capture found; measure whether the isolated browser's country can be chosen; then streaming Live
status: building
touches: apps/web/src/lib/tools/safe-browse, apps/web/src/routes/(app)/safe-website-viewer, apps/web/test, apps/api-worker/src/routes, apps/api-worker/src/app.ts, apps/api-worker/test, apps/api-worker/openapi, packages/api-client, docs/user/features/safe-website-viewer.md
---

One download for the screenshot and every fact the inspector panel shows (a ZIP: the PNG, a plain
text report, a JSON record). A diagnostic route, `POST /api/v1/safe-browse/location-probe`, that
reads the rendering service's trace endpoint from a default session, a session launched with a
requested country, and a quick action carrying it — the country picker is built on its answer.
Next on this branch: Live as a streamed, interactive browser rather than a screenshot per step.
