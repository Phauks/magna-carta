---
branch: claude/search-write-pipeline
worktree: .claude/worktrees/agent-ac9797e7f7c49571c
area: Discovery search — the write pipeline that turns committed documents into index splits
status: review
touches: packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/20260804T082351_index-split-document-version.sql, packages/database/drizzle/per-firm/meta/_journal.json, packages/database/test/generated-migrations.test.ts, packages/data-access/src/index-split-statements.ts, packages/data-access/src/pii-registry.ts, packages/identifiers/src/generate.ts, packages/search/, packages/file-manager/src/queries.ts, apps/worker/src/search/, apps/worker/src/files/ingest-consumer.ts, apps/worker/src/app.ts, apps/worker/src/index.ts, apps/worker/src/per-firm-migrations.ts, apps/worker/wrangler.jsonc
---

**This branch is stacked on `claude/discovery-search-index`, not on plain `main`.** That branch holds
the read half of the search subsystem — the engine core, the catalog, the port, the keyword/hybrid
composition — and was never merged. It is the direct parent here, with current `main` merged in, so the
pull request carries both halves. Reviewing the write pipeline alone means reading the diff against
`claude/discovery-search-index`.

Builds the half the handoff named as the only thing blocking real search usage besides the deploy-gated
engine: nothing turned documents into splits, so every query resolved an empty catalog. A committed
document version now flows ingest → extract → build → catalog through a `SearchIndexJob` Durable Object
over a dead-lettered `search-index` queue, mirroring the `ConversionJob` + `CONVERSION` shape.

Two decisions carry the design, both about failure rather than the happy path. **Per-document-version
splits with a derived id**: the split id is content-addressed from `documentId + version`, which fixes
its R2 key too, so every attempt at a version writes the same object and replaces the same catalog row —
a retry converges structurally, without anything having to know whether a previous attempt ran. A
partial unique index over the live per-document rows is the backstop; it is partial so the
many-document splits a later compaction publishes are not caught by it. **A deferred engine parks the
job**: neither engine is deployed, and treating `engine-not-implemented` as an ordinary failure would
retry each message until it dead-lettered, turning a scheduling fact into a lost document. `deferred` is
therefore a distinct, acked, re-startable state — deploying the engine and replaying the enqueue drains
the backlog.

Do not step on: the `index_split` schema and its data-access statements (the read half's
`listLiveSplitsForMatter` is unchanged, but the row shape gained `document_id`/`version`), the per-firm
migration journal (this stream adds `20260804T082351_index-split-document-version` after
`20260804T072255_matter-number-allocation`), the `queues` and `durable_objects` blocks plus the DO
migration ledger in `apps/worker/wrangler.jsonc` (a `v4-search-index-job` tag is appended), and the
clean-commit branch of `apps/worker/src/files/ingest-consumer.ts` where the enqueue hangs.

Also fixed in passing: `matter_number_allocation` was added to the per-firm schema by the matter-number
work without a PII-registry classification, leaving `pii-registry-coverage.test.ts` red on `main` itself.
Classified non-PII here (a scope key, the drawn integer, a matter id, a timestamp — no data-subject
column) rather than shipping a knowingly red gate.
