# discovery-search-index — handoff

**Branch:** `claude/discovery-search-index` (pushed, merged with `main` @ 645be7a)
**Scope:** the discovery search subsystem — the stateful-service design ADR-0167 deferred, its pure-Rust
engine core, the per-firm split catalog, the port, and the keyword/hybrid query composition. Plus two
searchable-PDF writer placement fixes that search correctness depends on.

## State: wired-but-dormant, green

Everything below is built and tested against a **deferred engine**, the same posture the conversion
subsystem holds: the plumbing is real and proven end to end, and it starts returning real hits when the
engine bindings are deployed. A query today resolves the matter's live splits from the catalog and then
reports `engine-not-implemented` — cleanly, never a crash.

**Verified on this branch:** typecheck clean · search 7 · identifiers 48 · database 114 ·
worker per-firm-migrations 9 + search/hybrid 12 + conformance 25 · pdf-core 249 + search-core 11.

### What exists

| Layer | Where | What it does |
|---|---|---|
| Design | `docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md` + pending ADR | Splits in per-firm R2, footer-pruning + ranged reads, catalog in the firm DO, Vectorize namespace-per-firm, RRF |
| Engine core | `crates/search-core` (Tantivy 0.26, pure Rust) | Build/store/query a **split**; a read-only `Directory` over a `RangeReader` so a query reads only the postings it walks |
| Catalog | `index_split` per-firm table + `@magna-carta/data-access/index-split-statements` | Which splits are live for a matter; insert / list-live / supersede / delete |
| Port | `@magna-carta/search` — `port.ts`, `fusion.ts` | `SearchIndexPort` (index/remove/query), typed outcomes, reciprocal rank fusion |
| Worker | `apps/worker/src/search/` | `resolveSearchIndexPort` (service binding or deferred), `runKeywordSearch` (catalog → engine), `runHybridSearch` (RRF, degrades gracefully) |

### What does not exist yet

- **No write pipeline.** Nothing turns a matter's documents into splits + catalog rows. This is the
  next slice and the only thing blocking real usage.
- **No engine runtime.** `apps/search-worker` (the Container that range-reads splits from R2) is not
  built. Until it is, every query is `engine-not-implemented`.
- **No semantic half.** The Vectorize adapter is a deferred stub (`semantic-search.ts`); the RRF that
  will combine it is done.
- **No API surface.** No route, no permission, no OpenAPI entry, no UI.

## Next steps, in order

### 1. Write pipeline — per-document splits (decided; unblocked)

The owner chose **per-document splits** for idempotency. Concretely:

- Add `document_id` + `version` columns to `index_split` (new per-firm migration + schema + statements).
  One split per document version; the split id is deterministic from `documentId + version`.
- Re-index = delete the document's prior rows/objects, insert the new one, so a retry converges instead
  of duplicating. Compaction merges the many small splits later (the design already anticipates this).
- Extract → build split → `put` to R2 → insert catalog row, driven by a queue consumer off the ingest
  path (the `ConversionJob` DO + `CONVERSION` queue is the shape to copy). Idempotent on
  `documentId + version`; a failure dead-letters and retries — never silently drops a document, which
  would be a defensibility failure.
- The OCR/searchable-PDF work already on `main` is the *extract* half; this wires it to the index.

### 2. `apps/search-worker` — the engine runtime (deploy-gated)

Mirror `apps/scan-worker`: `workers_dev:false`, `preview_urls:false`, reached only by the
`SEARCH_SERVICE` service binding, `enableInternet = false`, owning the Tantivy Container, plus a warm-poke
cron (search is **warm** — its NVMe split cache is the latency layer, unlike scan's spun-per-request).
Implement `RangeReader` over R2 range GETs and expose `/index`, `/query`, `/remove` — the adapter in
`apps/worker/src/search/search-engine.ts` already calls exactly those. Note ADR-0167: only stateless
compute crosses the boundary; the catalog and firm scoping stay in the app Worker.

### 3. Semantic half (deploy-gated)

Vectorize binding + per-firm namespace allocation, embedding through the existing
`InferencePort.embed` (pinned `bge-large-en-v1.5`, 1024-dim). Replace the stub in `semantic-search.ts`;
it drops into `runHybridSearch` unchanged. Design against the ~5M-dimension/index ceiling — namespaces
are mandatory, never one flat index.

### 4. API surface — a core discovery feature, not a tool

A matter-scoped `/api/v1` route through the chokepoint with a **`discovery:search`** permission bound to
`resource: "matter"` (the rule `files:*` follows), the OpenAPI snapshot re-emitted and the API client
regenerated in the same commit, and hits hydrated through the data-access layer into real document rows.
Build it **after** step 2, so the route never ships returning `engine-not-implemented` to a UI. It is not
a registered "tool" (that catalog is for firm-wide file utilities); search is matter-scoped discovery.

### 5. Later

Compaction job (merge small splits, swap the catalog transactionally), deletion/rebuild defensibility
path, and the scale seams (Container sharding, parallel OCR) — all widenings of this design, built when
the load harness measures the moderate-scale shape out of headroom.

## Blocker found on `main` (not this branch)

**The PII-coverage fitness test is red on `main`.** PR #37 (email filing) added 230 lines of email tables
to `per-firm-schema.ts` but never updated `packages/data-access/src/pii-registry.ts`, so
`pii-registry-coverage.test.ts` fails with six unclassified tables: `email_thread`, `email_message`,
`email_matter_link`, `email_participant`, `email_attachment`, `email_capture_address`. This branch
inherits the failure through its merge. Deliberately **not** fixed here — classifying them is a
compliance decision for the email-filing owner (`email_participant` holds data-subject addresses, so it
is very likely `PII_TABLES` with a subject key, not a blanket non-PII entry). Route it to that owner.

## Gotchas for whoever picks this up

- **Do not run `vp check --fix` blind on files using `.sort()`.** The autofix rewrites it to
  `.toSorted()`, which is not in the ES2022 lib several packages pin — it broke typecheck once here.
  The `.sort()` lint finding is a *warning* that `main` also carries; leave it.
- **Migration journal conflicts are routine.** Parallel branches both claim the next `idx`. Keep both
  entries, order by timestamp tag, renumber `idx` monotonically, and add the import + map entry in
  `apps/worker/src/per-firm-migrations.ts`.
- **`drizzle-kit generate` diffs against the tracked baseline snapshot only** (intermediate snapshots are
  not committed), so it emits a migration re-creating every table added since. Take only the new table's
  DDL from its output and hand-write the migration file.
- **A stale container silently breaks workspace imports** (`Cannot find package '@magna-carta/...'`).
  `pnpm install` relinks; re-run it after every `main` merge.
