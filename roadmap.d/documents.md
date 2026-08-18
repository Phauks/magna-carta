# Documents

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Documents -->

- id: documents
  name: Documents
  scope: Matter document storage and tooling — file manager, upload/ingest, malware scanning, editing, versioning/tiering, preview, conversion, PDF services, e-signature, bundling, OCR, repair, decryption, metadata, integrity, type verification, email parsing.
  status: partial
  slices: 1-1-matters-locations-file-manager, 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download, 2-2-editing-versioning-storage-tiering, 2-3-inline-preview-safe-delivery-sandbox, 2-4-in-app-conversion, 2-5-pdf-services-e-signature-core
  evidence: status.d phase-2 and cross-cutting fragments mix built (2-1, 2-2, 2-3, engines) with in-progress (2-4, 2-5) and unstarted (e-signature surfaces); most tool UIs deferred to the app shell.
  notes: Backend/engine depth far ahead of user-facing surfaces; web file surface in flight.

- id: documents.file-manager
  name: File Manager
  scope: Navigation over the matter's versioned R2 files — folders, document types, drag/drop, bulk download, content hashing, storage metering.
  status: partial
  slices: 1-1-matters-locations-file-manager, file-manager-primitives
  adrs: ADR-0078
  spec: docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md
  evidence: packages/file-manager plus worker routes (files, folders, document-types, uploads, downloads) on main; UI still building.
  audience: public
  public-name: Files on a matter
  public-summary: Every file on a matter in folders you control, with each version kept as you save it.
  notes: Backend shipped; user-facing surface is the file-surface-web stream.

- id: documents.file-manager.folders
  name: Folder navigation
  scope: Folder model, CRUD, and listing over the firm-scoped data-access layer.
  status: shipped
  surface: awaiting-screen
  evidence: packages/file-manager/src/folder-service.ts + apps/worker/src/routes/folders.ts (folders.list landed via the file-manager-contract stream).

- id: documents.file-manager.document-types
  name: Document types
  scope: Per-firm document-type taxonomy attached to files.
  status: shipped
  surface: awaiting-screen
  evidence: packages/file-manager/src/document-type-service.ts + apps/worker/src/routes/document-types.ts.

- id: documents.file-manager.ui-primitives
  name: File UI primitives
  scope: FileIcon, Breadcrumb, ContextMenu, Tree, Dropzone design-system components for file surfaces.
  status: shipped
  surface: internal
  slices: file-manager-primitives
  evidence: packages/design-system components merged to main (2026-07-14 baseline report: file-surface-web merge folded in file-manager primitives + contract).
  notes: Container VRT baselines and NVDA pass still outstanding per the fragment.

- id: documents.file-manager.matter-files-ui
  name: Matter Files surface
  scope: The matter's documents on real rows — the list, both creation paths (a file, or a template assembly), saving a new version, the version history, and the editing-session launch. The multi-view browser (collection region + capability detail pane) is the next layer over it.
  status: in-build
  surface: screen
  spec: docs/specs/2026-07-09-matter-file-manager-design.md
  evidence: Branch claude/document-surface — apps/web/src/lib/documents/ + the matters/[id]/files route, on same-origin /api/v1 calls; the matter chrome now resolves a live matter, so a firm's own matter is reachable at its own URL. Predecessor branch file-surface-web is unmerged and superseded for this node (its view shell and dev-seed/login e2e are already on main).
  notes: The Collabora editor needs the deployed magna-carta-edit container; folders, rename, and download are the next additions.

- id: documents.file-manager.file-inspector
  name: File Inspector workbench
  scope: Tools-host of the file surface for inspecting an ephemeral (non-matter) file through the same capability pane.
  status: not-started
  evidence: nothing on main — no inspector route, no inspector module, and no design under docs/specs/. The workbench design is one unmerged doc on the remote branch file-inspector-spec, so no accepted spec exists for `designed` to point at either.
  notes: Was in-build on the strength of that branch, which carries a single documentation commit and no code. The branch it would build on (file-surface-web) is recorded abandoned and superseded.

- id: documents.file-manager.content-hash
  name: Content hashing at write
  scope: SHA-256 recorded for every stored object at ingest — fixity, duplicate detection, scan-verdict caching, no-op version skip.
  status: shipped
  surface: internal
  adrs: ADR-0078
  evidence: packages/file-manager/src/ingest-core.ts hash step; @magna-carta/file-integrity supplies the streaming hash; scan-cache keys on content hash.

- id: documents.file-manager.bulk-download
  name: Bulk download (zip)
  scope: Streaming store-mode ZIP64 archive of selected files/folders/matter, version-pinned, RBAC-gated, audit-logged, memory-flat.
  status: shipped
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0082, ADR-0027
  evidence: packages/file-manager/src/zip-composition.ts + zip-entries-from-r2.ts + apps/worker/src/routes/downloads.ts; audit.ts logs exports.

- id: documents.file-manager.bulk-download.async
  name: Async bulk bundle
  scope: Large bundles run as a tracked background job (Durable Object) building an R2 artifact fetched by signed URL.
  status: shipped
  surface: awaiting-screen
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  spec: docs/specs/2026-06-17-slice-2-1-plan-3-async-bulk-download-implementation-plan.md
  evidence: apps/worker/src/routes/bundle-status.ts; slice 2-1 fragment records the async bulk download as the platform's first Durable Object, built.

- id: documents.file-manager.storage-metering
  name: Storage metering
  scope: Per-firm rollup of bytes and object counts by storage class and key prefix, exact in D1, reconciled against R2, feeding firm-usage diagnostics.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0078, ADR-0103
  evidence: packages/file-manager/src/metering-statements.ts + usage.ts + apps/worker/src/routes/firm-usage.ts; slice 1-1 fragment lists metering crons built. No Analytics Engine trend is kept and the declared port for one is withdrawn — metering-statements.ts records why; the operational rate signals ride declared counters in packages/telemetry/src/metrics.ts.

- id: documents.upload
  name: Upload & ingest pipeline
  scope: Uniform direct-to-R2 inbound upload with quarantine-gated ingest; bytes never transit the Worker.
  status: partial
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  adrs: ADR-0081
  spec: docs/specs/2026-06-16-slice-2-1-inbound-upload-untrusted-pipeline-design.md
  evidence: apps/worker/src/routes/uploads.ts + packages/file-manager/src/ingest-core.ts on main; slice 2-1 built, ui todo.
  notes: Upload UI rides the file-surface-web stream (Dropzone primitive shipped; dev upload route on main).

- id: documents.upload.direct-to-r2
  name: Direct-to-R2 transfer
  scope: Presigned single PUT for small files, resumable S3 multipart above a threshold; Worker only authorizes, mints URLs, records metadata.
  status: shipped
  surface: screen
  adrs: ADR-0081
  evidence: apps/worker/src/routes/uploads.ts (uploads.get added by the file-manager-contract stream); slice 2-1 fragment built/deployed.

- id: documents.upload.policy-gates
  name: Pre-acceptance gates
  scope: Per-firm size and content-type allow-list enforced at presign and re-verified against real bytes; magic-byte validation; filename sanitization.
  status: shipped
  surface: internal
  evidence: packages/file-manager/src/upload-policy.ts + validation.ts; ingest-core re-verifies at the quarantine gate.

- id: documents.upload.quarantine
  name: Quarantine-on-arrival
  scope: Bytes land at their final key not visible/servable/indexed until the async ingest consumer clears them (gates, SHA-256, scan port, version commit in one read).
  status: shipped
  surface: internal
  evidence: packages/file-manager/src/ingest-core.ts; serving queries filter on version status = 'clean' (queries.ts).

- id: documents.upload.archive-opacity
  name: Opaque archive storage
  scope: Uploaded archives stored versioned/hashed on the matter and never expanded server-side — no zip-bomb/nested-archive read pipeline exists.
  status: shipped
  surface: internal
  adrs: ADR-0027
  evidence: No server-side extraction code in the tree; ADR-0027 records the opaque posture; client-side extraction path deferred to Discovery.

- id: documents.scanning
  name: Malware scanning
  scope: Async scan of every uploaded byte behind a swappable port; verdict stored as file metadata; quarantine, never auto-delete.
  status: partial
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  adrs: ADR-0124, ADR-0147, ADR-0158
  evidence: containers/scan + apps/scan-worker deployed (magna-carta-scan, SCAN_SERVICE per slice 2-1 fragment); CDR, WAF pre-filter, and commercial engine options not built.
  notes: EICAR live check deferred (no production users yet).

- id: documents.scanning.port
  name: Scan port
  scope: ScanPort seam in the file-manager package so scan engines are swappable without touching the pipeline.
  status: shipped
  surface: internal
  evidence: packages/file-manager/src/scan-port.ts.

- id: documents.scanning.engine
  name: In-house scan engine (YARA + raw facts)
  scope: YARA Forge rule packs plus a raw-facts extraction engine running in a dedicated scan container behind its own worker.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0124, ADR-0147, ADR-0122
  spec: docs/specs/2026-06-22-scan-service-extraction-design.md
  evidence: containers/scan (Rust, with harness and prefilter validation images) + apps/scan-worker; Magika file-type model co-hosted here.

- id: documents.scanning.policy
  name: Per-firm scan policy
  scope: Firm-configurable tier and suspicious-score floor turning raw facts into verdicts; score-histogram seam for threshold tuning.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0158
  spec: docs/specs/2026-06-25-scan-per-firm-policy-design.md
  evidence: packages/file-manager/src/scan-policy-settings.ts + verdict.ts + apps/worker/src/routes/scan-policy.ts; histogram seam per docs/specs/2026-06-28-scan-policy-histogram-seam-design.md.

- id: documents.scanning.verdict
  name: Verdict as file metadata
  scope: clean/flagged/unscanned verdict persisted per version; flagged versions never served; infected files quarantined, never deleted.
  status: shipped
  surface: internal
  evidence: packages/file-manager/src/verdict.ts + scan_verdict column in queries.ts; preview policy refuses flagged versions.

- id: documents.scanning.rescan
  name: Re-scan on signature updates
  scope: Access-triggered re-scan with a content-hash + engine-version scan cache, so an engine/signature update forces re-scan on next access.
  status: shipped
  surface: internal
  spec: docs/specs/2026-06-22-access-triggered-rescan-design.md
  evidence: packages/file-manager/src/scan-cache.ts + apps/worker/src/routes/scan-matter.ts; dev seed provisions a re-scan-flagged file.

- id: documents.scanning.tool-ui
  name: Malware Scan tool page
  scope: User-facing scan/diagnose tool in the Tools area.
  status: shipped
  surface: awaiting-screen
  evidence: apps/worker/src/routes/scan-diagnose.ts; 2026-07-14 baseline report lists the Malware Scan page merged in the tools UI wave.

- id: documents.scanning.cdr
  name: CDR disarmed rendition
  scope: Optional content-disarmed copy of document types while the original is preserved byte-for-byte for evidence.
  status: not-started
  evidence: No CDR artifact in the tree; named as an optional pipeline stage in the white paper's untrusted-file-handling design.

- id: documents.scanning.waf-prefilter
  name: WAF edge pre-filter
  scope: Cloudflare WAF content scanning as a detect-only Layer-0 on proxy-transiting form uploads.
  status: not-started
  notes: Explicitly an engine option behind the port; Enterprise add-on, does not see direct-to-R2 traffic.

- id: documents.scanning.commercial-engine
  name: Commercial engine behind the port
  scope: A commercial AV engine (Sophos/Bitdefender/Kaspersky/OPSWAT class) run on our own compute behind the scan port.
  status: not-started
  notes: The white paper defers the concrete engine choice; the port and YARA baseline exist.

- id: documents.editing
  name: Editing (Collabora & WOPI)
  scope: Collabora Online on Containers as the sole .docx editor, real .docx in R2 as source of truth, app-owned WOPI host.
  status: partial
  slices: 2-2-editing-versioning-storage-tiering
  adrs: ADR-0010, ADR-0125, ADR-0126
  spec: docs/specs/2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md
  evidence: containers/collabora + apps/magna-carta-edit deployed + apps/worker/src/editing on main; editor UI pending.
  audience: public
  public-name: Editing in the browser
  public-summary: Open and edit a document in the browser without downloading it, and keep the version history as you work.

- id: documents.editing.collabora-host
  name: Collabora container host
  scope: One container per open document, spun up on demand by a Durable Object and reaped when idle, in a dedicated edit worker.
  status: shipped
  surface: internal
  adrs: ADR-0125, ADR-0138
  evidence: apps/magna-carta-edit/src/document-editor-container.ts + containers/collabora/Dockerfile; slice 2-2 fragment: magna-carta-edit deployed.

- id: documents.editing.wopi-host
  name: WOPI host & version-cut policy
  scope: WOPI callbacks with autosave-aware version cutting (explicit save and session close cut versions; autosaves overwrite current) and timestamp-guarded current overwrite.
  status: shipped
  surface: internal
  adrs: ADR-0126
  evidence: apps/worker/src/editing (module CLAUDE.md names the WOPI host, app-managed versioning, sweeps); version-cut-on-reap in document-editor-container.ts.

- id: documents.editing.checkout
  name: Offline checkout / check-in
  scope: Optimistic checkout with check-in reconciliation and an active-to-stale-to-released idle-checkout sweep on cron.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0126
  evidence: packages/file-manager/src/checkout-statements.ts + apps/worker/src/editing idle-checkout-sweep.ts.

- id: documents.editing.editor-ui
  name: Editor UI
  scope: In-app surface that opens a document in the Collabora frame.
  status: planned
  evidence: Slice 2-2 fragment: "Stage-2 doc-open verify + editor UI pending"; no editor surface in apps/web.
  notes: Gated on the app-shell / file-surface streams.

- id: documents.editing.native-editor
  name: Native CRDT editor
  scope: A second, lightweight Yjs/CRDT working-doc editor alongside Collabora.
  status: cut
  evidence: White paper Editing topic records it deliberately not built (two document models, lossy conversion seam); seam noted for a possible future separate doc type.

- id: documents.versioning
  name: Versioning & storage tiering
  scope: App-managed immutable version objects (not R2 native versioning) with per-version storage class and lifecycle.
  status: partial
  slices: 2-2-editing-versioning-storage-tiering
  adrs: ADR-0035
  spec: docs/specs/2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md
  evidence: Version model + tiering sweep on main; deleted-file cold retention/destruction and delta storage not built.

- id: documents.versioning.app-managed
  name: App-managed version objects
  scope: Churning current key overwritten per save; immutable vN snapshots cut deliberately, never per autosave.
  status: shipped
  surface: screen
  adrs: ADR-0035
  evidence: packages/file-manager/src/file-statements.ts + queries.ts version model; editing module cuts versions per policy.

- id: documents.versioning.tiering
  name: Supersede-to-IA tiering
  scope: Superseded versions transitioned Standard to Infrequent Access server-side on a sweep; tiering, never pruning.
  status: shipped
  surface: internal
  evidence: apps/worker/src/editing/tiering-sweep.ts (daily reconciliation cron; respects the 30-day IA minimum-duration floor).

- id: documents.versioning.storage-encoding-seam
  name: storage_encoding seam
  scope: Version metadata discriminator (full today, patch encoding later) so nothing outside the data-access layer assumes a version object is raw bytes.
  status: shipped
  surface: internal
  adrs: ADR-0077
  evidence: storage_encoding column selected in packages/file-manager/src/queries.ts.

- id: documents.versioning.delta-storage
  name: Version-history delta storage
  scope: Superseded versions re-stored (ZIP entries stored, not deflated) as zstd patch-from deltas with keyframes and roundtrip-hash verification, as an async Queue/Container job.
  status: deferred
  adrs: ADR-0077
  evidence: ADR-0077 records designed-but-deferred; adoption gated on ~100 GB/firm measured snapshot churn via the storage-metering instrument.

- id: documents.versioning.deleted-lifecycle
  name: Deleted-file lifecycle
  scope: Soft-delete trash window (Standard) then IA cold retention then policy-driven destruction blocked by holds; default retention indefinite.
  status: partial
  adrs: ADR-0049
  evidence: Soft-delete/restore statements exist; no trash-expiry IA transition or destruction lever found in the tree.

- id: documents.versioning.deleted-lifecycle.trash
  name: Trash & restore
  scope: Soft-delete hides the record from the File Manager (firm-scoped state change, bytes untouched); restore clears the flag in place.
  status: shipped
  surface: awaiting-screen
  evidence: softDeleteFileStatement + undelete in packages/file-manager/src/file-statements.ts; deleted_at filters in queries.ts.

- id: documents.versioning.deleted-lifecycle.cold-retention
  name: Trash-expiry IA transition
  scope: After the trash window, deleted objects transition Standard to IA in place via the same server-side copy used for superseded versions.
  status: not-started
  adrs: ADR-0049
  evidence: tiering-sweep.ts documents that it only touches superseded versions, never deletes.

- id: documents.versioning.deleted-lifecycle.destruction
  name: Policy-driven destruction
  scope: Per-record retention/destruction date driving audited hard-delete, blocked by legal/discovery/Custodian holds; ships defaulted off (indefinite).
  status: not-started
  adrs: ADR-0049
  evidence: No hard-delete path for file bytes in the tree; decision recorded in ADR-0049.

- id: documents.preview
  name: Inline file preview
  scope: Files viewed in place (video first) with download alongside; untrusted bytes delivered safely.
  status: partial
  slices: 2-3-inline-preview-safe-delivery-sandbox
  adrs: ADR-0029
  spec: docs/specs/2026-06-19-slice-2-3-inline-preview-safe-delivery-design.md
  evidence: Slice 2-3 backend built on main; player UI and rendition engine deferred to the app-shell wave.

- id: documents.preview.signed-delivery
  name: Authorization-gated delivery
  scope: Short-lived tokened URLs minted only after matter/RBAC checks; originals stream from R2 (progressive playback, free egress).
  status: shipped
  surface: internal
  evidence: apps/worker/src/downloads + routes/downloads.ts; slice 2-3 fragment: delivery under a first-party HMAC token, backend on main.

- id: documents.preview.sandbox-origin
  name: Safe-delivery sandbox
  scope: Untrusted bytes served from a separate cookieless files._ origin with attachment disposition, correct Content-Type, nosniff, restrictive CSP, iframe sandbox.
  status: shipped
  surface: internal
  adrs: ADR-0115
  evidence: Slice 2-3 fragment: cookieless files._ subresource delivery landed on main.

- id: documents.preview.inline-playable
  name: inlinePlayable verdict
  scope: Cheap container/codec sniff recorded per version at ingest; preview policy serves inline only on a playable verdict.
  status: shipped
  surface: internal
  adrs: ADR-0114
  evidence: packages/file-manager/src/preview-policy.ts gates on version.inlinePlayable; inline_playable column in queries.ts.
  notes: Firm-wide Reports rollup of the verdict awaits the Reports subsystem.

- id: documents.preview.safe-rendition
  name: Derived safe renditions
  scope: Active formats previewed only via a derived rasterized/transcoded rendition (artifact_role derived version), never the raw file.
  status: partial
  surface: awaiting-screen
  evidence: packages/file-manager/src/safe-rendition-port.ts ships the port plus an engine-less adapter that refuses; active formats are download-only until the engine wires in.
  notes: Rasterize/transcode engine wires in with the player UI.

- id: documents.preview.player
  name: Video player UI
  scope: Vidstack-based inline player with consistent themed controls; HLS support dormant for future transcoding.
  status: designed
  spec: docs/specs/2026-06-19-slice-2-3-inline-preview-safe-delivery-design.md
  evidence: No vidstack dependency anywhere in the tree; slice 2-3 fragment: "Player UI → 0·7".

- id: documents.preview.transcoding
  name: Preview transcoding
  scope: Self-hosted FFmpeg (Queues + Container) MP4 renditions for non-web formats; clip/annotation, transcript sync, adaptive bitrate.
  status: deferred
  adrs: ADR-0029
  evidence: White paper Inline file preview topic lists these deferred; no FFmpeg artifact in the tree.

- id: documents.conversion
  name: In-app file conversion
  scope: In-house any-format to any-format converter; bytes stay in-tenant (R2 to our compute to R2); original never mutated.
  status: partial
  slices: 2-4-in-app-conversion
  adrs: ADR-0030, ADR-0116
  spec: docs/specs/2026-06-21-slice-2-4a-conversion-core-design.md
  evidence: packages/conversion + apps/convert-worker (with the per-engine dispatch seam) + apps/worker/src/conversions + containers/raster on main; the office, AV, and email engine bodies are still unbuilt and production stays dormant until the deploy activation.

- id: documents.conversion.registry
  name: Format registry & pathfinding
  scope: Declarative (source, target) to {engine, recipe} table with weighted single-engine edges and multi-hop chain computation; single source of format knowledge.
  status: shipped
  surface: internal
  adrs: ADR-0116
  evidence: packages/conversion/src/registry.ts + pathfinding.ts + format.ts.

- id: documents.conversion.port
  name: ConversionPort & adapters
  scope: Port/adapter seam so engines are testable and swappable; external adapters deliberately not enabled.
  status: shipped
  surface: internal
  adrs: ADR-0116
  evidence: packages/conversion/src/port.ts + engines.ts + adapters/.

- id: documents.conversion.api
  name: Conversion API
  scope: Upload-and-submit conversion endpoints in the OpenAPI contract.
  status: shipped
  surface: awaiting-screen
  evidence: apps/worker/src/routes/conversions.ts (/api/v1/conversions/upload, /api/v1/conversions submit) + apps/worker/src/conversions.
  notes: Execution currently limited to the built engine edges (raster, image-to-PDF).

- id: documents.conversion.raster
  name: Raster image engine
  scope: Pure-Rust image conversion engine in a dedicated container behind the convert worker (memory-safe replacement for native libvips).
  status: shipped
  surface: awaiting-screen
  spec: docs/specs/2026-06-23-slice-2-4d-raster-engine-design.md
  evidence: containers/raster + apps/convert-worker/src/raster-engine-container.ts + forward-convert.ts.

- id: documents.conversion.image-to-pdf
  name: Image to PDF
  scope: Image-to-PDF conversion edge on the registry.
  status: shipped
  surface: awaiting-screen
  spec: docs/specs/2026-06-23-slice-2-4e-image-to-pdf-design.md
  evidence: Slice 2-4 fragment lists image-to-PDF among the built core.

- id: documents.conversion.office
  name: Office document conversion
  scope: Documents/spreadsheets/presentations to/from PDF via the server office engine (LibreOffice-class, container-bound).
  status: planned
  adrs: ADR-0204
  spec: docs/specs/2026-08-04-libreoffice-conversion-engine-design.md
  evidence: ADR-0204 settles the engine design (network-isolated Container, supervisor over a pool of long-lived single-threaded LibreOfficeKit workers, pure-Rust libreofficekit binding); no office-conversion container in containers/ yet.
  notes: The C++ LibreOffice runtime is owner-consented under golden rule 14, scoped to the dlopened suite; the build phase is next.

- id: documents.conversion.av-transcode
  name: Audio/video transcodes
  scope: Self-hosted FFmpeg transcode edges (shared with the preview transcoding path).
  status: not-started
  evidence: No FFmpeg engine or container in the tree.

- id: documents.conversion.email-to-pdf
  name: Email MSG/EML to PDF
  scope: Render parsed email as PDF for producing email as exhibits; closes the registry's eml/msg edges.
  status: not-started
  evidence: email-core-parse-engine fragment names the email-to-PDF render engine as next; parse engine is deliberately parse-only.

- id: documents.conversion.searchable-pdf
  name: Scanned PDF to searchable PDF
  scope: OCR text layer applied to scanned PDFs via the OCR pipeline.
  status: not-started
  evidence: OCR engine shipped, but pdf-render-engine fragment lists OCR integration as remaining work after surgery completion; no text-layer writer in crates/pdf-core.

- id: documents.conversion.background-jobs
  name: Background job orchestration
  scope: Durable Object per job holding queued/running/per-item progress, container spin-up/sleep, completion notification for large or batch conversions.
  status: partial
  surface: internal
  adrs: ADR-0116
  evidence: apps/worker/src/conversions/conversion-coordinator.ts is the per-job ConversionJob Durable Object (start, markRunning, markDone, markFailed, status, alarm) fed by the CONVERSION queue consumer; apps/convert-worker dispatches the hop per engine id.
  notes: Single-file jobs only — per-item batch progress and completion notification are not built, and container spin-up/sleep applies to the raster container alone.

- id: documents.conversion.output-placement
  name: Output placement
  scope: Per-job choice of save-into-matter (versioned R2 sibling, audit-logged) or download a copy.
  status: in-build
  surface: awaiting-screen
  evidence: packages/conversion/src/placement.ts on main; slice 2-4 built in-progress, matter-save wiring gated on the execution substrate.

- id: documents.conversion.convert-ui
  name: Convert-to menu / converter tool UI
  scope: Data-driven Convert-to menu answered by the registry; file-converter tool surface.
  status: designed
  spec: docs/specs/2026-06-22-tools-file-converter-design.md
  evidence: Design on main; no converter page in the merged tools UI wave (baseline report lists Tools listing, WHOIS, Malware Scan pages only).

- id: documents.pdf
  name: PDF services
  scope: Unified PDF operation service — client-side WASM by default, server only for seal, no-client, server-only-engine, and batch cases.
  status: partial
  slices: 2-5-pdf-services-e-signature-core, pdf-render-engine
  adrs: ADR-0045, ADR-0128
  spec: docs/specs/2026-06-21-rust-pdf-engine-roadmap-design.md
  evidence: Engine substrate built (crates/pdf-core to WASM); consumer surfaces and tool UIs not started; slice 2-5 in-progress.
  audience: public
  public-name: PDF tools
  public-summary: Redact, combine, split, rotate, fill, stamp and password-protect a PDF without sending the file anywhere else.
  notes: ADR-0045 marks the whole PDF/e-signature design provisional pending verification.

- id: documents.pdf.engine
  name: Pure-Rust engine core
  scope: crates/pdf-core compiled to WASM for client and Worker, superseding the composed pdf-lib/PDFium/qpdf roster with one memory-safe engine.
  status: shipped
  surface: awaiting-screen
  slices: pdf-render-engine
  adrs: ADR-0127, ADR-0128, ADR-0088, ADR-0089
  evidence: crates/pdf-core (bates, forms, redact, scrub, secure, surgery, generate, guard, detect, watermark modules) + @magna-carta/pdf WASM wrapper; feasibility results at docs/specs/2026-06-21-pdf-engine-feasibility-results.md.

- id: documents.pdf.render
  name: Render to raster
  scope: PDF page rendering for preview/flatten via the pure-Rust engine (hayro dependency doctrine).
  status: shipped
  surface: awaiting-screen
  slices: pdf-render-engine
  adrs: ADR-0127
  spec: docs/specs/2026-06-21-pdf-slice-1-core-render-design.md
  evidence: pdf-render-engine fragment lists render built; crates/pdf-eval evaluation harness in the workspace.

- id: documents.pdf.redaction
  name: True redaction (rasterize route)
  scope: Content-removing redaction via the rasterize route — underlying content destroyed, not covered.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0134
  spec: docs/specs/2026-06-22-pdf-slice-2-redaction-design.md
  evidence: crates/pdf-core/src/redact.rs; feasibility findings at docs/specs/2026-06-22-pdf-redaction-feasibility-findings.md.
  notes: Resolves in-house the AGPL-engine dilemma the white paper carried to Discovery.

- id: documents.pdf.redaction-detector
  name: Bad-redaction detector
  scope: Detects cover-up-style redactions with recoverable underlying text (observing-device model).
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0137
  spec: docs/specs/2026-06-22-pdf-detector-engine-design.md
  evidence: crates/pdf-core/src/detect.rs + textpos.rs; fast-follow design/plan also in docs/specs/.

- id: documents.pdf.scrub
  name: PDF document scrub
  scope: Removes hidden content and metadata from PDFs.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0136
  spec: docs/specs/2026-06-22-pdf-document-scrub-design.md
  evidence: crates/pdf-core/src/scrub.rs removes twelve document-level surfaces — Info, Metadata, StructTreeRoot, MarkInfo, Outlines, named destinations, optional-content properties, field values and appearances, XFA, embedded files, Collection and file associations — and verify_scrub_absence re-reads the document afterwards, gating all seven option groups across thirteen checks and failing the scrub rather than returning bytes that still carry what it was asked to remove. Only the field appearance stream is cleared without being verified.
  awaiting-owner: Whether the scrub should also strip a PDF's executable content, which today it leaves entirely intact — the document-level JavaScript name tree, the action that fires when the file is opened, the catalog actions that fire on save, print and close, the additional-actions on pages and on form fields, and the action attached to any annotation. A document produced to an opposing party can therefore still carry code, and the scrub is the step whose whole purpose is that it does not. Stripping is not free: the fillable court forms this platform now assembles use field actions for validation and formatting, so a scrub that removes them returns a form that looks right and computes nothing. Three ways to answer. Strip always, and accept that a scrubbed fillable form stops calculating. Strip by default with a named exception for forms the platform generated itself, which needs a way to tell them apart that a recipient cannot forge. Or report the active content without removing it and let a person decide per document, which is honest and puts the judgment on whoever is producing. The page-split path in crates/pdf-core/src/generate.rs drops the catalog-level ones — its OpenAction, AA and Names — but only because a page subset cannot carry cross-document references, and it never touches a page or field action on a page it keeps. So a split is not a scrub, and neither path is a precedent for the other.

- id: documents.pdf.surgery
  name: Structural surgery & repair
  scope: Content-stream and structural PDF surgery (the qpdf role, in-house): repair, restructure, linearize-class operations.
  status: partial
  surface: awaiting-screen
  adrs: ADR-0139
  spec: docs/specs/2026-07-03-pdf-byte-level-surgery-design.md
  evidence: crates/pdf-core/src/surgery.rs; pdf-render-engine fragment: surgery v1 passes 3/10 corpus, completion is the named next step.

- id: documents.pdf.bates
  name: Bates numbering
  scope: Bates stamping across documents with configurable format/position.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0142
  spec: docs/specs/2026-06-23-pdf-bates-numbering-design.md
  evidence: crates/pdf-core/src/bates.rs; configurability plan at docs/specs/2026-06-25-pdf-bates-configurability-plan.md.

- id: documents.pdf.forms
  name: PDF form fill
  scope: AcroForm form filling in the pure-Rust engine.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0152
  spec: docs/specs/2026-06-25-pdf-forms-design.md
  evidence: crates/pdf-core/src/forms.rs.
  notes: XFA not in scope of the built module.

- id: documents.pdf.watermark
  name: Stamp / watermark
  scope: Stamping and watermarking pages.
  status: shipped
  surface: awaiting-screen
  evidence: crates/pdf-core/src/watermark.rs.

- id: documents.pdf.secure
  name: Secure / encrypt
  scope: PDF encryption, passwords, and permissions (plus decrypt support).
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0159
  spec: docs/specs/2026-06-26-pdf-secure-encrypt-design.md
  evidence: crates/pdf-core/src/secure.rs + decrypt.rs.

- id: documents.pdf.generate
  name: Generate primitives
  scope: Programmatic PDF generation (text, standard fonts, drawing primitives) for invoices/reports/certificates.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0162
  spec: docs/specs/2026-06-26-pdf-generate-primitives-design.md
  evidence: crates/pdf-core/src/generate.rs + standard_fonts.rs.

- id: documents.pdf.decompression-guard
  name: Decompression-bomb guard
  scope: Raw-bytes pre-flight guard against decompression bombs before engine work.
  status: shipped
  surface: internal
  spec: docs/specs/2026-06-28-pdf-decompression-guard-design.md
  evidence: crates/pdf-core/src/guard.rs; pdf-render-engine fragment notes encrypted-stream bodies as a disclosed residual.
  notes: Decision fragment pdf-decompression-guard still pending assembly (unnumbered).

- id: documents.pdf.manipulation
  name: Merge / split / rotate / flatten
  scope: Page-level manipulation operations promised for the PDF service.
  status: not-started
  evidence: No merge/split/rotate/flatten module in crates/pdf-core/src; roadmap of remaining engine work at docs/specs/pdf-engine-next-steps.md.

- id: documents.pdf.tool-uis
  name: PDF tool UIs
  scope: User-facing PDF tools (redact, Bates, forms, secure, etc.) in the Tools area.
  status: not-started
  evidence: pdf-render-engine fragment: tool UIs gated on wasm-opt and the design-system shell wave; no PDF pages in apps/web.

- id: documents.esignature
  name: E-signature
  scope: First-party e-signature on the PDF engine — sender field placement, signing UI, PAdES platform seal, audit trail, certificate of completion, attribution tiers.
  status: partial
  slices: 2-5-pdf-services-e-signature-core
  adrs: ADR-0045, ADR-0205, ADR-0206
  evidence: packages/signing + apps/sign-worker + crates/pdf-core seal primitive + apps/worker/src/routes/document-seal.ts on main; the signing flow, field placement, and adoption UI are not started.
  audience: public
  public-name: Electronic signatures
  public-summary: Send a document for signature and get the signed copy back with a record of who signed it and when.
  notes: ADR-0045 records the whole area as provisional — every license/legal specific to be re-verified before build.

- id: documents.esignature.pades-seal
  name: PAdES platform seal
  scope: Server-applied tamper-evidence seal with the firm certificate on completed documents.
  status: shipped
  surface: awaiting-screen
  slices: 2-5-pdf-services-e-signature-core
  adrs: ADR-0205, ADR-0206
  evidence: crates/pdf-core seal primitive (incremental update, ByteRange, CMS splice) with WASM bindings; packages/signing CMS backend at PAdES-B-B with signing-certificate-v2; apps/sign-worker holding the platform key; apps/worker/src/routes/document-seal.ts over a SealPort binding; tooling/platform-seal-certificate provisions the identity.
  notes: ADR-0206 resolves the Worker-crypto vs Container question in favour of pkijs over WebCrypto in the Worker. Baseline B-B only — timestamp/LTV levels (B-T/B-LT/B-LTA, needs a TSA) and independent-validator conformance remain.

- id: documents.esignature.signing-flow
  name: Signing flow & adoption UI
  scope: Client-side field placement, signing UI, signature adoption (type/draw/upload).
  status: not-started
  evidence: No artifact in the tree.

- id: documents.esignature.audit-trail
  name: Audit trail & certificate of completion
  scope: Server-observed signer IP/timestamp/consent/document hash assembled into a stored Certificate of Completion.
  status: partial
  surface: awaiting-screen
  slices: 2-5-pdf-services-e-signature-core
  evidence: packages/signing/src/esign.ts holds the ESIGN/UETA model and the Certificate of Completion assemble-and-render path; the seal route sets signing time and observed IP server-side and emits a redacted esign.sealed audit event.
  notes: The certificate can be assembled and rendered, but nothing yet captures a signer's consent through a signing flow, and the certificate is not stored against a document.

- id: documents.esignature.attribution
  name: Attribution assurance tiers
  scope: Configurable signer assurance — authenticated internal, tokenized link, email/SMS code, ID/KBA, portal-authenticated.
  status: not-started
  evidence: No artifact in the tree.

- id: documents.esignature.vendor-port
  name: Vendor adapter seam
  scope: Plugin-port seam for a third-party trust-service adapter (certified filing, remote online notarization).
  status: not-started
  evidence: The integration port system exists platform-wide, but no e-signature port or adapter is defined.

- id: documents.bundling
  name: Enhanced bundling
  scope: Matter bundle export with format choice, compression, AES-256 encryption, and multi-volume output, in two lanes.
  status: partial
  slices: enhanced-bundling
  adrs: ADR-0146
  spec: docs/specs/2026-06-25-enhanced-bundling-design.md
  evidence: containers/bundle (Rust) + apps/bundle-worker + bundle-\* modules in packages/file-manager; UI deferred.
  audience: public
  public-name: Court bundles
  public-summary: Assemble an indexed, paginated bundle from the files already on the matter.

- id: documents.bundling.light-lane
  name: TypeScript bundle lane
  scope: In-Worker lane for plain streaming bundles (formats/layout/manifest/options in the file-manager package).
  status: shipped
  surface: awaiting-screen
  evidence: packages/file-manager/src/bundle-formats.ts, bundle-layout.ts, bundle-manifest.ts, bundle-options.ts, bundle-paths.ts, contents-manifest.ts.

- id: documents.bundling.container-lane
  name: Container bundle lane
  scope: Heavy/encrypted lane — alternative formats, compression, AES-256, multi-volume — in a dedicated Rust container behind its own worker.
  status: shipped
  surface: awaiting-screen
  evidence: containers/bundle + apps/bundle-worker on main.
  notes: Lanes return 503 until the image is deployed and BUNDLE_SERVICE binds (per the status fragment).

- id: documents.bundling.ui
  name: Bundling UI
  scope: User-facing bundle configuration surface.
  status: not-started
  evidence: Status fragment: UI deferred.

- id: documents.ocr
  name: OCR
  scope: PaddleOCR models via ort/ONNX in a container behind a dedicated worker; identical output wherever it runs.
  status: partial
  slices: ocr-engine
  adrs: ADR-0060
  spec: docs/specs/2026-07-09-ocr-engine-design.md
  evidence: crates/ocr-core + containers/ocr + apps/ocr-worker + apps/worker/src/routes/ocr.ts on main; UI deferred; deploy verification is the named next step.

- id: documents.ocr.engine
  name: ocr-core engine
  scope: PP-OCR ONNX model pipeline (small tier) through Rust ort, with pinned SHA-256-guarded model set.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0060
  evidence: crates/ocr-core + containers/ocr.
  notes: ADR-0060 selected PP-OCRv5; the built engine runs PP-OCRv6 per the status fragment.

- id: documents.ocr.api
  name: OCR API
  scope: POST /api/v1/ocr behind the tools:ocr permission.
  status: shipped
  surface: awaiting-screen
  evidence: apps/worker/src/routes/ocr.ts; OCR_SERVICE forwarding via apps/ocr-worker.
  notes: Answers 503 until magna-carta-ocr is deployed. That worker appears in no deploy record — not the Workers Builds connection list, not the placeholder list, not the deploy queue — and a service binding naming a missing Worker rejects the whole app-worker deploy, so confirming it exists is now the first item in docs/deploy-queue.md.

- id: documents.ocr.raster-cap
  name: Raster cap & skip gate
  scope: Caps raster size and skips already-text pages in the OCR path.
  status: shipped
  surface: internal
  evidence: containers/ocr/src/pages.rs derives the render density from a pixel budget so an outsize page cannot be rastered whole, and containers/ocr/src/lib.rs skips a page that already carries a text layer with a recorded reason; both carry tests in that crate.
  notes: Was in-build against the remote branch ocr-raster-cap-and-skip-gate; the capability reached main independently of it.

- id: documents.ocr.ui
  name: OCR tool UI
  scope: User-facing OCR tool surface.
  status: not-started
  evidence: Status fragment: UI deferred.

- id: documents.ocr.desktop-local
  name: Local OCR on desktop
  scope: Same pinned model set compiled native for the Tauri client so desktop ingest OCRs locally.
  status: not-started
  adrs: ADR-0060
  evidence: No Tauri app exists yet (desktop follows web MVP per ADR-0002); engine is native-compilable by design.

- id: documents.file-repair
  name: File repair & salvage
  scope: Diagnose/repair/carve corrupted files with an honest per-run loss manifest, re-scanned output, and chain-of-custody provenance.
  status: partial
  slices: file-repair-salvage
  spec: docs/specs/2026-06-28-file-repair-salvage-design.md
  evidence: crates/recovery-core + containers/file-repair + apps/file-repair-worker + apps/worker/src/routes/file-repair.ts; UI and deploy smoke test deferred.
  notes: Decision fragments file-repair-single-container-lane and engine-host-r2-optional pending assembly (unnumbered).

- id: documents.file-repair.format-pillars
  name: Format repair pillars
  scope: ZIP/OOXML, CFB/OLE2, PDF xref-rebuild, and content-carving repair pillars in pure Rust (native-only).
  status: shipped
  surface: awaiting-screen
  evidence: crates/recovery-core; per-pillar plans in docs/specs/ (plan-2 zip-ooxml through plan-5 carving).

- id: documents.file-repair.stateless-api
  name: Stateless repair API
  scope: /api/v1/file-repair/{diagnose,repair,carve}; reconstructed output re-scanned and withheld if flagged.
  status: shipped
  surface: awaiting-screen
  evidence: apps/worker/src/routes/file-repair.ts + apps/file-repair-worker + FILE_REPAIR_SERVICE binding per the status fragment.

- id: documents.file-repair.attach-to-matter
  name: Attach repaired output to matter
  scope: Repair/carve outputs saved as server-side uploads through the ingest gate (new version or new files; flagged goes to quarantine) with loss manifest persisted per version.
  status: shipped
  surface: awaiting-screen
  spec: docs/specs/2026-07-03-file-repair-salvage-plan-6b-attach-to-matter.md
  evidence: Status fragment describes the /{repair,carve}/attach routes and the file_repair_provenance table as built.

- id: documents.file-repair.ui
  name: File repair UI
  scope: User-facing repair/salvage surface.
  status: not-started
  evidence: Status fragment: UI deferred post-shell; magna-carta-file-repair Worker not yet connected to Workers Builds.

- id: documents.decryption
  name: File unlock & password recovery
  scope: Unlock password-protected files with a known password; recover forgotten passwords by coordinated candidate search.
  status: partial
  slices: decryption-file-unlock-password-recovery
  spec: docs/specs/2026-06-26-decryption-tool-design.md
  evidence: crates/decryption-core + @magna-carta/decryption + routes decryption.ts/recovery.ts + apps/recovery-worker + containers/recovery; GPU rungs and UI deferred.
  audience: public
  public-name: Opening a locked file
  public-summary: Unlock a password-protected file when you have the password, and attempt recovery when the client no longer does.
  notes: Decision fragments decryption-file-unlock-recovery and decryption-recovery-orchestration pending assembly (unnumbered).

- id: documents.decryption.unlock
  name: Inspect & unlock
  scope: PDF/ZIP/OOXML inspect + unlock via a FormatAdapter, pure Rust compiled to both WASM and native.
  status: shipped
  surface: awaiting-screen
  evidence: /decryption/inspect + /unlock routes; crates/decryption-core on the engine-host seam.

- id: documents.decryption.recovery
  name: Password recovery orchestration
  scope: Durable-Object-coordinated fan-out over recovery-worker shards with a hash-only boundary (privileged bytes never leave; only hashes are distributed).
  status: shipped
  surface: awaiting-screen
  spec: docs/specs/2026-06-26-decryption-slice-2-recovery-design.md
  evidence: apps/recovery-worker + containers/recovery (with wordlists) + /decryption/recover\* routes.

- id: documents.decryption.gpu
  name: GPU recovery rungs
  scope: GPU-accelerated recovery tiers above the CPU shards.
  status: in-build
  surface: internal
  spec: docs/specs/2026-07-03-decryption-slice-3-gpu-recovery-design.md
  evidence: packages/gpu-benchmark (Stage 1 benchmark harness) built; Stage 2 wiring named next in the status fragment.

- id: documents.decryption.ui
  name: Unlock/recovery UI
  scope: End-user unlock and recovery surface.
  status: not-started
  evidence: Status fragment: end-user UI post-shell.

- id: documents.metadata
  name: Metadata inspector & scrubber
  scope: Inspect and scrub embedded metadata from files before sharing/production.
  status: partial
  slices: metadata-inspector-scrubber
  adrs: ADR-0123
  spec: docs/specs/2026-06-22-metadata-tool-design.md
  evidence: @magna-carta/metadata + apps/worker/src/routes/metadata.ts; HEIC/PDF/container engine deferred; UI todo.
  audience: public
  public-name: Metadata scrubbing
  public-summary: See what is hidden inside a file — tracked changes, comments, author details, the place a photograph was taken — and strip it out before you send it.

- id: documents.metadata.ooxml
  name: OOXML metadata
  scope: Inspect/scrub DOCX/XLSX/PPTX metadata, stateless.
  status: shipped
  surface: awaiting-screen
  evidence: packages/metadata/src/ooxml + engine.ts/port.ts.

- id: documents.metadata.image
  name: Image metadata
  scope: Inspect/scrub JPEG/PNG/TIFF metadata (EXIF et al.), stateless.
  status: shipped
  surface: awaiting-screen
  evidence: packages/metadata/src/image + tests.

- id: documents.metadata.extended-formats
  name: HEIC / PDF / container-engine metadata
  scope: HEIC and PDF metadata handling via a container engine.
  status: deferred
  evidence: Status fragment records HEIC/PDF/Container engine deferred.
  notes: PDF-side scrub exists separately in crates/pdf-core (documents.pdf.scrub).

- id: documents.metadata.ui
  name: Metadata tool UI
  scope: User-facing inspect/scrub surface.
  status: not-started
  evidence: Status fragment: UI todo.

- id: documents.file-integrity
  name: File hash & integrity
  scope: Multi-algorithm streaming hash, ingest-baseline comparison, and verification receipt for evidence-grade fixity.
  status: partial
  surface: awaiting-screen
  slices: file-hash-integrity
  adrs: ADR-0143
  spec: docs/specs/2026-06-23-file-hash-integrity-design.md
  evidence: @magna-carta/file-integrity (hash/compare/receipt) + apps/worker/src/routes/file-integrity.ts; introduced the file context tag.
  notes: Backend shipped; tool UI deferred to the shell wave.

- id: documents.file-type
  name: File type verification
  scope: Content-based file-type identification (Magika ONNX) with filename/extension mismatch analysis and a report.
  status: partial
  surface: awaiting-screen
  slices: file-type-verifier
  adrs: ADR-0160
  spec: docs/specs/2026-06-26-file-type-verifier-design.md
  evidence: @magna-carta/file-type + POST /api/v1/file-type/verify + Magika identify hosted in the scan container (ort/ONNX).
  notes: Backend shipped; UI todo per the status fragment.

- id: documents.email
  name: Email parsing (email-core)
  scope: Pure-Rust .eml/.msg/mbox parse engine on the engine-host seam with a WASM edge and an Email Inspector tool.
  status: partial
  slices: email-core-parse-engine
  spec: docs/specs/2026-07-09-email-core-parse-engine-design.md
  evidence: crates/email-core + @magna-carta/email + apps/worker/src/routes/email-inspector.ts; tested done in the status fragment.
  notes: Parse-only by design — rendering and DKIM verification stand outside; container/native lane deferred until Discovery's bulk mbox needs.

- id: documents.email.parse
  name: EML / MSG / mbox parse
  scope: Full message parse to a normalized record model.
  status: shipped
  surface: awaiting-screen
  evidence: crates/email-core + WASM edge per the status fragment.

- id: documents.email.msg-mapi
  name: MSG via CFB + in-house MAPI
  scope: .msg read over the cfb crate with MAPI property decoding written in-house.
  status: shipped
  surface: awaiting-screen
  evidence: Status fragment: msg_parser audited and rejected for a release-profile panic on the unwind-less WASM runtime.

- id: documents.email.lzfu-rtf
  name: LZFu compressed-RTF bodies
  scope: Decoder for compressed-RTF .msg bodies.
  status: shipped
  surface: awaiting-screen
  spec: docs/specs/2026-07-10-lzfu-compressed-rtf-decoder-design.md
  evidence: 2026-07-14 baseline report lists email LZFu compressed-RTF decoding merged to main.

- id: documents.email.inspector-tool
  name: Email Inspector tool
  scope: Worker route + tool exposing the parse engine.
  status: shipped
  surface: awaiting-screen
  evidence: apps/worker/src/routes/email-inspector.ts.

- id: documents.engine-host
  name: Engine-host harness
  scope: Shared hosting seam (format / wasm_edge / host) so pure-Rust file engines run identically as WASM edges and container services.
  status: shipped
  surface: internal
  slices: engine-host-harness
  adrs: ADR-0161
  spec: docs/specs/2026-06-28-engine-host-framework-design.md
  evidence: crates/engine-host; file-repair is the first container-on-harness engine, email-core rides the same seam.
  notes: Status fragment marks tested todo.
