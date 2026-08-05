# Slice 5·1 — Discovery ingest and processing — implementation plan

**Design:** [`2026-08-05-discovery-5-1-design.md`](2026-08-05-discovery-5-1-design.md)
**Date:** 2026-08-05
**Status:** Plan proposed. No product code in this cycle; this document is what a build cycle executes.
**Depends on:** owner decisions D1–D10 in the design. D2, D3, D7, and D9 change the plan's shape if
declined; the affected tasks say how.

---

## Global constraints

These bind every task below and are not repeated in each one.

- **Bulk content to R2, never D1.** Extracted text, metadata sidecars, manifests, exception reports,
  and splits are R2 objects. Database rows hold pointers and small scalars.
- **Every database read and write goes through the firm-scoped data-access layer.** No query crosses
  firms; multi-statement writes go through the existing effect-batch chokepoint.
- **No heavy work in a request handler.** Parsing, extraction, hashing, and fan-out are queue and
  Container work. A route enqueues and returns.
- **Pure Rust only in the new core.** No C-backed crate feature on any path. The only memory-unsafe
  code the pipeline touches is the already-consented LibreOffice and scan containers.
- **Every document ends in exactly one terminal state**, and any state that is not success carries a
  named exception code. No silent drops, in any task.
- **Reuse before building.** The ingest gate, the version model, the email record model, the job
  coordinator pattern, the queue consumer contract, the integrity hashing, and the split format all
  exist. This slice extends them.
- **Golden rule 13 applies to everything written.** Source, tests, config, and OpenAPI descriptions
  carry no references to this plan, the design, slice numbers as citations, or ADR numbers. State the
  reasoning inline or point at a file by path. A forward-looking "5·2 adds the clustering" is allowed.
- **Docs land in the same commit** as the code they describe: developer docs in their homes, the user
  guide under `docs/user/`, the status fragment, the changelog fragment, and the roadmap ledger nodes.

## Commands

```
vp run bootstrap                 # first, in a fresh worktree
pnpm check:scoped                # inner loop
pnpm test <path>                 # filter by path, never by test name
cargo test -p discovery-core     # the new crate, alone
cargo clippy --workspace         # before any Rust push
pnpm run lint:process-refs       # golden rule 13
```

---

# Build sub-slice 5·1·1 — The Rust discovery core

Buildable and fully testable with no Cloudflare, no database, and no worker. First, because everything
downstream consumes it and because it is the slice with the most unknowns.

## Task 1 — Crate scaffold on the engine-host seam

Create `crates/discovery-core` as a workspace member: I/O-free, threadless, serde-free, port-free,
targeting native and `wasm32`. Wire `engine_host::format::detect`, `engine_host::wasm_edge` for the
WASM marshalling edge, and the fixed `&'static str` error-code set with the `allowed_code` test that
proves no file content can reach an error payload. Declare every codec backend explicitly and prove
the dependency tree carries no C by asserting the built feature set in a test.

**Done when** the crate builds for both targets, `cargo clippy` is clean, the error-code allow-list
test passes, and a dependency assertion fails if a C-backed feature is selected.

## Task 2 — Format identification

Refine the container-level magic-byte answer into the subtypes extraction routes on: OOXML versus
OpenDocument versus plain archive inside a ZIP; legacy Word, legacy Excel, legacy PowerPoint, and
Outlook `.msg` inside an OLE2; PDF; email (RFC 5322 heuristics for extension-less files); and text with
charset detection. Identification reads bytes only — never the file name — and returns the identified
format plus a confidence, so a low-confidence identification can be surfaced rather than assumed.

**Done when** a fixture corpus covering every format in the design's extraction table identifies
correctly with the extension stripped, and a file whose extension contradicts its bytes identifies by
bytes with the disagreement reported.

## Task 3 — Normalization, chunking, hashing, fingerprinting

The determinism boundary, built before any extractor so every extractor feeds it.

- Canonical Unicode, whitespace, and line-ending normalization applied before anything derived.
- The passage chunker moved out of `packages/search/src/extraction.ts` into the core, keeping the
  page-as-chunk rule and the empty-page-contributes-nothing rule byte-for-byte.
- The five-algorithm digest set in one pass, matching `packages/file-integrity`.
- The SimHash-over-shingles fingerprint.

**Done when** the same input produces byte-identical passages, digests, and fingerprints on the native
and `wasm32` targets in a test that runs both, and the TypeScript chunker's existing test corpus
produces identical output through the core.

## Task 4 — Native extractors

Plain text with charset detection, OOXML (`.docx`, `.xlsx`, `.pptx`) via pure-Rust ZIP and XML part
walking, RTF, PDF text layers over `crates/pdf-core`, and email over `crates/email-core`. Each returns
extracted text, a page count where the format has pages, and a best-available document date with the
source of that date recorded. Each returns a typed engine error, never a panic-as-control-flow, for
corrupt, encrypted, and unsupported input.

Includes the fuzz/hostile-input pass: malformed headers, truncated streams, absurd declared lengths,
deeply nested XML, and billion-laughs entity expansion — each producing a typed error inside the
resource ceiling.

**Done when** every extractor round-trips its fixture corpus; every hostile fixture produces a typed
error rather than a panic, a hang, or unbounded allocation; and the born-digital PDF that the shipped
extraction port currently records as unextractable extracts its real text.

## Task 5 — Archive enumeration and guarded expansion

**Gated on owner decision D2.** Enumerate entries with their metadata without decompressing; expand
under all five guards (nesting depth, total expanded bytes, expansion ratio, entry count, path
traversal) with every guard checked before the first decompressed byte is retained. Encrypted entries
enumerate and report, never fail the archive.

**Done when** a zip bomb trips the ratio guard without exhausting memory, a traversal entry is rejected
unconditionally, a nested archive past the depth ceiling is recorded rather than expanded, an encrypted
entry reports without failing its siblings, and each guard has its own test.

_If D2 is declined:_ build enumeration only (entry names, sizes, and encryption status without
decompression) so an unexpanded archive can still be described honestly in the exception report.

## Task 6 — The container host

`containers/discovery` on the engine-host container pattern (`containers/file-repair` is the reference):
a thin host owning the request and response types and the mappings from the engine's own types, built
with `ready_app` + `with_panic_net`, bound to `0.0.0.0:8080`, repo-root build context, no `r2` feature
(the host receives bytes, it does not egress). An engine error becomes a 422 carrying only the stable
code.

**Done when** `wrangler deploy --dry-run --containers-rollout=none` validates, a panicking handler
returns 500 without killing the container, and a request exceeding the body cap is refused by the
harness rather than the handler.

---

# Build sub-slice 5·1·2 — The review-set model

## Task 1 — Identifiers, permissions, package scaffold

New identifier prefixes with their registry comments: `reviewSet`, `recordCustodian`, `discoveryLoad`,
`reviewDocument`, `reviewDocumentException`, `reviewDocumentOccurrence`. New `discovery:*` permission
keys in the access-control registry, including the review-set-scoped access rule that matter access
does not imply review-set access. New `packages/discovery` package with its area `CLAUDE.md`.

Also: the custodian-vocabulary fitness function — a source scan rejecting a bare `custodian` identifier
outside `packages/custodian` and a `custody*` identifier inside `packages/discovery`.

**Done when** the prefix registry test passes, the permission registry snapshot is regenerated, and the
vocabulary scan fails on a deliberately-introduced bare `custodian` identifier.

## Task 2 — Schema in one migration

`review_set`, `record_custodian`, `discovery_load`, `review_document`, `review_document_exception`,
`review_document_occurrence`, with every CHECK the design names — in particular the exactly-one-of
`file_version_id` / `email_message_id` constraint and the terminal-state constraint on
`processing_state`. `review_set_id` leads every index. The review-set state machine's forward-only
transitions are enforced by trigger, not by convention.

**Done when** a migration test asserts every column and every CHECK, and one test per trigger proves the
transition it blocks.

## Task 3 — Review-set and record-custodian services

Create, rename, lock, close. Closing releases derived artifacts (text, sidecars, splits) for collection
and keeps every row, every manifest, and every exception report. Record custodians are created within a
review set, optionally linked to a Directory entity, with the unattributed case first-class rather than
a null.

**Done when** closing a review set marks its derived objects collectable and leaves its manifests and
exception reports untouched, and a reopen is refused by name.

## Task 4 — The load declaration and the coordinator Durable Object

A load is declared before material arrives. The `DiscoveryLoadCoordinator` Durable Object holds the
load's cursor, chunk state, and progress in durable storage — never in memory — so eviction, deploy,
and hibernation are lossless, and reports progress on the existing per-job progress channel. It
enqueues in chunks against the backlog rather than fanning out from a request.

**Done when** a coordinator evicted mid-fan-out resumes at its cursor without duplicating or skipping a
document, and the ceiling refusal names the count and the ceiling.

## Task 5 — The internal lanes

Resolve a selection of files or filed email to review documents: refuse non-clean versions, expand
email into families using the existing `email_attachment` links, pin `file_version_id` as a snapshot,
allocate rows in measured batches. No bytes move.

**Done when** loading an email produces a family whose parent and attachments share a family
identifier and carry the right roles; a newer version of an already-loaded file does not change the
review set; and a quarantined version is refused by name.

## Task 6 — The external lane

Load through the existing upload session path into a system-owned `Discovery` folder tree with the
origin marker (owner decision D7). Bytes cross the existing quarantine gate unchanged. The load's
declared-versus-actual reconciliation is computed from what actually committed.

**Done when** an external load's bytes carry a scan verdict and a content hash from the existing gate
with no discovery-specific bypass anywhere in the path, and a re-uploaded file already present by hash
is recognized rather than duplicated.

_If D7 is declined:_ the same task against a parallel discovery R2 prefix, plus its own hold,
destruction, tiering, and scan-verdict paths — materially more work, and the reason the recommendation
is what it is.

---

# Build sub-slice 5·1·3 — Processing

## Task 1 — The queue lane and the processing consumer

A `DISCOVERY_PROCESS` queue with its own dead-letter queue and its own concurrency, separate from
every ingest lane. The consumer follows the shipped index-consumer contract exactly: named terminal
outcomes, `deferred` as a first-class non-failure, transient failures rethrown to retry then
dead-letter, structural idempotency from derived identifiers rather than guards. Messages carry
identifiers and keys only.

**Done when** a redelivered message converges rather than duplicating, a bulk load running at full
concurrency leaves interactive file ingest latency unmoved in the load-profile measurement, and a
dead-lettered message is enumerable as a named missing document.

## Task 2 — Extraction routing

The composite extraction port: the discovery core first, the OCR Container only for raster pages with
no text layer, the LibreOffice Container for legacy binaries (owner decision D10). This replaces the
current OCR-only resolution behind the unchanged `TextExtractionPort` interface — a platform-wide
correctness fix, so the existing search pipeline's tests must pass unchanged and one new test must
prove a born-digital PDF now indexes its real text instead of being recorded unextractable.

**Done when** a born-digital PDF is never sent to recognition, a scanned PDF is, a legacy `.doc` routes
to conversion and extracts from the conversion, and every routing decision is recorded on the review
document.

## Task 3 — Text, page count, date, fingerprint, and the sidecar

Write extracted text to its R2 key, the metadata sidecar to its R2 key, and the derived scalars
(`page_count`, `sort_date`, `text_fingerprint`, `format_identified`) to the review document row.
Nothing bulk enters D1.

**Done when** a 250,000-document load-profile run shows no bulk text in the database, and the
fingerprint is stable across a re-processing of identical bytes.

## Task 4 — Deduplication and occurrences

Group by SHA-256 for files and by the existing email dedup key for messages. The first-loaded document
is the primary; every subsequent copy writes an occurrence row carrying its record custodian and its
load. Duplicates are never deleted. Only the primary is extracted, indexed, and embedded.

**Done when** the same document loaded under three custodians yields one primary, three occurrence
rows, one extraction, and one index entry; and "which custodians held this document" is one indexed
query.

## Task 5 — Families and containers

Family identifiers and roles for email families (from `email_attachment`) and, if D2 is approved,
container families (archive as parent, entries as children, each entry re-entering the ingest gate).
Family sequence is stable across a re-processing.

**Done when** a family is one indexed read; an archive's entries carry the archive as parent; and a
declined D2 produces a `container-not-expanded` exception with the enumerated entry list in the
sidecar rather than silence.

## Task 6 — Exceptions and the reconciliation invariant

The exception table, every code in the design's list, and the invariant: a load completes only when
`loaded_document_count = processed_count + exception_count`. A fitness query asserts it across the
whole review set, and the load cannot reach `complete` while it fails.

**Done when** each exception code has a test that produces it from real input, a document that reaches
neither terminal state is impossible to construct, and the reconciliation fitness query fails loudly
against a deliberately corrupted count.

## Task 7 — The manifest and the exception report

Written to R2 at load completion in machine-readable and printable forms: the load identity and
provenance, the reconciliation, one row per document with its five digests and its family and custodian
attribution, the exception counts by code, and the engine and model versions that produced the text.
Never regenerated.

**Done when** a manifest round-trips every field, a re-processing writes a new processing record and
leaves the load manifest byte-identical, and the printable form is readable without tooling.

---

# Build sub-slice 5·1·4 — Indexing, reads, and measurement

## Task 1 — Widen the index scope key to a corpus

**Gated on owner decision D3.** `corpus_kind` + `corpus_id` replacing `matter_id` through
`packages/search/src/split.ts` (the derived key becomes `search/<corpusKind>/<corpusId>/splits/`), the
split-catalog statements, `SearchIndexPort`'s three operations, and the Vectorize partition key. No
published splits exist, so this is a mechanical change with no data migration — which is the entire
argument for doing it in this slice.

**Done when** the existing search suites pass against the widened key, a matter corpus and a review-set
corpus produce non-colliding keys and non-overlapping catalog reads, and a query against one corpus can
be shown to be structurally unable to name the other's splits.

_If D3 is declined:_ review sets index into their matter's corpus, and sub-slice 5·1·4 gains a task for
per-document corpus filtering at query time — slower, and the provable-deletion property in the design
is lost.

## Task 2 — Enqueue review documents for indexing

`enqueueReviewDocumentForIndexing` beside the existing version-keyed enqueue, into the review-set
corpus, through the same coordinator pattern and the same consumer. On a `failed` or `deferred`
outcome the consumer's caller writes a `review_document_exception`, so an unindexed document is visible
in the exception report rather than only in a Durable Object.

**Done when** a full review set can be loaded, processed, deduplicated, family-linked, and
exception-reported with the index engine absent — every document parked `deferred`, the backlog
enumerable — and a later replay drains it into the same derived splits.

## Task 3 — Semantic indexing, opt-in

**Owner decision D4.** `semantic_index_enabled` on the review set gates embedding and upsert entirely:
off, and no passage is embedded and no vector is written. On, embedding runs at load time in bounded
batches against the documented upsert batch size, partitioned per the corrected Vectorize sizing.

**Done when** a review set with the flag off produces no inference call and no vector, the flag can be
turned on afterwards and drains the corpus without re-extracting, and the fusion path returns keyword
results unchanged when the semantic half is empty.

## Task 4 — Reads and routes

The review-set list, the review-document list page (the read every future review surface sits on,
filtered by custodian, load, family, processing state, and exception code), the exception report read,
the load status read, and the occurrence read. Routes are OpenAPI code-as-contract with typed problem
responses. No review UI.

**Done when** every read is a bounded, indexed page with no N+1, and the review-document list page is
measured rather than assumed.

## Task 5 — The load profile

`discovery-generate.ts` and `discovery-measurements.ts` in `packages/fixtures/src/load-profile/`, with
every count as a profile parameter. A standard volume at 25,000 review documents and a `large` volume
at the ceiling. Baselines snapshotted for: load declaration and chunked fan-out; per-document
processing p50 and p95; the review-document list page read; exception report generation; the
reconciliation fitness query; the corpus split-catalog read; and the per-firm database size after a
full load.

**Done when** the ceiling in the design is a number **derived from** the measured database size rather
than asserted, and the batch-size constant carries its measurement beside it.

## Task 6 — Documentation

The area `CLAUDE.md` for `packages/discovery` (including the custodian-vocabulary rule and the
untrusted-bytes rules that bind there); the user guide under `docs/user/` covering review sets, loading,
record custodians, the manifest, and — most importantly for a litigator — how to read the exception
report; the roadmap ledger updates to `roadmap.d/discovery.md`; the status fragment; the changelog
fragment; and the decision fragments for anything the build settled that the design left open.

**Done when** `pnpm run lint:process-refs` and `pnpm run lint:decisions` pass, and the user guide
explains the exception report without a single reference to internal architecture.

---

# Named later slices

- **5·2 — Review.** Filters, tagging and coding, near-duplicate clustering over the fingerprints 5·1
  stored, email threading over `email_thread`, and the review surfaces themselves.
- **5·3 — Production.** Bates numbering over the page counts 5·1 recorded, applied redactions, produced
  images, load-file export, the privilege log, and the production manifest.
- **5·4 — Scale.** Index sharding, parallel recognition, and the per-review-set database seam if the
  ceiling is ever reached.
- **Desktop-local processing.** The same `crates/discovery-core` compiled native in Tauri, with the
  server as fallback — the parity obligation the dual-target build exists to satisfy.
