# claude/discovery-processing — discovery 5·1·3, the processing lane

**Scope.** The `DISCOVERY_PROCESS` queue lane and the composite extraction port — sub-slice 5·1·3
tasks 1, 2 and 3 of the discovery ingest-and-processing plan, plus the load-profile measurement the
lane owes. The review-set model, the load lanes, and coding are already on `main`.

**Explicitly not in this stream:** deduplication and occurrence rows, container families, the load
manifest and the exception report artifacts, the review-document index enqueue, semantic indexing,
and every review surface.

## Files expected to change

- `packages/search/src/extraction.ts` — the extraction port's vocabulary (engines, failure codes,
  per-document facts)
- `apps/worker/src/search/text-extraction.ts` — the composite router
- `apps/worker/src/discovery/*` — the process message, the dispatch walk, the consumer
- `apps/worker/src/routes/discovery.ts` — the run-load response gains the dispatch counters
- `apps/worker/wrangler.jsonc`, `apps/worker/src/index.ts`, `apps/worker/src/app.ts` — the lane
- `apps/worker/openapi/openapi.json`, `packages/api-client` — regenerated
- `packages/discovery/src/processing*.ts`, `packages/discovery/src/types.ts`
- `packages/database/drizzle/per-firm/20260815T000000_discovery-processing-route.sql`,
  `packages/database/drizzle/per-firm/meta/_journal.json`,
  `packages/database/src/per-firm-schema.ts`, `apps/worker/src/per-firm-migrations.ts`
- `packages/fixtures/src/load-profile/discovery-generate.ts`,
  `packages/fixtures/src/load-profile/discovery-measurements.ts`, the profile, the baseline
- `roadmap.d/discovery.md`, `status.d/`, `changelog.d/`, `docs/decisions/pending/`,
  `docs/deploy-queue.md`, `docs/user/features/`
