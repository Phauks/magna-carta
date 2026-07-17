# Discovery search index — stateful-service design

**Date:** 2026-07-17
**Status:** Draft (approval pending) · Area: `apps/` (new `apps/search-worker`), `packages/search` (new), `crates/search-core` (new)
**Scope:** How the discovery corpus is made searchable at rest — the durable, per-firm **search index** behind both keyword and semantic queries: where the Tantivy index lives, how it is isolated per firm, how it is queried over large corpora without loading whole indexes, how it is written and rebuilt, and how the Vectorize semantic half sits beside it. This is the **stateful-service spec** ADR-0167 defers to by name; it does **not** build the review or production workflows, and it ships no UI.

## Why now

The engine substrates the discovery pipeline stands on are shipped — OCR recognition, the searchable-PDF writer (`crates/pdf-core/src/searchable.rs`), file hashing, ingest-to-R2 — but nothing feeds an index, and there is no index to feed. `roadmap.d/discovery.md` records every `discovery.search.*` node as not-started with the same evidence line: "No Tantivy crate or index code anywhere," "No Vectorize/discovery embedding code." The decision of *what* to build is settled (ADR-0012: Tantivy keyword + Vectorize semantic, full production workflow, large-scale designed-out-but-deferred). The decision of *how the index is stored, isolated, scaled, and rebuilt* is the open gap ADR-0167 names explicitly:

> A subsystem whose state **is** a durable, per-firm dataset fails ⑤ [the statelessness test] and is **not** this pattern. Full-text search (Tantivy) is the example: its index is firm data, not stateless compute; extracting it raises index storage, per-tenant isolation, and rebuild questions that this rubric does not answer. It gets its own spec as a **stateful service** when search is scheduled, and must not be modeled as "scan again."

This is that spec. It exists because "search over large volumes, continuously" is not a compute problem the scan/OCR worker pattern solves — it is a data-at-rest problem: an index is state, and state on Cloudflare means R2 + a coordinator, not a stateless Container.

## Goal

A per-firm, per-matter search index that answers keyword and semantic queries over an e-discovery corpus of **thousands to tens of thousands of documents per matter** (the roadmap's scope) with **sub-second warm latency**, built entirely on the Cloudflare substrate, isolated so no query or index byte crosses firms, rebuildable from source at any time, and with **defensible** deletion (a document removed from the corpus is provably removed from every index). Both index halves sit behind **one swappable `SearchIndexPort`** so keyword and semantic are composable and either engine can be replaced without touching callers.

## Scope

- The **index storage model**: Tantivy indexes as immutable **splits** in per-firm R2, Quickwit-style — footer-metadata pruning + HTTP ranged reads at query time, a warm NVMe cache in the search Container, background compaction of small splits.
- The **`apps/search-worker`** dedicated stateful-service Worker (the shape ADR-0167 defers to): owns the Tantivy Container Durable Object, reached only by service binding, `enableInternet = false`, its own warm-poke cron.
- The **index catalog**: a per-firm record (in the firm's `FirmDatabase` DO lineage) of which splits are live for which matter — the source of truth the query path prunes against and the write path appends to.
- The **write path**: the ingest → OCR → text-extract → build-segment → publish-split pipeline (queue + per-job coordination), from an uploaded document to a live, queryable split.
- The **semantic half**: Vectorize index geometry (namespace-per-firm partition, 1024-dim `bge-large-en-v1.5` via the existing `InferencePort.embed`), and how vector hits and BM25 hits fuse into one ranked result.
- The **`SearchIndexPort`** interface (TypeScript, in the app Worker) and the **`crates/search-core`** Rust crate (the Tantivy schema, segment build, split read) it drives through the Container.
- **Deletion / rebuild / re-index** — the defensibility path: erase a document from every index, rebuild a matter's index from source, re-index after an OCR or schema change.

## Explicitly out of scope

- **The review and production workflows.** Search returns document hits; assembling them into review sets, tagging, privilege logging, and Bates-stamped production are separate slices (`roadmap.d/discovery.md`). This spec stops at "a ranked, firm-scoped hit list with highlight offsets."
- **Massive-scale features** — index **sharding across Containers**, **massively parallel OCR**, TAR/predictive coding (`discovery.search.large-scale`). Named as seams here, built when measured. The single-Container-per-firm model is the moderate-scale target; the split model is chosen precisely because it *extends* to sharding without a rewrite.
- **Desktop-local indexing** (`discovery.desktop`) — the Tauri local-ingest/index accelerator with server fallback. The `SearchIndexPort` is the seam it will implement locally; not built here.
- **Any UI.** No search box, no results page. Query is exercised through the port and the worker route in tests only.
- **Deploy / release.** The worker is specced and buildable; activating it in production (image build, service binding, R2 lifecycle) is a deploy step, not this design.

## Design

### 1. Two indexes, one query surface

Keyword and semantic are different data structures with different homes, unified behind one port so callers never branch on engine:

- **Keyword (Tantivy).** Exact terms, phrases, proximity, boolean, wildcard — the bread-and-butter of e-discovery ("every document mentioning 'indemnify' within 5 words of 'seller'"). BM25-ranked. Tantivy is a Rust library; **Cloudflare hosts nothing for it** — the index is files we store in R2 and query from a Container.
- **Semantic (Vectorize).** Concept match — "documents about environmental liability" catching pages that never use those words. Cosine nearest-neighbour over embeddings. **Vectorize is Cloudflare-managed**; we store vectors, it runs the index.

`SearchIndexPort.query` runs both, fuses the rankings (§7), and returns one list. A caller can request `mode: "keyword" | "semantic" | "hybrid"`; hybrid is the default for corpus search, keyword-only for known-term lookups where recall of exact matches must be perfect.

### 2. Why this is a stateful service, not "scan again"

The scan/OCR Container pattern (ADR-0167) moves **stateless compute** into a dedicated Worker: bytes in, verdict/text out, no firm state resident. Search inverts that. The index **is** firm state — it accumulates over a matter's life, must be isolated per firm, must survive between queries, and must be rebuildable. So the search Worker is a **stateful service**: it owns durable per-firm data (splits in R2, catalog in the firm DO) and a **warm** Container that keeps hot index state resident between queries. Three properties follow, and they are the whole design:

1. **State lives in R2, not the Container.** The Container is a cache/compute layer over R2-resident splits; a cold Container rebuilds its working set from R2, it does not *own* the index. This is what lets the Container scale/restart/shard without data loss.
2. **The Container stays warm.** A cron warm-poke (the ADR-0167 template's `*/20`) keeps one instance and its NVMe split-cache hot, so the common query is a cache hit, not an R2 fetch. Cold-start latency is a first-query tax, not a per-query one.
3. **Isolation is structural, at two layers.** Every split's R2 key is under the firm's prefix, and the catalog the query prunes against is the firm's own `FirmDatabase` DO lineage — a query can only ever name splits its own firm owns. A firm cannot reach another firm's index even by guessing a key, exactly as the bundle-download DO name carries the session firm id.

### 3. The Tantivy index as immutable splits in R2 (the core mechanism)

This is the answer to "scan large amounts of data whenever searches are ongoing." You never load a whole index. The proven pattern (Quickwit's split model, and the `tantivy-object-store` / `object_store`-backed `Directory` approach) maps directly onto R2:

**A split is an immutable, self-contained index shard** — a bundle of Tantivy segment files plus a **footer** (the term dictionary offsets, per-field metadata, and a min/max/time range for the documents inside) — written **once** to R2 as `firms/<firmId>/search/<matterId>/splits/<splitId>.split` and never mutated. New documents produce **new** splits; splits are only ever added, compacted, or deleted whole.

**Write:** a batch of extracted documents is built into one Tantivy segment in the Container's local scratch, packaged as a split, and `put` to R2 (multipart for large splits — never a length-bound single `put`, the same rule the bundle build follows). On success the split is registered in the catalog (§5). Building is off the hot path: it happens in the queue consumer, never in a query.

**Query — pruning + ranged reads, so you read kilobytes of a gigabyte index:**

1. The query names a matter. The catalog returns that matter's live split list (already firm-scoped).
2. For each split, the Container reads the **footer** only (a small ranged GET, or a hit in the warm cache). The footer's term dictionary says whether the query's terms *could* be in this split; splits whose range/terms exclude the query are **pruned without reading their postings at all**.
3. For surviving splits, the Container issues **HTTP range GETs** against R2 for exactly the postings lists and doc-store blocks the query touches — not the whole split. Tantivy's `Directory` abstraction is backed by an R2 range-reader; a `.split` on R2 is queried as if local, fetching only the byte ranges the query walks.
4. Hits merge across splits, BM25-rank, and return with per-hit highlight offsets.

The volume scanned per query is proportional to the **query's selectivity**, not the corpus size. A rare term in a 50k-document matter reads a few footers and a handful of short postings ranges. That is how continuous search over a large, growing corpus stays sub-second: the index grows, the per-query read does not.

**Compaction.** Many small splits (one per ingest batch) slow footer-scan and range-read fan-out. A background job merges small splits into fewer large ones (read splits → build one merged segment → publish new split → atomically swap the catalog → delete the old splits). Compaction is the index's housekeeping; it is a queue job, never on the query path, and because splits are immutable the swap is a catalog pointer flip, safe against concurrent queries (a query mid-flight against an old split still completes; the old split is deleted only after no catalog entry references it).

### 4. The warm cache — sub-second, not just correct

Range-reads against R2 are correct but not sub-second cold. The Container keeps a **local NVMe cache** of hot split footers and recently-read postings, LRU by matter. The warm-poke cron keeps the instance and its cache resident, so the working set of an actively-reviewed matter stays local. R2 is the durable backing store; the NVMe cache is the latency layer. A cache miss costs one R2 round trip; a cache hit costs a local read. This is the standard three-tier shape — managed object store (durable) → Container NVMe (warm) → in-memory footer index (hot) — and it is why the Container is *warm* (ADR-0167 property) rather than spun per request like scan.

### 5. The index catalog — the firm's source of truth

Each firm's `FirmDatabase` DO lineage gains a small **search catalog**: for each matter, the set of live split ids, each split's footer summary (doc count, term-range digest, byte size, created-at), and index generation/schema version. The catalog is the **only** thing the query path trusts to enumerate splits — never an R2 `LIST`, which would be slower and would not carry firm scoping structurally. Writes append a split row; compaction swaps rows transactionally; deletion removes rows and tombstones the split for GC. Because it lives in the firm DO behind the data-access layer (golden rule 3, ADR-0003), no catalog read can name another firm's splits.

### 6. The semantic half — Vectorize geometry

Semantic search reuses the shipped inference substrate: `InferencePort.embed` produces a **1024-dimension** vector via the platform-fixed `@cf/baai/bge-large-en-v1.5` (`packages/inference/src/catalog.ts`), pinned to Vectorize index version 1 — the port's comment already forbids per-firm embedding variation precisely because it would invalidate the index. Document text (chunked per page or per passage — a chunk is the semantic unit, since a whole document exceeds useful embedding context) is embedded at index time and upserted to Vectorize; the query text is embedded at query time and topK-searched.

**Per-firm isolation and capacity.** Vectorize partitions by **namespace**; each firm (or matter, if a firm's corpus is large) gets its own namespace, so a topK query is confined to one firm's vectors — the semantic mirror of the split catalog's structural scoping. Capacity is the constraint to design against, not discover later:

- ~**5M vector-dimensions per index** is the Vectorize ceiling — at 1024 dims/vector that is ~5,000 vectors per *index* before partitioning matters, so **namespaces, not one flat index, are mandatory**, and a very large corpus needs an index-per-firm (or index-per-matter) allocation, not one global index. The exact allocation (namespace-per-matter within a firm index, vs. index-per-firm) is sized against the load-profile fixtures at build; this spec fixes the *shape* (partitioned, never flat) and flags the ceiling.
- ≤**10 KiB metadata/vector** — enough for `{ documentId, matterId, chunkId, page }` to hydrate a hit through the data-access layer; the chunk **text** is not stored in Vectorize (it lives in R2/the keyword doc-store), only the pointer.
- **topK ≤ 100** — the semantic candidate set per query is bounded; fusion (§7) reconciles it with the keyword set.

Vectorize's cost line already exists in `docs/operating-costs.md`; this spec does not change it, only commits to the namespace-partitioned usage.

### 7. Hybrid ranking — reciprocal rank fusion

Keyword and semantic produce two ranked lists over the same documents in incomparable score spaces (BM25 magnitudes vs. cosine similarities). They are combined by **reciprocal rank fusion** (RRF): each document's fused score is the sum over both lists of `1/(k + rank)`, `k` a small constant. RRF needs no score calibration between engines, is robust to one engine returning nothing, and degrades gracefully to whichever engine has signal. The fused list is de-duplicated by `documentId` (a document can hit in both halves), then hydrated through the data-access layer into firm-scoped result rows. Keyword-only and semantic-only modes skip fusion and return the single list.

### 8. The write pipeline — ingest → OCR → extract → index

The index is fed by a queue-driven pipeline, each stage off the hot path, coordinated by a per-document (or per-batch) job — the shape the conversion subsystem already models (`ConversionJob` DO + `CONVERSION` queue):

1. **Ingest** (exists): document lands in R2 via the file pipeline, scanned, version-pinned.
2. **Extract**: text is pulled — a born-digital PDF yields its text layer directly; an image-only page is recognized by the OCR engine and the searchable-PDF writer lays down the invisible text layer (the loop PR #30 closed), so the same extracted text feeds both the searchable artifact and the index. This is why the writer's placement correctness matters to search: the text offsets the index stores must line up with the document.
3. **Index**: extracted text is (a) built into a Tantivy segment → published as a split (§3) and cataloged (§5), and (b) chunked, embedded via `InferencePort.embed`, and upserted to the firm's Vectorize namespace (§6). Both halves reference the same `documentId`.
4. **Report**: the job marks the document searchable; a failure dead-letters and retries, never silently drops a document from discovery (a missing document is a defensibility failure, not a cache miss).

The pipeline is idempotent on `documentId + version`: re-running produces the same split content (deterministic build) and upserts the same vector ids, so a retry or a full re-index converges rather than duplicating.

### 9. Deletion, rebuild, re-index — the defensibility path

E-discovery demands provable state: a document withdrawn from a matter must be provably gone from search, and a matter's index must be reproducible from source.

- **Delete a document**: remove its catalog entry (so no query enumerates its split content for that doc), mark the doc's postings tombstoned, delete its Vectorize vectors by id, and let compaction physically drop tombstoned docs from splits. Because Vectorize deletes by id and the catalog is authoritative, "is it gone?" is answerable, not probabilistic.
- **Rebuild a matter**: splits and vectors are a **derived cache** of documents that durably live in R2. Rebuild drops the matter's splits/namespace and replays the write pipeline from source — the index is never the system of record, so a corrupt or schema-outdated index is always recoverable.
- **Re-index**: an OCR-quality improvement or a Tantivy schema-version bump re-runs extraction/index for affected documents; the index generation in the catalog gates old splits so a query never mixes schema versions.

### 10. Scale seams (deferred, but shaped-in)

The split model is chosen because moderate-scale and large-scale are the *same* design with a bigger fan-out, not a rewrite:

- **Index sharding across Containers** — splits are already independent and location-transparent; sharding is routing split-ranges to multiple Container instances and merging their partial results. The query path (prune → range-read → merge) is unchanged; only the fan-out widens.
- **Massively parallel OCR** — the extract stage is per-document and queue-driven; parallelism is a queue-concurrency knob, not a new pipeline.
- **Desktop-local indexing** — the `SearchIndexPort` is the seam; the Tauri client implements it locally over the same `crates/search-core`, with the server index as fallback (feature parity, golden rule 6).

Each is built when the load-profile harness measures the moderate-scale design running out of headroom (golden rule 10), and each is a **widening** of this design, so building it now would be speculative machinery. What is *not* deferred, and is built up front, is everything that is expensive to retrofit: the split boundary, the catalog, per-firm namespace partitioning, the port seam, and index-generation versioning.

## Interfaces

### `SearchIndexPort` (TypeScript, app Worker)

The single chokepoint every search feature reaches the index through — domain vocabulary, never a vendor's, in the shape of the existing `InferencePort` and `ConversionPort`:

```ts
interface SearchIndexPort {
  // Feed one extracted document into both index halves (idempotent on documentId + version).
  index(input: IndexDocumentInput): Promise<Dispatch<IndexAck>>;
  // Remove a document from both halves; resolves only when catalog + vectors are gone.
  remove(input: RemoveDocumentInput): Promise<Dispatch<RemoveAck>>;
  // Query one matter; mode selects keyword | semantic | hybrid. Returns firm-scoped ranked hits
  // with highlight offsets — never raw split bytes.
  query(input: SearchQueryInput): Promise<Dispatch<SearchHits>>;
}
```

`Dispatch` (the integrations result type `InferencePort` uses) carries an engine failure as a first-class adapter error, never a bare throw. `firmId` and `matterId` ride on every input, read per call through the data-access layer — never on a connection object.

### `crates/search-core` (Rust, in the Container)

Pure, port-free (the pattern `pdf-core` follows — no `firm`/`worker` knowledge): the Tantivy schema definition, `build_segment(docs) -> Split`, `read_split_footer(bytes) -> Footer`, `query_splits(footers, ranged_reader, query) -> Hits`. The Container adapts firm/catalog context around it; the crate only knows Tantivy and bytes. This keeps the memory-safe, untrusted-text parsing in a pure Rust crate (golden rule 14 — Tantivy is pure Rust, no C dependency), unit-testable without Cloudflare.

## Cost

No new subscription. Marginal cost is R2 storage for splits (a derived cache, expirable/rebuildable), R2 Class B operations for range-reads (bounded by query selectivity, not corpus size — the whole point of §3), Vectorize usage (already a line in `docs/operating-costs.md`), Workers AI embedding calls at index time (metered per the inference catalog), and the search Worker's warm instance (one resident instance via the warm-poke cron, the ADR-0167 template's cost). The dominant lever is compaction cadence (fewer, larger splits = fewer range-reads/query = lower Class B), tuned against the load profile.

## Risks & open questions

- **Vectorize allocation at scale** — namespace-per-matter within a firm index vs. index-per-firm: sized at build against fixtures; the ceiling (~5M dims/index) is a hard wall to design against, not discover. **Open:** the exact partition key.
- **Warm-cache eviction under many concurrent matters** — a firm reviewing several large matters at once may thrash the NVMe LRU. Mitigation: cache is per-split-footer (small) first, postings second; sharding (§10) is the escalation. **Open:** cache sizing vs. `instance_type`.
- **Split immutability vs. frequent small edits** — a corpus with constant single-document churn produces many tiny splits; compaction cadence must keep pace. **Open:** compaction trigger (split count vs. age vs. size).
- **Highlight-offset fidelity** — keyword highlight offsets must map back to document positions; this depends on extraction storing text with stable offsets, tied to the searchable-PDF writer's placement correctness (the rotated-page gap in `searchable.rs` is a correctness dependency, not just a display one).
- **`tantivy-object-store` / range-reader maturity** — the R2-backed `Directory` is the load-bearing dependency; if no crate fits cleanly, the Container implements the `Directory` trait over an R2 range-reader directly (a bounded, pure-Rust effort). **Open:** adopt vs. implement.

## Slice plan (design → plan → build order)

1. **This design** → approval → **ADR** for the split-in-R2 storage architecture (the decision ADR-0167 defers; recorded as a `docs/decisions/pending/` fragment).
2. **`crates/search-core`** — Tantivy schema, segment build, split footer read, `query_splits` over an injected range-reader. Pure Rust, fully unit-tested against in-memory splits. (First buildable slice — no Cloudflare needed.)
3. **The R2 `Directory` / range-reader** + split publish/read against real R2 (Miniflare in tests).
4. **The catalog** in the `FirmDatabase` DO + the `SearchIndexPort` keyword path end-to-end.
5. **The Vectorize semantic half** + RRF fusion behind the same port.
6. **The write pipeline** (queue + job coordination) wiring extract → index.
7. **`apps/search-worker`** activation (the dedicated stateful-service Worker, `apps/scan-worker` as template) — deploy step, gated separately.

Steps 2–6 are buildable and testable **without** deploying the worker, the same way the conversion subsystem is fully wired and tested while dormant. UI and production activation are out of this spec.
