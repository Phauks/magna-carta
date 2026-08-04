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
next: Deploy-gated — `apps/search-worker` (the always-warm Container that range-reads splits from R2 and serves `/index`, `/query`, `/remove`) is the only thing between the parked `deferred` jobs and real hits; the adapter already calls exactly those endpoints, so deploying it needs no code change here. Then the semantic half (Vectorize namespace-per-firm through `InferencePort.embed`; the RRF that fuses it is done), the matter-scoped `/api/v1` route behind a `discovery:search` permission plus its UI (built after the engine, so the route never ships returning engine-not-implemented), and compaction (merge the small per-document splits, swap the catalog). One known extract gap: a born-digital PDF's existing text layer is not read back out — the recognition engine skips such pages — so it records `unextractable` rather than indexing empty; closing it needs `crates/pdf-core`'s `page_text_glyphs` exposed through `packages/pdf`, behind the same `TextExtractionPort`.
link-spec: docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md
link-plan:
adrs:
blocked-by:
---

Tantivy keyword search over immutable per-firm splits in R2 — a split is a self-contained segment bundle plus a footer, so a query prunes on footers and range-reads only the postings it walks, making per-query I/O scale with query selectivity rather than corpus size. Built: the pure-Rust engine core (`crates/search-core`, a read-only `Directory` over a `RangeReader`), the per-firm `index_split` catalog and its data-access statements, the `SearchIndexPort` with typed outcomes, keyword/hybrid query composition with reciprocal rank fusion, and the **write pipeline** — a `SearchIndexJob` Durable Object over a dead-lettered queue that turns each committed document version into one split at a derived, content-addressed key, so a retry converges instead of duplicating. Gated per firm by `search.indexing_enabled` (off by default) and enqueued off the clean ingest commit. Wired-but-dormant in the conversion subsystem's sense: with no engine deployed, a job parks in a distinct `deferred` state — acked and re-startable, never retried into a dead-letter — so deploying the engine drains the backlog naturally and no document is silently dropped meanwhile.
