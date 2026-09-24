---
worktree: /home/user/magna-carta (remote session)
area: Safe website viewer — Live mode, a held isolated browser per member walked page to page
status: review
touches: apps/api-worker/src/routes/safe-browse-live.ts, apps/api-worker/src/safe-browse/, apps/api-worker/wrangler.jsonc, apps/api-worker/src/app.ts, apps/api-worker/src/index.ts, apps/web/src/lib/tools/safe-browse/, apps/web/src/routes/(app)/safe-website-viewer/, packages/safe-browse/src/, docs/user/features/safe-website-viewer.md, roadmap.d/integrations.md
---

The viewer's Live toggle, end to end: a `SafeBrowseSession` Durable Object holding one remote browser
per member, a navigate route that reuses it and guards every hop the browser takes through request
interception, and the toggle that drives it. Adds a Durable Object binding and a migration tag, so a
concurrent stream adding its own Durable Object should take the next tag after `v10`.
