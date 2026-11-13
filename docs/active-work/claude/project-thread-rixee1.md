---
worktree: cloud session (no local worktree)
area: Indexing and discovery — the record index, then the search surfaces that read it
status: building
touches: packages/search, packages/matter-search, apps/api-worker/src/http/routes/matters/search-across-matters.ts, apps/web/src/routes/(app)/search, apps/web/src/lib/search, apps/web/src/lib/components/command-palette.svelte, crates/search-core/src/query.rs, apps/api-worker/src/search/matter-file-contents.ts, apps/api-worker/src/http/routes/matters/matter-search.ts, apps/web/src/lib/matters/matter-search-presentation.ts, apps/web/src/lib/matters/sections.ts, tooling/lint-matter-search-coverage, packages/fixtures/src/load-profile/matter-search-measurements.ts, apps/api-worker/src/http/routes/firm/search-settings.ts, apps/api-worker/src/search/index-backlog.ts, apps/api-worker/src/background/search/reextraction-sweep.ts, apps/web/src/lib/settings/settings-sections.ts, apps/web/src/routes/(app)/settings/search-and-indexing, packages/access-control/src/registry.ts, crates/search-core, crates/address-core/src/schema.rs, packages/object-dimensions/src/dimensions.ts, packages/file-manager/src/queries.ts, apps/api-worker/src/background/search/index-consumer.ts, apps/api-worker/src/search/extracted-text-store.ts, roadmap.d/core-domain.md, docs/specs/2026-11-10-indexing-and-discovery-design.md, apps/api-worker/src/http/routes/firm/search-status.ts, apps/web/src/lib/settings/components/settings-page.svelte, apps/web/src/lib/settings/components/search-status.svelte, packages/design-system/src/lib/status-register/status-register.ts, apps/api-worker/src/background/costs/recoverable-charge-consumer.ts, apps/api-worker/src/search/record-index-rebuild.ts, apps/web/src/lib/matters/matter-search-results.svelte, apps/web/src/lib/matters/matter-search-api.ts, packages/matters/src/matter-narrowing.ts, packages/matters/src/queries.ts, apps/api-worker/src/http/routes/matters/matter-narrowing-query.ts, apps/api-worker/src/http/routes/matters/matters.ts, apps/web/src/lib/matters/matters-api.ts, apps/api-worker/wrangler.jsonc, apps/api-worker/vitest.config.ts, docs/deploy-queue.md, apps/api-worker/src/conflicts/file-contents-searcher.ts, apps/api-worker/src/conflicts/check-run-executor.ts, packages/conflicts/src/sources.ts
---

Building the design in `docs/specs/2026-11-10-indexing-and-discovery-design.md` in its build order.
Steps 1 and 2 are on `main`: the record index (`record_text_entry`, `record_text_fts` and the triggers
on eight source tables, all in one per-firm migration) and matter search reading it for notes, time,
costs, calendar and messaging. Matter search reading the file contents index (a second source on the
Files section) is on `main` too, and so is the firm's switch for file indexing (Settings, Search and
Indexing), accent folding in the file contents engine (schema generation 2), and the kept text
that lets a file result quote the passage it matched, and the status half of the Search and
Indexing page (`GET /api/v1/firm/search-status`), and the search across matters (`GET /api/v1/search`,
the page at `apps/web/src/routes/(app)/search`, the last row in the top bar's palette), and the
rebuild of a record index place that reads Behind, and the marking of a reader's words in a result
(`titleMarks` and `snippetMarks` on every hit of both searches). In flight now: the reader's
choice of which matters the Search page asks. It adds `mine` and `clientEntityId` to
`GET /api/v1/search` and to `GET /api/v1/matters` (the matters list's query shape moved to
`apps/api-worker/src/http/routes/matters/matter-narrowing-query.ts`, because `matters.ts` may not
grow), declares both narrowings in `packages/matters/src/matter-narrowing.ts`, composes one
inside the visible-matter predicate in `packages/matter-search/src/narrowing.ts`, and adds the
Search In row (`apps/web/src/lib/search/search-reach-control.svelte`). In flight now: the
`SEARCH_SERVICE` binding in `apps/api-worker/wrangler.jsonc`, with a stub for it in the test pool
(`apps/api-worker/vitest.config.ts`). **A test that reads `env` now sees the search service
bound**, to a stub that refuses every operation; a test of the deployment without it passes
`{ ...env, SEARCH_SERVICE: undefined }`. Next: one file indexed and found end to end in
production, and the places a search
across matters does not reach yet.

A stream that adds another way to narrow matters (by location, by matter type) declares it beside
the two in `packages/matters/src/matter-narrowing.ts` as an uncorrelated `IN (SELECT ...)` over an
indexed column, so the search can read the matters it reaches before it asks the index.

A stream that adds a source to the matter search declares its `marking` in the same change: which
rule its title and its excerpt are marked by, or none.
`packages/matter-search/test/source-fitness.test.ts` refuses a source that marks nothing.

A stream that adds a source to the matter search decides, in the same change, whether it answers
across matters: with no `acrossMatters` declaration it is reported as searched inside a matter only,
and `apps/api-worker/test/search-across-matters-routes.test.ts` lists those places by name.

A stream that **rebuilds** `matter_note`, `time_entry`, `cost_entry`, `matter_event`, `communication`,
`matter_task`, `magnus_conversation` or `magnus_turn` drops that table's index triggers with it and
must recreate them in the same migration (`node packages/search/scripts/render-record-index-migration.mts <source key>`);
`packages/search/test/record-index-lineage.test.ts` fails otherwise. The conflicts stream owns
`packages/conflicts/src/content-search.ts`. A stream that starts or stops reading a record index
source updates that source's `readBy` in `packages/search/src/record-index-sources.ts` in the same
change; `packages/search/test/record-index-readers.test.ts` fails otherwise.
