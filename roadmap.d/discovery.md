# Discovery (e-discovery)

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: discovery
  name: Discovery
  scope: E-discovery for moderate scale (thousands to tens of thousands of docs per matter) with seams for larger scale; ingest, OCR, index, review, production.
  status: partial
  adrs: ADR-0012, ADR-0060
  evidence: Engine substrates shipped (OCR engine, PDF redaction/Bates, file hashing); the discovery pipeline, search, review, and production workflows do not exist.
  notes: No discovery subsystem spec yet; the white paper defers several engine questions to it.

- id: discovery.pipeline
  name: Extraction pipeline
  scope: Ingest to R2, queue-driven extraction/OCR in Containers, then index.
  status: not-started
  evidence: No extraction-to-index pipeline; the generic untrusted-upload ingest pipeline (status.d/2-1) is a substrate, not discovery.
  notes: Upload/scan/R2 storage exists via the file pipeline; nothing feeds an index.

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
  status: deferred
  evidence: White paper marks it deferred but not designed-out; a zip stays an opaque attachment for now.

- id: discovery.search
  name: Search
  scope: Full-text and semantic search over the discovery corpus.
  status: not-started
  evidence: No search index code on the tree.

- id: discovery.search.keyword
  name: Tantivy keyword search
  scope: Tantivy (Rust) behind a swappable index interface.
  status: not-started
  evidence: No Tantivy crate or index code anywhere in packages/, crates/, or apps/.

- id: discovery.search.semantic
  name: Semantic search
  scope: Vectorize-backed semantic search alongside keyword search.
  status: not-started
  slices: ai-inference-foundation
  evidence: No Vectorize/discovery embedding code; packages/inference (AI inference foundation) exists only as a substrate.

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
