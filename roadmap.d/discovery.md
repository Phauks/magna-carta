# Discovery (e-discovery)

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Discovery -->

- id: discovery
  name: Discovery
  scope: E-discovery for moderate scale (thousands to tens of thousands of docs per matter) with seams for larger scale; ingest, OCR, index, review, production.
  status: partial
  adrs: ADR-0012, ADR-0060, ADR-0167
  evidence: Engine substrates shipped (OCR engine, PDF redaction/Bates, file hashing); the keyword search index is built and dormant behind an unbound service, its semantic half designed and unbuilt; review and production workflows do not exist.
  audience: public
  public-summary: Load what the other side produced, process it, and work through it at the volumes litigation actually produces.
  notes: The search index has its stateful-service spec (docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md), the design ADR-0167 deferred; the white paper defers several remaining engine questions to the subsystem.

- id: discovery.pipeline
  name: Extraction pipeline
  scope: Ingest to R2, queue-driven extraction/OCR in Containers, then index.
  status: partial
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: The engine, the corpus, and the lane between them — the DISCOVERY_PROCESS queue with its own dead-letter queue, the keyset-paged dispatch walk off the load coordinator's durable cursor (apps/worker/src/discovery/dispatch-processing.ts), and the consumer that ends every document in exactly one terminal state (apps/worker/src/discovery/process-consumer.ts). Deduplication with occurrence rows, container families over the guarded expansion, and the load manifest and exception report are now built too (packages/discovery/src/{dedup,dedup-statements,manifest,manifest-statements}.ts, apps/worker/src/discovery/{deduplication,archive-expansion,load-artifacts}.ts). Only the wiring into the shipped index pipeline is not built.
  notes: The engine is dual-target (native + wasm32) with committed cross-target vectors, so desktop-local processing and the server produce byte-identical passages.

- id: discovery.pipeline.engine
  name: Discovery engine core
  scope: Pure-Rust, I/O-free engine — identify from bytes, native text extraction, the determinism boundary, passage chunking, five-algorithm digests, the near-duplicate fingerprint, guarded archive expansion.
  status: shipped
  surface: internal
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: crates/discovery-core (dual-target, no C-backed feature on any path, asserted by a manifest test) behind containers/discovery + apps/discovery-worker; the passage chunker moved out of packages/search/src/extraction.ts with its corpus.
  notes: Backend only, no user surface. The composite extraction port now routes to it — see discovery.pipeline.extraction-port.

- id: discovery.pipeline.extraction-port
  name: Composite extraction port
  scope: Choosing an extraction engine per document from the bytes — the pure-Rust engine natively, recognition only for pages that are pixels, the office container for a legacy binary — and recording which one ran.
  status: partial
  surface: internal
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: apps/worker/src/search/text-extraction.ts routes through DISCOVERY_SERVICE, falls back to the in-Worker PDF reader plus recognition when it is unbound, and converts a legacy binary through the consented office container before reading the conversion with the memory-safe engine; the route and the recognized-page count land on review_document (20260815T000000_discovery-processing-route) and the per-page provenance in the R2 sidecar.
  notes: Both engine services are deploy-time bindings, so today every non-PDF document parks with its reason on the row rather than being recorded unreadable. Archive expansion is reported as container-not-expanded until the family sub-slice lands.

- id: discovery.pipeline.processing-lane
  name: Processing queue lane
  scope: The dedicated queue that carries one review document at a time off every hot path, and the consumer that ends each one in exactly one terminal state.
  status: partial
  surface: internal
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: The DISCOVERY_PROCESS queue and its dead-letter queue, the keyset-paged dispatch walk in apps/worker/src/discovery/dispatch-processing.ts resuming from the coordinator's durable cursor, and apps/worker/src/discovery/process-consumer.ts writing extracted text and the metadata sidecar to R2, the derived scalars to the row, and a named exception code for every non-success. The remainder is built: deduplication before a byte is read with occurrence rows (apps/worker/src/discovery/deduplication.ts, held by the partial unique index in 20260816T090000_discovery-dedup-and-report), container families over the engine's guarded expansion (apps/worker/src/discovery/archive-expansion.ts), and the manifest and exception report streamed to R2 at load completion (apps/worker/src/discovery/load-artifacts.ts over the pure builders in packages/discovery/src/manifest.ts). Twenty-one cases in apps/worker/test/discovery-process-consumer.test.ts and twenty in packages/discovery/test/{dedup,manifest}.test.ts.
  notes: The lane's own message is a two-kind union — a document, or one load asking for its record artifacts once its last document ends — so a completion never rides inside a document's turn. Enqueuing review documents into the review-set corpus is 5-1-4.

- id: discovery.pipeline.load-record
  name: Load manifest and exception report
  scope: The two records a load produces — what arrived, and every document that could not be read with the named reason for each — written once to R2 in a machine-readable and a printable form.
  status: shipped
  surface: awaiting-screen
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: Pure builders that take the knowledge instant as an argument and read no clock (packages/discovery/src/manifest.ts, proved byte-identical across two renders and source-scanned for a clock in packages/discovery/test/manifest.test.ts); keyset-ordered walks in packages/discovery/src/manifest-statements.ts; the streaming writer and the completion guard in apps/worker/src/discovery/load-artifacts.ts, which refuses to write while the load's counters and its rows disagree. User guide: docs/user/features/discovery-exception-report.md.
  audience: public
  public-summary: Every load produces a record of what arrived and a report naming every document that could not be read, with the reason for each — the document a firm hands to the other side.
  notes: Three deviations from the design are recorded rather than silently taken — three digests rather than five (the shipped row has three columns and no load-file specification asks for the other two), the extraction routes the corpus observed in place of engine version pins (no engine reports a version over its binding yet), and an exception row that may sit on a document whose state is `processed`, which is what a container with encrypted entries actually is.

- id: discovery.pipeline.review-set
  name: Review-set model
  scope: The corpus object — review sets, loads, review documents as pointers, record custodians, occurrences, exceptions, and the load manifest.
  status: partial
  surface: awaiting-screen
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: packages/discovery plus six per-firm tables (20260806T080000_discovery-5-1-2) with the three forward-only state machines as triggers and the reconciliation as a row CHECK; the discovery:\* permission namespace, seventeen routes, and the DiscoveryLoadCoordinator. The occurrence and exception tables are now filled by the processing lane, and the manifest and exception report are written from them at load completion.
  notes: The transcript include/exclude control is a required field with no default on every load declaration, and the scope is stored on the load so the manifest states what the corpus was drawn from. The per-review-set access list is now built and fail-closed (ADR-0270) — no row means no access, the predicate composes into SQL before the LIMIT, and a member not on a list gets 404 rather than 403.

- id: discovery.pipeline.load-lanes
  name: Load source lanes
  scope: Where material comes from — the firm's own matter files, its filed email, a production received from another party, and collection from a client's own system.
  status: partial
  surface: awaiting-screen
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: Both internal lanes resolve a selection into review documents with no byte moved and the version pinned, refusing a quarantined version and a cross-matter selection by name; email enters as a family over the shipped email_attachment links. The received-production lane has its destination and reconciliation; its upload path is the existing quarantine gate unchanged.
  notes: direct-collection is declared and refused BY NAME so its absence is visible rather than mysterious — it needs a collection tool, not an ingest path. Assistant transcripts are likewise refused by name until their lane lands with the review surface.

- id: discovery.ocr
  name: OCR engine
  scope: PaddleOCR PP-OCR models run as ONNX through a Rust ort pipeline, one pinned versioned model set for server Container and desktop.
  status: shipped
  surface: internal
  slices: ocr-engine
  adrs: ADR-0060
  spec: docs/specs/2026-07-09-ocr-engine-design.md
  evidence: crates/ocr-core + containers OCR + apps/ocr-worker with POST /api/v1/ocr; status.d/ocr-engine.md built done.
  notes: UI todo; ocr-raster-cap-and-skip-gate branch in flight; Tesseract/ocrs fallbacks and docTR head-to-head resolve in the future discovery subsystem spec.

- id: discovery.archive-handling
  name: Opaque archive storage
  scope: Uploaded archives stored opaque (versioned, hashed, on the matter); never expanded server-side.
  status: shipped
  adrs: ADR-0027
  evidence: Accepted decision docs/decisions/0027; the ingest pipeline (status.d/2-1) stores uploads unexpanded — opaque by construction.

- id: discovery.archive-handling.contents-indexing
  name: Archive contents in review
  scope: Indexing, reviewing, and producing archive contents via client/desktop-side extraction and re-upload.
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  status: shipped
  surface: internal
  evidence: The engine enumerates and expands an archive under five guards (crates/discovery-core/src/archive.rs) and the discovery processing lane wires that expansion into a real family (apps/worker/src/discovery/archive-expansion.ts): every entry re-enters the ordinary ingest gate by the path email attachments already take, entries become container-child documents of the archive sorted by path, the archive becomes the family head, and every entry the engine described rather than opened becomes a named exception carrying a count and a kind. Expansion is one level per document because the engine already recursed to its own nesting ceiling. Four cases in apps/worker/test/discovery-process-consumer.test.ts. File Manager archives stay opaque.
  notes: A received production arrives as a zip, so a discovery subsystem that cannot open one cannot ingest an external production at all. The narrow exception is scoped to this lane and nowhere else.

- id: discovery.search
  name: Search
  scope: Full-text and semantic search over the discovery corpus.
  status: partial
  adrs: ADR-0012, ADR-0167
  spec: docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md
  evidence: The keyword half is built and dormant — the engine, its ranged reader over real per-firm R2, the worker that owns its container, and the token-guarded object host it reads through — and is measured by crates/search-eval. The semantic half is designed and unbuilt, and reciprocal rank fusion has never executed against real results, so nothing fuses two sets yet. Neither half is reachable: SearchIndexPort resolves to the deferred port until the app worker carries a SEARCH_SERVICE binding.
  audience: public
  public-name: Search across a review set
  public-summary: Search a review set by keyword and by meaning, and narrow it as you go.
  awaiting-owner: Six settings, all reasoned rather than measured, because nothing in the repository can price them until the search container runs against a real corpus. The container's instance size is a guess that mirrors the malware scanner, whose working set is one file where search's is however many splits a firm keeps open — and whether a split cache earns its authorization complexity is the same unmeasured question. Then the four from compaction: the merge thresholds, how long a superseded index object is kept before retirement, whether the search worker gains a compaction endpoint, and ratification of the changed query input shape.

- id: discovery.search.keyword
  name: Tantivy keyword search
  scope: Tantivy (Rust) behind a swappable index interface.
  status: partial
  surface: awaiting-screen
  spec: docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md
  evidence: crates/search-core (pure Rust, tantivy 0.26) has the split format (segment bundle + footer), build→split→query round trip, generation gating, the range-reading directory (a read-only tantivy Directory over a RangeReader seam so a query fetches only the bytes it walks — an instrumented test proves a rare-term query reads under half a split, footer reads touch only the tail), a SplitSearcher that holds a split open across queries (2 warm reads against 40 cold at the smoke tier), a ranged multi-split query, and the COMPACTION merge — a segment-level merge over ranged readers that applies a delete set and repacks, measured by crates/search-eval at 9x fewer ranged reads over 10 splits for the identical hits. The RangeReader's R2 adapter now exists end to end: containers/search wraps the crate in an axum service whose HttpRangeReader issues one HEAD plus exactly one closed-Range GET per engine read, apps/search-worker owns that Container with enableInternet false and intercepts its object calls (outboundByHost) into the app Worker, and apps/worker/src/search/split-object-host.ts verifies a per-operation corpus-scoped HMAC capability token, resolves the firm's bucket through the one home for that decision, refuses an unranged GET outright, and stamps a published split object_class search-split. All unit-tested, including the adapter over a real socket against a recording object host. Still dormant end to end — resolveSearchIndexPort returns the deferred port until SEARCH_SERVICE is bound, so activation is the deploy step in docs/deploy-queue.md. Deferred within the design: the container's warm split cache (a cached searcher would answer from bytes authorized on an earlier call, and its sizing needs a resident corpus) and the footer pruning digest, both within the same format. The app-Worker half of compaction — the threshold trigger, the per-corpus coordinator, the queue consumer, the atomic catalog swap, and the retirement sweep — is built and wired-but-dormant behind the same port.

- id: discovery.search.semantic
  name: Semantic search
  scope: Vectorize-backed semantic search alongside keyword search.
  status: designed
  slices: ai-inference-foundation
  spec: docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md
  evidence: Designed as a per-firm Vectorize namespace (1024-dim bge-large-en-v1.5 via the shipped InferencePort.embed), fused with BM25 by reciprocal rank fusion; ~5M-dim/index ceiling designed against. No discovery embedding/upsert code yet.

- id: discovery.review
  name: Review workflow
  scope: Filter by date/custodian/party/keyword, tag documents, redact, thread email, detect near-duplicates.
  status: partial
  slices: 5-2-discovery-review-workflow
  adrs: ADR-0262
  spec: docs/specs/2026-08-07-discovery-5-2-review-workflow.md
  evidence: Redaction engine shipped; tagging and coding plus the fail-closed per-review-set access list are built API-side (packages/discovery, fourteen routes); filters, threading, near-duplicate surfacing and every review UI are unbuilt.
  audience: public
  public-name: Review and coding
  public-summary: Tag documents for responsiveness and privilege, with each reviewer seeing only the set they have been given.

- id: discovery.review.filters
  name: Review filters
  scope: Filtering the corpus by date, custodian, party, and keyword.
  status: not-started
  evidence: No review UI or query surface exists.

- id: discovery.review.tagging
  name: Tagging and coding
  scope: Responsive/privileged/confidential document tagging, coded per document, with family and bulk as scopes rather than storage.
  status: partial
  surface: awaiting-screen
  slices: 5-2-discovery-review-workflow
  adrs: ADR-0262
  spec: docs/specs/2026-08-07-discovery-5-2-review-workflow.md
  evidence: packages/discovery coding services and statement builders over five per-firm tables (20260808T000000_discovery-review-coding-and-access), fourteen routes; single-choice enforced by a partial unique index, rows never deleted, undo exact to the rows one act wrote.
  notes: Backend only — the coding panel, tag chips and viewer pane are deferred to the owner. Criteria-driven bulk at corpus scale waits on the corpus index read.

- id: discovery.review.redaction
  name: Redaction
  scope: Applied redactions on documents under review.
  status: partial
  surface: awaiting-screen
  slices: pdf-render-engine
  adrs: ADR-0134
  spec: docs/specs/2026-06-22-pdf-slice-2-redaction-design.md
  evidence: PDF redaction engine (rasterize route) shipped in crates/pdf-core; no review-workflow integration.

- id: discovery.review.email-threading
  name: Email threading
  scope: Thread email documents during review.
  status: not-started
  slices: email-core-parse-engine
  evidence: No threading code; the shipped email parse core (crates/email-core) is the substrate it will build on.

- id: discovery.review.near-duplicates
  name: Near-duplicate detection
  scope: Detect near-duplicate documents in the review set.
  status: not-started
  evidence: No similarity/duplicate-detection code for documents.

- id: discovery.production
  name: Production workflow
  scope: Bates numbering, applied redactions, and privilege log with defensibility built in.
  status: partial
  evidence: Bates and hashing engines shipped; no production workflow assembles them.
  audience: public
  public-name: Productions
  public-summary: Produce a set with stamped numbering, the redactions burned in, and a load file the other side can open.

- id: discovery.production.bates
  name: Bates numbering engine
  scope: Bates stamping of produced documents.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0142
  spec: docs/specs/2026-06-23-pdf-bates-numbering-design.md
  evidence: crates/pdf-core/src/bates.rs plus configurability plan (docs/specs/2026-06-25-pdf-bates-configurability-plan.md).
  notes: Engine only; production-set workflow integration pending.

- id: discovery.production.privilege-log
  name: Privilege log
  scope: Privilege log generated from tagged documents in a production.
  status: not-started
  evidence: No privilege-log model or generator exists.

- id: discovery.production.defensibility
  name: Defensibility
  scope: Per-document hashing, content-addressed storage, chain of custody, audit log.
  status: partial
  surface: internal
  slices: file-hash-integrity
  adrs: ADR-0143
  evidence: File hash integrity shipped (packages/file-integrity; user guide docs/user/features/file-hash-integrity.md); chain-of-custody and production audit trail not built.

- id: discovery.scale
  name: Large-scale evolution
  scope: Index sharding, massively parallel OCR, TAR/predictive coding.
  status: deferred
  evidence: White paper marks these deferred but not designed-out.

- id: discovery.desktop-local
  name: Desktop local processing
  scope: Tauri desktop performs local ingest/OCR/indexing for speed, with server fallback.
  status: deferred
  adrs: ADR-0002, ADR-0023
  evidence: Desktop follows the web MVP by decision; OCR engine already compiles native for both targets.
