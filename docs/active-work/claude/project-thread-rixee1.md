---
worktree: cloud session (no local worktree)
area: Indexing and discovery — the record index, then the search surfaces that read it
status: building
touches: packages/search, packages/matter-search, crates/search-core/src/query.rs, apps/api-worker/src/search/matter-file-contents.ts, apps/api-worker/src/http/routes/matters/matter-search.ts, apps/web/src/lib/matters/matter-search-presentation.ts, apps/web/src/lib/matters/sections.ts, tooling/lint-matter-search-coverage, packages/fixtures/src/load-profile/matter-search-measurements.ts, apps/api-worker/src/http/routes/firm/search-settings.ts, apps/api-worker/src/search/index-backlog.ts, apps/api-worker/src/background/search/reextraction-sweep.ts, apps/web/src/lib/settings/settings-sections.ts, apps/web/src/routes/(app)/settings/search-and-indexing, packages/access-control/src/registry.ts, crates/search-core, crates/address-core/src/schema.rs, packages/object-dimensions/src/dimensions.ts, packages/file-manager/src/queries.ts, apps/api-worker/src/background/search/index-consumer.ts, apps/api-worker/src/search/extracted-text-store.ts, roadmap.d/core-domain.md, docs/specs/2026-11-10-indexing-and-discovery-design.md
---

Building the design in `docs/specs/2026-11-10-indexing-and-discovery-design.md` in its build order.
Steps 1 and 2 are on `main`: the record index (`record_text_entry`, `record_text_fts` and the triggers
on eight source tables, all in one per-firm migration) and matter search reading it for notes, time,
costs, calendar and messaging. Matter search reading the file contents index (a second source on the
Files section) is on `main` too, and so is the firm's switch for file indexing (Settings, Search and
Indexing), and accent folding in the file contents engine (schema generation 2). In flight now:
keeping a matter file's extracted text so a result quotes the passage it matched, which adds an
`extracted-text` object class, a write in the index job before its catalog commit, and one read in
`packages/file-manager/src/queries.ts`. Next: the `SEARCH_SERVICE` binding once the search worker
exists on the account, then the Search and Indexing status screen.

A stream that **rebuilds** `matter_note`, `time_entry`, `cost_entry`, `matter_event`, `communication`,
`matter_task`, `magnus_conversation` or `magnus_turn` drops that table's index triggers with it and
must recreate them in the same migration (`node packages/search/scripts/render-record-index-migration.mts <source key>`);
`packages/search/test/record-index-lineage.test.ts` fails otherwise. The conflicts stream switches
its content search to the index in its own follow-up and owns `packages/conflicts/src/content-search.ts`.
