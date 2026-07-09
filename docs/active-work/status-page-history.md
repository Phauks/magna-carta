# status-page-history

**Scope.** Two changes to the public status page, branched off `main` (which carries the rendered page):

1. Upstream providers no longer set the platform verdict. `overall` is computed from our own components and events; a troubled provider raises a distinct `upstreamAdvisory` surface instead.
2. A 90-day per-component uptime record: a new cron-owned `status:history` KV document (sample-counted daily tallies), rendered as per-component uptime bars, with the past-events archive windowed to the same 90 days.

3. Workers Cache enabled on `apps/status-worker` (the one worker in this repo whose responses are identical for every reader), with every response carrying an explicit `Cache-Control` — a directive-less response is cached under heuristic freshness, and the failure-path fallback is a `200`.

Also introduces `effectiveComponentStatus` — one resolution of probe + override + active-event impact, shared by the published component rows and the history sample.

**Spec:** [`docs/specs/2026-07-09-status-page-history-and-upstream-advisory-design.md`](../specs/2026-07-09-status-page-history-and-upstream-advisory-design.md)

**Files expected to change**

- `packages/status/src/` — `schema.ts`, `merge.ts`, new `history.ts`, `index.ts`, `package.json`
- `packages/status/test/` — `merge.test.ts`, new `history.test.ts`
- `apps/worker/src/status/derived-snapshot.ts` (the cron writes the history document)
- `apps/worker/test/derived-snapshot.test.ts`
- `apps/status-worker/src/` — `index.ts`, `render-status-page.ts`, `page-styles.ts`, `wrangler.jsonc`, `CLAUDE.md`
- `apps/status-worker/test/` — `render-status-page.test.ts`, `status-worker.test.ts`
- `ROADMAP.md` (the service-status entry still called the UI deferred)
- Fragments: `changelog.d/`, `docs/decisions/pending/`, `status.d/service-status.md`

**Overlap watch.** `status.d/service-status.md` is shared with the `service-status-ui` stream; `mergeSnapshot`'s signature gained a `history` parameter, so any other branch calling it must be rebased. The `subject-erasure-orchestrator` branch adds the _Response cache-control_ section to `docs/conventions/security.md` and a cache fitness guard in `apps/worker` — this branch's `apps/status-worker` cache config cites that section by path and depends on it landing, but touches neither file.
