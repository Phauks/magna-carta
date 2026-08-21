---
category: Fixed
audience: internal
---

**Three of the app Worker's path families were reachable only on paper. `assets.run_worker_first`
named `/api/*` and nothing else, so `/wopi/*`, `/search-objects/*` and `/__dev/*` were looked for
among the SPA's static files first, found nothing, and were answered `/index.html` with a 200 by the
single-page-application not-found handling — the handler never ran.**

Workers Static Assets routes asset-server-first: the array is not a list of API prefixes, it is the
list of every top-level family the Worker answers on. The two cookieless surfaces deliberately built
outside `/api` — the editor's WOPI data plane (`apps/worker/src/editing/wopi-host.ts`) and the
keyword engine's ranged-read host (`apps/worker/src/search/split-object-host.ts`) — sat outside it,
as did the local tools demo page. The failure has no shape a caller can read: HTML with a success
status where a document, a byte range or a page was expected.

**The array now names all four families**, and it stays an explicit list rather than inverting to
`run_worker_first: true` with exceptions, because the SPA's own files must keep being served by the
asset server — free, and off this Worker's CPU and invocation count.

**The part that stops it recurring:** `apps/worker/test/worker-first-routing-scan.test.ts` derives
the families from `app.routes` — Hono's live dispatch table, so a family added by a route module, a
plugin, or a bare `app.get` is seen the moment it exists — and fails any path the configured
patterns do not cover. Nothing else could catch it: `SELF.fetch` in the local pool reaches the
Worker without crossing the asset server, so the existing WOPI and split-object request tests pass
either way (verified by re-running them against the old array). The scan reported all three missing
families on its first run against the pre-fix configuration, including the demo page nobody had
noticed was already shadowed.
