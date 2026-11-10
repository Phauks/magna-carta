---
worktree: cloud session (no local worktree)
area: Indexing and discovery — the record index, then the search surfaces that read it
status: building
touches: packages/search, packages/matter-search, crates/search-core/src/query.rs, apps/api-worker/src/search/matter-file-contents.ts, apps/api-worker/src/http/routes/matters/matter-search.ts, apps/web/src/lib/matters/matter-search-presentation.ts, apps/web/src/lib/matters/sections.ts, tooling/lint-matter-search-coverage, packages/fixtures/src/load-profile/matter-search-measurements.ts, roadmap.d/core-domain.md, docs/specs/2026-11-10-indexing-and-discovery-design.md
---

Building the design in `docs/specs/2026-11-10-indexing-and-discovery-design.md` in its build order.
Steps 1 and 2 are on `main`: the record index (`record_text_entry`, `record_text_fts` and the triggers
on eight source tables, all in one per-firm migration) and matter search reading it for notes, time,
costs, calendar and messaging. In flight now, at the owner's request: matter search reading the file
contents index (a second source on the Files section), then the firm's switch for file indexing.

A stream that **rebuilds** `matter_note`, `time_entry`, `cost_entry`, `matter_event`, `communication`,
`matter_task`, `magnus_conversation` or `magnus_turn` drops that table's index triggers with it and
must recreate them in the same migration (`node packages/search/scripts/render-record-index-migration.mts <source key>`);
`packages/search/test/record-index-lineage.test.ts` fails otherwise. The conflicts stream switches
its content search to the index in its own follow-up and owns `packages/conflicts/src/content-search.ts`.
