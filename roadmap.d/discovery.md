# Discovery (e-discovery)

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Discovery -->

- id: discovery
  name: Discovery
  scope: E-discovery for moderate scale (thousands to tens of thousands of docs per matter) with seams for larger scale; ingest, OCR, index, review, production.
  status: partial
  adrs: ADR-0012, ADR-0060, ADR-0167
  evidence: Engine substrates shipped (OCR engine, PDF redaction/Bates, file hashing). Ingest and processing are complete end to end and a review set is now its own search corpus; the keyword index and the discovery engine are both built and dormant behind unbound services. THE SURFACE IS BUILT THROUGH READING — the matter's Discovery section, the firm-wide register scoped by the access list rather than by matter access, the review workspace with its document list and its loads, and the reviewer: a queue over whatever the list was narrowed to, the extracted text served behind the access list rather than behind file permissions, and a panel stack whose first three panels are the document's facts and digests, its family, and the other copies of it the corpus holds. So a firm can now create a corpus, name its Custodians of Record, declare a load, put the matter's own files in it with no byte moved, watch every document reach a terminal state, read any of them, and download the manifest and the exception report. Tagging and coding are still built API-side with no screens. The semantic half is deferred on an open owner flag, and production — Bates, rendering, load files, the privilege log — does not exist.
  audience: public
  public-summary: Load what the other side produced, process it, and work through it at the volumes litigation actually produces.
  notes: The search index has its stateful-service spec (docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md), the design ADR-0167 deferred; the white paper defers several remaining engine questions to the subsystem.

- id: discovery.pipeline
  name: Extraction pipeline
  scope: Ingest to R2, queue-driven extraction/OCR in Containers, then index.
  status: shipped
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: The engine, the corpus, and the lane between them — the DISCOVERY_PROCESS queue with its own dead-letter queue, the keyset-paged dispatch walk off the load coordinator's durable cursor (apps/api-worker/src/discovery/dispatch-processing.ts), and the consumer that ends every document in exactly one terminal state (apps/api-worker/src/discovery/process-consumer.ts). Deduplication with occurrence rows, container families over the guarded expansion, and the load manifest and exception report are built (packages/discovery/src/{dedup,dedup-statements,manifest,manifest-statements}.ts, apps/api-worker/src/discovery/{deduplication,archive-expansion,load-artifacts}.ts), and a processed document now enters its review set's own search corpus through the shipped index pipeline (apps/api-worker/src/search/enqueue-index.ts). The pipeline is complete end to end; what it produces is dormant only because no engine is deployed.
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
  evidence: apps/api-worker/src/search/text-extraction.ts routes through DISCOVERY_SERVICE, falls back to the in-Worker PDF reader plus recognition when it is unbound, and converts a legacy binary through the consented office container before reading the conversion with the memory-safe engine; the route and the recognized-page count land on review_document (20260815T000000_discovery-processing-route) and the per-page provenance in the R2 sidecar.
  notes: Both engine services are deploy-time bindings, so today every non-PDF document parks with its reason on the row rather than being recorded unreadable. An archive is no longer refused wholesale: the processing lane expands it into a family (see discovery.archive-handling.contents-indexing), and container-not-expanded is now raised only for entries the engine described rather than opened — one exception per kind, carrying a count and never a path.

- id: discovery.pipeline.processing-lane
  name: Processing queue lane
  scope: The dedicated queue that carries one review document at a time off every hot path, and the consumer that ends each one in exactly one terminal state.
  status: shipped
  surface: internal
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: The DISCOVERY_PROCESS queue and its dead-letter queue, the keyset-paged dispatch walk in apps/api-worker/src/discovery/dispatch-processing.ts resuming from the coordinator's durable cursor, and apps/api-worker/src/discovery/process-consumer.ts writing extracted text and the metadata sidecar to R2, the derived scalars to the row, and a named exception code for every non-success. The remainder is built: deduplication before a byte is read with occurrence rows (apps/api-worker/src/discovery/deduplication.ts, held by the partial unique index in 20260816T090000_discovery-dedup-and-report), container families over the engine's guarded expansion (apps/api-worker/src/discovery/archive-expansion.ts), and the manifest and exception report streamed to R2 at load completion (apps/api-worker/src/discovery/load-artifacts.ts over the pure builders in packages/discovery/src/manifest.ts). Twenty-one cases in apps/api-worker/test/discovery-process-consumer.test.ts and twenty in packages/discovery/test/{dedup,manifest}.test.ts.
  notes: The lane's own message is a two-kind union — a document, or one load asking for its record artifacts once its last document ends — so a completion never rides inside a document's turn. A processed document is handed to the index enqueue at the end of its turn, best-effort, because the row and both derived objects are already committed by then.

- id: discovery.pipeline.load-record
  name: Load manifest and exception report
  scope: The two records a load produces — what arrived, and every document that could not be read with the named reason for each — written once to R2 in a machine-readable and a printable form.
  status: shipped
  surface: screen
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: Reachable since the discovery surface landed — GET /api/v1/loads/{loadId}/artifacts/{artifact} presigns either record in the machine-readable or the printable form, audited as an export and access-scoped through the review set's own list, offered from each load on the workspace's Loads screen. Pure builders that take the knowledge instant as an argument and read no clock (packages/discovery/src/manifest.ts, proved byte-identical across two renders and source-scanned for a clock in packages/discovery/test/manifest.test.ts); keyset-ordered walks in packages/discovery/src/manifest-statements.ts; the streaming writer and the completion guard in apps/api-worker/src/discovery/load-artifacts.ts, which refuses to write while the load's counters and its rows disagree. User guide: docs/user/features/discovery-exception-report.md.
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
  evidence: packages/discovery plus six per-firm tables (20260806T080000_discovery-5-1-2) with the three forward-only state machines as triggers and the reconciliation as a row CHECK; the discovery:\* permission namespace, thirty routes, and the DiscoveryLoadCoordinator. The occurrence and exception tables are now filled by the processing lane, and the manifest and exception report are written from them at load completion.
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
  evidence: The engine enumerates and expands an archive under five guards (crates/discovery-core/src/archive.rs) and the discovery processing lane wires that expansion into a real family (apps/api-worker/src/discovery/archive-expansion.ts): every entry re-enters the ordinary ingest gate by the path email attachments already take, entries become container-child documents of the archive sorted by path, the archive becomes the family head, and every entry the engine described rather than opened becomes a named exception carrying a count and a kind. Expansion is one level per document because the engine already recursed to its own nesting ceiling. Four cases in apps/api-worker/test/discovery-process-consumer.test.ts. The File Manager reaches into an archive on its own separate terms - it lists any of four formats from headers alone and takes a named member out of a zip - and neither happens on arrival, which is what this lane's exception was scoped against.
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
  evidence: crates/search-core (pure Rust, tantivy 0.26) has the split format (segment bundle + footer), build→split→query round trip, generation gating, the range-reading directory (a read-only tantivy Directory over a RangeReader seam so a query fetches only the bytes it walks — an instrumented test proves a rare-term query reads under half a split, footer reads touch only the tail), a SplitSearcher that holds a split open across queries (2 warm reads against 40 cold at the smoke tier), a ranged multi-split query, and the COMPACTION merge — a segment-level merge over ranged readers that applies a delete set and repacks, measured by crates/search-eval at 9x fewer ranged reads over 10 splits for the identical hits. The RangeReader's R2 adapter now exists end to end: containers/search wraps the crate in an axum service whose HttpRangeReader issues one HEAD plus exactly one closed-Range GET per engine read, apps/search-worker owns that Container with enableInternet false and intercepts its object calls (outboundByHost) into the app Worker, and apps/api-worker/src/search/split-object-host.ts verifies a per-operation corpus-scoped HMAC capability token, resolves the firm's bucket through the one home for that decision, refuses an unranged GET outright, and stamps a published split object_class search-split. All unit-tested, including the adapter over a real socket against a recording object host. Still dormant end to end — resolveSearchIndexPort returns the deferred port until SEARCH_SERVICE is bound, so activation is the deploy step in docs/deploy-queue.md. Deferred within the design: the container's warm split cache (a cached searcher would answer from bytes authorized on an earlier call, and its sizing needs a resident corpus) and the footer pruning digest, both within the same format. The app-Worker half of compaction — the threshold trigger, the per-corpus coordinator, the queue consumer, the atomic catalog swap, and the retirement sweep — is built and wired-but-dormant behind the same port.

- id: discovery.search.corpus-index
  name: Review-set corpus indexing
  scope: A review set as its own search corpus — its own split prefix, its own catalog rows, its own wholesale deletion — and the enqueue that puts a processed review document into it.
  status: shipped
  surface: internal
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  adrs: ADR-0247
  evidence: The index scope key is a corpus everywhere including the catalog — index_split gains corpus_kind and corpus_id (20260819T000000_index-split-corpus-scope) and every scope read in packages/data-access/src/index-split-statements.ts matches on the corpus, so a matter query is structurally unable to name a review set's splits (packages/data-access/test/index-split-corpus-scope.test.ts). enqueueReviewDocumentForIndexing in apps/api-worker/src/search/enqueue-index.ts runs through the same coordinator and the same consumer as the version-keyed enqueue, indexing only the primary of a duplicate group and reading the text the discovery engine already extracted rather than re-parsing an opposing party's bytes. Where a document stands with the index is on its own row (review_document.index_state), so an unindexed document is countable from the corpus rather than only from a Durable Object.
  notes: Dormant like the rest of the index — with no SEARCH_SERVICE binding every document parks deferred and a later replay drains it into the same derived split, which is what apps/api-worker/test/discovery-corpus-index.test.ts exercises. A review set never feeds the natural-language corpus: that surface's audience is the matter team, and a review set's access list is narrower.

- id: discovery.search.semantic
  name: Semantic search
  scope: Vectorize-backed semantic search alongside keyword search.
  status: designed
  slices: ai-inference-foundation
  spec: docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md
  evidence: Designed as a per-firm Vectorize namespace (1024-dim bge-large-en-v1.5 via the shipped InferencePort.embed), fused with BM25 by reciprocal rank fusion; ~5M-dim/index ceiling designed against. No discovery embedding/upsert code yet, and review_set.semantic_index_enabled is a flag nothing reads.
  awaiting-owner: Whether the semantic half is built for review sets at all, and if so on what trigger. It is DEFERRED rather than undecided-by-neglect — the cost side is now priced (a queried Vectorize index bills the resident corpus once a month at twenty times the storage rate, so a 250,000-document review set is roughly 490 times the keyword half's marginal cost, plus a one-time embedding charge of $261 to $522 per review set), and the recall side has never been measured on legal prose with relevance judgements, which is the only thing that would justify it. The experiment that settles it is specified in full in docs/research/2026-08-14-semantic-half-convergence-and-cost.md and is blocked on acquiring a judged corpus, not on building anything. Until it is answered the per-review-set flag stays a column nothing reads: turning it on would embed a corpus on a guess, and the embedding model pin is unchangeable once one vector exists.

- id: discovery.review
  name: Review workflow
  scope: Filter by date/custodian/party/keyword, tag documents, redact, thread email, detect near-duplicates.
  status: partial
  slices: 5-2-discovery-review-workflow
  adrs: ADR-0262
  spec: docs/specs/2026-08-07-discovery-5-2-review-workflow.md
  evidence: Redaction engine shipped; tagging and coding plus the fail-closed per-review-set access list are built API-side (packages/discovery, fourteen routes). The reviewer's shell is now built — the queue over the narrowed corpus, the extracted-text pane behind the access list rather than behind file permissions, and a panel registry whose three reading panels ship (facts and digests, family, other copies) and whose five writing ones render disabled with what each waits on — so the coding panel is one entry and one component. Threading and near-duplicate surfacing are unbuilt.
  audience: public
  public-name: Review and coding
  public-summary: Tag documents for responsiveness and privilege, with each reviewer seeing only the set they have been given.
  awaiting-owner: Three, and the first two gate the next sub-slice outright. P1 — does privilege coding require its own permission tier, separate from ordinary coding? P3 — what is the default when a privilege designation splits a document family, produce the rest or withhold the family? Both decide what reaches opposing counsel and where waiver risk sits, and 5·2·2 privilege review cannot start until they are answered. (P2 and P4 are production-side and gate 5·2·3, not this slice.) Third, and separate: the per-review-set access list can be emptied and there is NO WAY BACK. The grant route is itself behind the wall (apps/api-worker/src/routes/discovery/discovery-coding.ts checks memberHasReviewSetAccess before grantReviewSetAccess) and the list is seeded once at creation with the creating member alone, so if the last listed member leaves the firm or is revoked the review set is permanently unreachable — nobody can read it, nobody can close it, nobody can grant access back, and there is no Owner bypass and no operator override. On a corpus under a protective order that is material a firm may be obliged to produce and cannot open. It is deliberately an owner question rather than a fix, because every escape hatch weakens the exact property the design chose — that no role sees through the wall. The narrowest option is probably refusing to revoke the LAST member on a list, which keeps the wall intact and only forbids emptying it; it is not built.

- id: discovery.review.document-list
  name: Review-document list read
  scope: The paged, filtered read of a review set's documents that every review surface sits on, plus the live exception surface, the occurrences a suppressed copy stays reachable through, and what the corpus still owes the index.
  status: shipped
  surface: screen
  slices: 5-1-discovery-ingest-and-processing
  spec: docs/specs/2026-08-05-discovery-5-1-design.md
  evidence: packages/discovery/src/review-reads.ts and four routes in apps/api-worker/src/routes/discovery/discovery-review-reads.ts, filtered by Custodian of Record, load, family, processing state and exception code. Keyset-paged over (sort_date, id) in two segments so the documents a production gave no date for are last and still reachable, with a row-value comparison rather than the equivalent OR — measured at 0.26 ms per page against 10.3 ms for the OR form at the 250,000-document ceiling (packages/fixtures/src/load-profile/discovery-measurements.ts). Every builder composes the review-set access predicate in SQL ahead of the LIMIT, proved for all nine from the same table-driven pass the coding reads use.
  notes: The list and its five filters now have their screen (the review workspace's Documents), rendered from the narrowing registry in apps/web/src/lib/discovery/criteria.ts so a sixth narrowing is an entry rather than a control change, and the same read is the reviewer's queue. The occurrences read has its panel; the live exception surface still has no screen of its own, because it is a narrowing rather than a destination. This read is what 5-2-1 begins on.

- id: discovery.review.filters
  name: Review filters
  scope: Filtering the corpus by date, custodian, party, and keyword.
  status: partial
  surface: awaiting-screen
  slices: 5-1-discovery-ingest-and-processing
  evidence: Five filters are built into the list read (Custodian of Record, load, family, processing state, exception code) and each has its own sort-bearing index so the page never falls to a temporary b-tree, and all five are now reachable from the workspace's one narrowing control, which is also the queue the reviewer walks. Date and keyword are not: date is the read's ORDER BY rather than a filter, and keyword narrowing waits on the search engine being deployed. Both are declared in the narrowing registry and render visible and disabled with what each waits on, so lighting keyword up is a binding plus a stage flip rather than a change to the control.

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
  evidence: No threading code and no surface. Two shipped substrates it builds on: the email parse core (crates/email-core) and the email_thread table the filing lane already populates.

- id: discovery.review.near-duplicates
  name: Near-duplicate detection
  scope: Detect near-duplicate documents in the review set.
  status: designed
  slices: 5-2-discovery-review-workflow
  spec: docs/specs/2026-08-07-discovery-5-2-review-workflow.md
  evidence: No clustering, no threshold, and no surface. The SUBSTRATE is shipped and populated: the engine computes a SimHash-over-shingles fingerprint (crates/discovery-core/src/fingerprint.rs) and the processing lane stores it on every processed document as review_document.text_fingerprint, so what is missing is the comparison over it rather than the signal.
  notes: The fingerprint is never what deduplication groups on — that is the content hash — because a near-duplicate signal collides by design and suppressing a document from review on a heuristic is the failure this separation exists to prevent. Clustering shows documents; it never hides one.

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
