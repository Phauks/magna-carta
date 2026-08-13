---
slice: Discovery search index
group: cross-cutting
order: 32
research: done
spec: done
plan: n/a
built: in-progress
ui: todo
load-profile: todo
tested: done
branch: main
active-work:
next: Deploy-gated — `apps/search-worker` (the always-warm Container that range-reads splits from R2 and serves `/index`, `/query`, `/remove`, `/compact`) is the only thing between the parked `deferred` jobs and real hits; the adapter already calls exactly those endpoints, so deploying it needs no code change here. Then the semantic half (Vectorize namespace-per-firm through `InferencePort.embed`; the RRF that fuses it is done), the matter-scoped `/api/v1` route behind a `discovery:search` permission plus its UI (built after the engine, so the route never ships returning engine-not-implemented), and the footer's per-field pruning digest (which reduces the cost of the splits that remain, where compaction reduces how many remain).
link-spec: docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md
link-plan:
adrs:
blocked-by:
---

Tantivy keyword search over immutable per-firm splits in R2 — a split is a self-contained segment bundle plus a footer, so a query prunes on footers and range-reads only the postings it walks, making per-query I/O scale with query selectivity rather than corpus size. Built: the pure-Rust engine core (`crates/search-core`, a read-only `Directory` over a `RangeReader`), the per-firm `index_split` catalog and its data-access statements, the `SearchIndexPort` with typed outcomes, keyword/hybrid query composition with reciprocal rank fusion, and the **write pipeline** — a `SearchIndexJob` Durable Object over a dead-lettered queue that turns each committed document version into one split at a derived, content-addressed key, so a retry converges instead of duplicating. Extraction is composite and decided per page: the document's own text layer is read natively in
`crates/pdf-core` and only the pages that have none go to recognition, with per-page `native`/`ocr`
provenance on the result — which is what makes a born-digital PDF searchable at all, and what lets a
mixed document (a scan appended to a contract) extract both halves. A daily re-extraction sweep
re-enqueues any committed current version the catalog holds no live split for, so documents recorded
unreadable by the earlier recognition-only extractor are repaired without a marker or a migration.
**Compaction** is built: the engine merges many splits into one at segment level (the schema does not
store `body`, so a re-index is not available and a segment merge is both the only option and the cheaper
one), applying the delete set inside the merge so superseded postings leave the published bytes. It is
triggered by a live-split threshold the write path notices in one indexed count, single-flighted per
corpus by a Durable Object, bounded by count and bytes with self-re-enqueue so a large back-catalogue
converges, and backstopped by the daily cron. Publication is object, then one atomic catalog batch, then
nothing: superseded source objects are retired by a later sweep after a grace period, which is what keeps
an in-flight query from ever holding a key to bytes that are gone. A new per-firm `index_split_member`
table records what a merged split covers, so a re-indexed document's stale version is excluded per split
until the next merge repacks it out. The engine also now holds a split open across queries and answers a
ranged multi-split query — the two absences the read-path benchmark named, both of which the benchmark
now measures. Gated per firm by `search.indexing_enabled` (off by default) and enqueued off the clean
ingest commit. Wired-but-dormant in the conversion subsystem's sense: with no engine deployed, a job parks in a distinct `deferred` state — acked and re-startable, never retried into a dead-letter — so deploying the engine drains the backlog naturally and no document is silently dropped meanwhile.
