# claude/discovery-remainder

**Scope.** Discovery 5·1·3, the three pieces PR #272 left: deduplication with occurrence rows,
container families over the guarded archive expansion, and the load manifest + exception report
written to R2 at load completion. Backend and artifacts only — no review surface.

**Files expected to be touched**

- `packages/discovery/src/` — `dedup.ts`, `dedup-statements.ts`, `manifest.ts`,
  `manifest-statements.ts`, `processing-statements.ts`, `types.ts`, `CLAUDE.md`
- `packages/search/src/extraction.ts` — the extraction facts gain the digest set the engine already
  computes in the same pass
- `apps/worker/src/search/text-extraction.ts` — read the digests off the engine's reading
- `apps/worker/src/discovery/` — `process-consumer.ts`, `discovery-process-types.ts`,
  `archive-expansion.ts`, `deduplication.ts`, `load-artifacts.ts`
- `apps/worker/src/index.ts` — the completion message on the existing discovery lane
- `packages/database/` — one additive per-firm migration (dedup primacy index, the exception row's
  load column and its index) plus the drizzle snapshot
- `docs/user/discovery-exception-report.md`, `roadmap.d/discovery.md`, `status.d/`, `changelog.d/`,
  `docs/decisions/pending/`

**Not touched.** `apps/web` (no UI in this slice), `packages/assets` (claude/assets-next owns it),
the search index write pipeline (5·1·4).
