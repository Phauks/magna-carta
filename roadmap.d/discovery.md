# Discovery (e-discovery)

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: discovery
  name: Discovery
  scope: E-discovery for moderate scale (thousands to tens of thousands of docs per matter) with seams for larger scale; ingest, OCR, index, review, production.
  status: partial
  adrs: ADR-0012, ADR-0060, ADR-0167
  evidence: Engine substrates shipped (OCR engine, PDF redaction/Bates, file hashing); the search index is designed (spec + storage-architecture ADR) but unbuilt; review and production workflows do not exist.
  notes: The search index has its stateful-service spec (docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md), the design ADR-0167 deferred; the white paper defers several remaining engine questions to the subsystem.

- id: discovery.pipeline
  name: Extraction pipeline
  scope: Ingest to R2, queue-driven extraction/OCR in Containers, then index.
  status: partial
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: The engine half is built — crates/discovery-core (identification, native extraction, normalization, chunking, five-algorithm digests, near-duplicate fingerprint, guarded archive expansion) hosted by containers/discovery + apps/discovery-worker — and so is the corpus it produces facts for: the review-set model, the load lanes, and the fan-out coordinator. The queue lane that carries a document from the corpus to the engine, and the wiring into the shipped index pipeline, are not built.
  notes: The engine is dual-target (native + wasm32) with committed cross-target vectors, so desktop-local processing and the server produce byte-identical passages.

- id: discovery.pipeline.engine
  name: Discovery engine core
  scope: Pure-Rust, I/O-free engine — identify from bytes, native text extraction, the determinism boundary, passage chunking, five-algorithm digests, the near-duplicate fingerprint, guarded archive expansion.
  status: shipped
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: crates/discovery-core (dual-target, no C-backed feature on any path, asserted by a manifest test) behind containers/discovery + apps/discovery-worker; the passage chunker moved out of packages/search/src/extraction.ts with its corpus.
  notes: Backend only, no user surface. The composite extraction port that routes to it — and closes the born-digital-PDF gap platform-wide — is a later sub-slice.

- id: discovery.pipeline.review-set
  name: Review-set model
  scope: The corpus object — review sets, loads, review documents as pointers, record custodians, occurrences, exceptions, and the load manifest.
  status: partial
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: packages/discovery plus six per-firm tables (20260806T080000_discovery-5-1-2) with the three forward-only state machines as triggers and the reconciliation as a row CHECK; the discovery:\* permission namespace, seventeen routes, and the DiscoveryLoadCoordinator. The occurrence and exception tables exist and are filled by the processing sub-slice; the manifest and exception report are written there too.
  notes: The transcript include/exclude control is a required field with no default on every load declaration, and the scope is stored on the load so the manifest states what the corpus was drawn from. The per-review-set access list the design recommended is named for the review surface rather than built.

- id: discovery.pipeline.load-lanes
  name: Load source lanes
  scope: Where material comes from — the firm's own matter files, its filed email, a production received from another party, and collection from a client's own system.
  status: partial
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: Both internal lanes resolve a selection into review documents with no byte moved and the version pinned, refusing a quarantined version and a cross-matter selection by name; email enters as a family over the shipped email_attachment links. The received-production lane has its destination and reconciliation; its upload path is the existing quarantine gate unchanged.
  notes: direct-collection is declared and refused BY NAME so its absence is visible rather than mysterious — it needs a collection tool, not an ingest path. Assistant transcripts are likewise refused by name until their lane lands with the review surface.

- id: discovery.ocr
  name: OCR engine
  scope: PaddleOCR PP-OCR models run as ONNX through a Rust ort pipeline, one pinned versioned model set for server Container and desktop.
  status: shipped
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
  status: partial
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: The engine can enumerate and expand an archive under five guards (crates/discovery-core/src/archive.rs) — the narrow exception to the opaque-archive rule, scoped to the discovery load path. Nothing calls it yet; File Manager archives stay opaque.
  notes: A received production arrives as a zip, so a discovery subsystem that cannot open one cannot ingest an external production at all.

- id: discovery.search
  name: Search
  scope: Full-text and semantic search over the discovery corpus.
  status: designed
  adrs: ADR-0012, ADR-0167
  spec: docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md
  evidence: Stateful-service design accepted (index = immutable Tantivy splits in per-firm R2, pruned + range-read from an always-warm search Worker; catalog in the FirmDatabase DO; Vectorize namespace-per-firm; both behind one SearchIndexPort, fused by RRF). No index code on the tree yet.

- id: discovery.search.keyword
  name: Tantivy keyword search
  scope: Tantivy (Rust) behind a swappable index interface.
  status: designed
  spec: docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md
  evidence: crates/search-core (pure Rust, tantivy 0.26) has the split format (segment bundle + footer), build→split→query round trip, multi-split merge, generation gating, AND the range-reading directory — a read-only tantivy Directory over a RangeReader seam so a query fetches only the bytes it walks (an instrumented test proves a rare-term query reads under half a split, footer reads touch only the tail). All unit-tested. Not yet wired to a worker/port/R2 (the RangeReader's R2 adapter is the next slice); the footer pruning digest is deferred within the same format.

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
  evidence: Redaction engine shipped; every review surface and workflow is unbuilt.

- id: discovery.review.filters
  name: Review filters
  scope: Filtering the corpus by date, custodian, party, and keyword.
  status: not-started
  evidence: No review UI or query surface exists.

- id: discovery.review.tagging
  name: Tagging
  scope: Responsive/privileged/confidential document tagging.
  status: not-started
  evidence: No tagging model or UI on the tree.

- id: discovery.review.redaction
  name: Redaction
  scope: Applied redactions on documents under review.
  status: partial
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

- id: discovery.production.bates
  name: Bates numbering engine
  scope: Bates stamping of produced documents.
  status: shipped
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
