# Discovery — ingest and processing — design (slice 5·1)

**Date:** 2026-08-05
**Status:** Design proposed; owner decisions in section 13 are open. No product code in this cycle.
**Scope:** The first built slice of Discovery. What a **review set** is, how documents and email get
**into** one (from the firm's own records and from productions received from other parties), how the
loaded material is **processed** (identified, extracted, hashed, deduplicated, family-linked,
excepted), what belongs in the **shared Rust discovery core** versus a Container, how processed text
reaches the **already-wired index write pipeline**, and what discovery-scale volumes oblige of per-firm
D1, R2 layout, and queue throughput.
**Area:** new `crates/discovery-core`, new `containers/discovery` + `apps/discovery-worker`, new
`packages/discovery`; widening touches on `packages/search`, `packages/data-access`,
`apps/worker/src/search/*`; a new per-firm migration.
**Not in scope:** the review UI, tagging/coding, the privilege log, productions **out**, analytics and
technology-assisted review. Section 14 carries those as named seams.

---

## Why now

Discovery is the furthest-out area on the roadmap and the largest unstarted one, and it is the only
subsystem where a large quantity of substrate has already shipped **dormant**, waiting for a consumer
that does not exist:

- `crates/search-core` has the split format, the build → split → query round trip, multi-split merge,
  generation gating, and a read-only Tantivy `Directory` over a `RangeReader` seam — all unit-tested,
  none of it wired.
- `packages/search` has `SearchIndexPort`, `TextExtractionPort`, the derived split identifier and R2
  key, and reciprocal-rank fusion.
- `apps/worker/src/search/` has the entire write pipeline: an enqueue seam at ingest commit, a
  `SearchIndexJob` Durable Object, a queue consumer with a three-outcome contract (`indexed`,
  `deferred`, `failed`), and structural idempotency on `documentId + version`. Every engine it calls
  reports `engine-not-implemented`, so the pipeline runs and parks.
- `crates/ocr-core` + `apps/ocr-worker` recognize text. `crates/email-core` parses EML, MSG, and mbox
  members, including compressed RTF. `crates/pdf-core` reads glyph positions, redacts, and stamps
  Bates numbers. `packages/metadata` parses OOXML and image metadata. `packages/file-integrity`
  computes the five-algorithm digest set that e-discovery load files specify.

What is missing is not engines. It is **the corpus**: there is no object in the system that says "these
are the documents under review in this matter, this is where each one came from, this is who its
records belonged to, and this is what happened to it when we processed it." Every deferred discovery
feature — filters, tagging, threading, near-duplicates, the privilege log, production — is a function
over that object. 5·1 builds it, fills it, and processes it, and stops before anyone reviews it.

The second reason is that the search-index design (`docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`)
fixed the index's scope key as **the matter** at a time when no corpus concept existed. Splits are
addressed by a key derived from that scope key. Nothing has been published yet, so changing the scope
key is free today and means rewriting every published split later. This slice is the last cheap moment.

---

## 1. What this design is, in one paragraph

A **review set** is a named, matter-scoped corpus with its own index, its own lifecycle, and its own
access story. Material enters it through a **load** — one recorded act of loading, carrying a manifest
of what arrived, from where, on whose authority, and with what hashes. Every loaded thing becomes a
**review document**: a pointer, never a copy, to bytes that live in R2 under the File Manager's
existing version model, attributed to a **record custodian** (whose files these were), tied to its
**family** (an email and its attachments stay together), and carrying the outcome of processing.
Processing runs off the request path in a queue lane of its own, through a new pure-Rust
`crates/discovery-core` for format identification, native text extraction, hashing and fingerprinting,
falling back to the OCR Container for raster pages and the LibreOffice Container for legacy binary
formats. Every document ends in exactly one terminal state, and any state that is not "processed" is
an **exception with a name** written to an exception report that reconciles against the manifest — the
one thing discovery must never do is drop a document quietly. Processed text flows into the already
built index pipeline, whose scope key widens from "matter" to "corpus" so a received production never
mixes with the firm's own working files.

---

## 2. What already exists, and what it obliges

| Shipped thing                                                                                                                    | What 5·1 must respect                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The ingest chokepoint (`initiateUpload` / `completeUploadSession` / `commitVersion`, `packages/file-manager/src/ingest-core.ts`) | Discovery loads **do not** get a private path to R2. Every external byte enters through the same presign → quarantine-as-status-gate → single-read pipeline that does magic-byte sniffing, SHA-256 over `crypto.DigestStream`, policy re-check against real bytes, and the malware-scan port. Untrusted bytes from an opposing party are precisely the case that gate exists for.                                                                             |
| `file` / `file_version` with `content_sha256`, `scan_verdict`, `storage_encoding`, `artifact_role`, `storage_class`              | A review document points at a `file_version`; it never holds bytes and never assumes a version object is raw file bytes (the delta-storage seam). The SHA-256 needed for exact dedup is already computed at ingest — dedup is free at load time.                                                                                                                                                                                                              |
| The email record model (`email_message`, `email_thread`, `email_participant`, `email_attachment`, `email_matter_link`)           | Email is a first-class discovery citizen, not a file. A loaded message becomes a review document pointing at `email_message`; its attachments become review documents pointing at the `file` rows `email_attachment` already created. `email_message.dedup_key` is the email dedup identity — a raw-bytes hash is the wrong one, because transport headers differ between two copies of the same message. `email_thread` is the threading substrate 5·2 uses. |
| The search write pipeline (`enqueue-index.ts`, `index-consumer.ts`, `index-types.ts`)                                            | Its shape is the shape discovery processing copies: enqueue at a commit boundary, a Durable Object per unit of work keyed so a redelivery finds its own job, a consumer with named terminal outcomes, `deferred` as a first-class state, and idempotency that is structural (derived identifiers) rather than guarded. Do not reinvent it; extend it.                                                                                                         |
| `TextExtractionPort` and its documented gap                                                                                      | The port today is backed only by the recognition service, which skips pages that already carry a text layer, so **a born-digital PDF extracts to nothing and is recorded `unextractable`**. That is a platform-wide correctness gap, not a discovery one, and 5·1 closes it because discovery is the consumer that makes it intolerable.                                                                                                                      |
| `packages/file-integrity` (MD5, SHA-1, SHA-256, SHA-384, SHA-512 in one pass, labelled legacy-interop)                           | The exact algorithm set e-discovery load files specify already exists, already labelled correctly. The load manifest uses it.                                                                                                                                                                                                                                                                                                                                 |
| `packages/custodian` and the `custody*` identifier family                                                                        | The word "custodian" is taken by a different real-world thing. Section 3.2 resolves it.                                                                                                                                                                                                                                                                                                                                                                       |
| ADR-0027 (archives stored opaque, never expanded server-side)                                                                    | A production received from another party arrives as a zip. Section 5.4 asks for a narrow, guarded exception inside the discovery load path only.                                                                                                                                                                                                                                                                                                              |
| The engine-host seam (`docs/conventions/engine-host-seam.md`)                                                                    | The new Rust core is I/O-free, threadless, pure-Rust-features-only, dual-target, with the container host owning all HTTP and JSON.                                                                                                                                                                                                                                                                                                                            |

---

## 3. The review-set model

### 3.1 Four nouns

**Review set** — a named corpus under review, belonging to one matter. It owns an index corpus, a
document ceiling, a lifecycle (`open` → `locked` → `closed`), and its own permission scope. A matter
may have several: "Our collection", "Plaintiff's production, March 2026", "Second request". The
default is one, created on demand.

**Load** — one recorded act of putting material into a review set. It is the unit of provenance and
the unit of resumability, and it is what the manifest describes. A load names its **source lane**
(section 3.3), its **record custodian** (or the fact that attribution is per-document), who ran it,
when, and what it claimed to contain. Loads are append-only; a load is never edited, only superseded
or reversed by an explicit removal that is itself recorded.

**Review document** — the reviewable unit. One row per thing a reviewer will eventually see: a file
version, an email message, or an attachment. It is a **pointer plus discovery-specific facts** —
never a copy of content, never bulk text. This is the object every deferred feature is a function
over.

**Record custodian** — whose records these were. A named entity (a person or an organization) whose
files or mailbox the material came from. Attribution is per review document, because one load can
carry several custodians' material.

There is deliberately **no separate family table**: a family is expressed as a self-referencing
`family_id` on the review document plus a `family_role`. Families are trees at most two deep in
practice (a message and its attachments; an archive and its entries), and a junction table would buy
nothing but a join.

### 3.2 The custodian vocabulary — the naming collision, resolved

The platform already ships a subsystem called **Custodian**: the register of physical client originals
the firm holds in safekeeping, with `custodyPacket`, `custodyItem`, `custodyLocation`, `custodyOwner`,
`custodyMovement`, `custodyHold` and the rest of the `custody*` identifier family. Discovery's
"custodian" is a completely different thing — an attribution of authorship and possession over
electronic records, not a physical safekeeping relationship — and the two will appear in the same
matter, sometimes on the same screen.

The rule, and it is mechanical so it can be linted:

- **Nothing in the platform is called a bare `custodian`.** Not a table, not a type, not a column, not
  a variable, not a route segment.
- The physical register keeps **`custody*`** and is referred to in prose as **the Custodian register**
  (capitalized, the subsystem). Its person-shaped noun stays **`custodyOwner`** — already shipped and
  already unambiguous.
- Discovery's attribution is the **record custodian**: identifier prefix `recordCustodian`, table
  `record_custodian`, type `RecordCustodianId`, column `record_custodian_id`, prose "record custodian",
  always both words. It is never abbreviated to "custodian" in code, in schema, in an OpenAPI
  description, or in a comment — this is golden rule 12 applied to a word that means two things.
- A source-scan fitness function (the `lint:process-refs` shape) rejects an identifier matching
  `/\bcustodian\b/i` that is not `recordCustodian` outside `packages/custodian`, and rejects
  `custody*` inside `packages/discovery`.

Two words, not one, is the whole trick: "record custodian" reads naturally to a litigator, carries the
industry meaning, and cannot be confused with the Custodian register by anyone reading either the code
or the screen. The user-facing label is an owner flag (D1) — the recommendation is to print "Record
custodian" in the discovery UI rather than the bare industry term, on the grounds that a firm running
both subsystems will otherwise see one word meaning two things in one matter.

### 3.3 Source lanes — where material comes from

A load declares one lane, and the lane determines what the loader must supply and what the platform
may assume:

| Lane                  | What it is                                                      | What it obliges                                                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `internal-files`      | The firm's own matter documents, selected from the File Manager | No new bytes. The review document points at the existing `file_version`. The hash is already recorded. No re-scan.                                                                                                                                                                   |
| `internal-email`      | Filed email on the matter, selected from `email_matter_link`    | No new bytes. Message and attachments enter as a family.                                                                                                                                                                                                                             |
| `received-production` | Material produced to the firm by another party                  | Bytes are new and hostile. Full ingest gate. The as-received original is preserved byte-exact and never modified. A load file, if one accompanies the production, is parsed for its metadata but is **never trusted over the bytes** — a mismatch is an exception, not a correction. |
| `direct-collection`   | Collected from a client's own system by the firm                | Named now, built later — it needs a collection tool, not an ingest design. A load in this lane is refused by name in 5·1 rather than being silently absent.                                                                                                                          |

The distinction that matters: for the internal lanes the platform already holds the bytes, the hash,
and the scan verdict, so a load is a metadata operation and can be very fast. For
`received-production`, a load is an ingest operation at scale and is the entire reason the queue and
container design in sections 5 and 6 exist.

### 3.4 The tables

Shapes, not final DDL. Every table is per-firm, behind the firm-scoped data-access layer, and holds
pointers and small scalars only — bulk content is in R2 (golden rule 3).

**`review_set`** — `id`, `matter_id`, `name`, `state` (`open` | `locked` | `closed`), `document_ceiling`,
`semantic_index_enabled`, `created_by`, `created_at`, `updated_at`. Unique on
`(matter_id, name)`. `locked` refuses new loads but allows reads; `closed` additionally releases the
index (splits become eligible for collection) while keeping every row and every manifest — closing a
review set destroys a derived cache, never a record.

**`record_custodian`** — `id`, `review_set_id`, `display_name`, `directory_entity_id` (nullable — the
custodian is usually a Directory entity, but a production may name a person the firm has never met),
`kind` (`person` | `organization` | `unattributed`), `created_at`, `updated_at`. Unique on
`(review_set_id, display_name)`. Custodians are review-set-scoped rather than firm-scoped because
"John Smith, custodian" in one matter is not assertably the same person as in another, and asserting
it wrongly is a defensibility problem.

**`discovery_load`** — `id`, `review_set_id`, `lane`, `state` (`declared` | `loading` | `processing` |
`complete` | `failed` | `reversed`), `declared_document_count`, `loaded_document_count`,
`processed_count`, `exception_count`, `default_record_custodian_id`, `source_description`,
`initiated_by`, `initiated_at`, `completed_at`, `manifest_r2_key`, `exception_report_r2_key`. The
counts are the reconciliation: `loaded_document_count` must equal `processed_count + exception_count`
when a load completes, and a fitness query asserts it.

**`review_document`** — the wide one, and the one whose row size the scale section budgets:
`id`, `review_set_id`, `discovery_load_id`, `record_custodian_id`, `source_kind` (`file_version` |
`email_message` | `email_attachment`), `file_version_id` (nullable), `email_message_id` (nullable),
`family_id` (self-reference; equals `id` for a standalone), `family_role` (`standalone` | `parent` |
`attachment` | `container-child`), `family_sequence`, `content_sha256`, `content_md5`, `content_sha1`,
`text_r2_key` (nullable), `page_count` (nullable), `text_fingerprint` (nullable), `dedup_group_id`
(nullable), `is_dedup_primary`, `processing_state` (`pending` | `processing` | `processed` |
`excepted`), `format_identified`, `sort_date`, `created_at`, `updated_at`. Exactly one of
`file_version_id` / `email_message_id` is non-null, enforced by a CHECK.

**`review_document_exception`** — `id`, `review_document_id`, `stage`, `code`, `detail`, `created_at`.
Several per document is normal (a container that was both encrypted and oversize). The presence of any
row with a terminal code is what makes `processing_state = 'excepted'`.

**`review_document_occurrence`** — `id`, `review_document_id` (the primary of the dedup group),
`duplicate_of_review_document_id`, `record_custodian_id`, `discovery_load_id`, `created_at`. Section
5.3 explains why deduplication creates a row rather than deleting one.

`review_set_id` leads the index on every one of these, because every read is "within this review set".

### 3.5 The load manifest

The manifest is the chain-of-custody continuation, and it is an **R2 artifact, not a table** — it is
bulk, it is written once, and it is read by humans and by opposing counsel rather than by queries. It
is written at load completion to `discovery/<reviewSetId>/loads/<loadId>/manifest.json`, with a
rendered text sibling for printing, and it contains:

- The load's identity, lane, source description, who initiated it, and the UTC timestamps of
  declaration and completion.
- The declared and actual document counts, and their reconciliation.
- One row per loaded document: the review document identifier, the original file name and path as
  received, the record custodian, the family identifier and role, the byte size, and the **five
  digests** from `packages/file-integrity` — MD5 and SHA-1 present because opposing-party tooling and
  load-file specifications still ask for them, labelled legacy-interop exactly as that package already
  labels them.
- The exception report by reference, and its counts by code.
- The processing engine versions: the discovery core version, the OCR model set version (already
  pinned and versioned by decision), and the conversion engine version, so a re-processing years later
  can state what changed.

The manifest is never regenerated. Re-processing a review set writes a **new** processing record; the
load manifest describes what arrived, which does not change.

---

## 4. Getting material in

### 4.1 Internal lanes — a selection, not an upload

A user selects files or filed email in the matter and loads them. The operation is: resolve the
selection to `file_version` / `email_message` rows through the existing data-access layer, refuse
anything not `clean` (a quarantined version is not review material), expand email into its family,
allocate review documents, write the load, and enqueue processing. No bytes move. At a few thousand
documents this is a handful of batched writes; at the ceiling it is chunked by the load coordinator
exactly as the external lane is.

The one interesting rule: **loading is a snapshot of a version, not a subscription to a file.** A
review document pins `file_version_id`. If the underlying file gains a new version afterwards, the
review set does not change — the corpus under review is what was reviewed. A new version enters the
review set only through a new load, which is a recorded act.

### 4.2 The external lane — through the existing gate, at scale

A received production is one or more large archives or a directory of loose files. The transfer path
is the one that already exists and is already designed for this case: direct-to-R2, presigned PUT for
small files, resumable S3 multipart above the threshold, bytes never transiting the Worker, per-firm
size and content-type policy enforced at presign and re-verified against the real bytes at the
quarantine gate. Discovery adds nothing to the transfer; it adds a **destination**.

Where the loaded bytes live is owner flag D7. The recommendation is that they become ordinary File
Manager files on the matter, under a system-owned folder tree
`Discovery / <review set name> / <load label>`, marked with an origin discriminator so the matter's
working-file surfaces can exclude them by default. The argument is golden rule 1 at its strongest:
one blob store, one scan gate, one version model, one hash, one legal-hold mechanism, one destruction
policy, one storage-tiering path. A parallel R2 prefix outside the `file` table would duplicate every
one of those and would give discovery its own answer to "is this file under hold", which is precisely
the question that must have exactly one answer.

The load is **declared before the bytes arrive**: the user creates the load, uploads into it, and
completes it. That ordering is what makes the manifest's declared-versus-actual reconciliation
possible, and what makes a load resumable across a dropped connection — the load row and its Durable
Object coordinator survive; the client re-enumerates what is already present by hash.

### 4.3 The ceiling is refused, not degraded

A review set carries a `document_ceiling` (owner flag D8, recommended 250,000). A load that would
carry the review set past it is **refused at declaration by name**, with the count and the ceiling in
the message. This is deliberate: the alternative to a refusal is a firm discovering at 400,000
documents that their per-firm database is at its hard limit, which is an outage with no good exit.
Section 12 explains what the ceiling is derived from and what the seam past it is.

---

## 5. Processing

Processing is per review document, queue-driven, off every hot path, and coordinated per load. Six
stages, in order, each of which can raise an exception and only one of which can be skipped.

### 5.1 Identify

Determine what the bytes actually are, from the bytes. The extension is evidence, not authority, and a
production's file names are frequently wrong. `engine_host::format::detect` gives the container-level
answer (PDF, ZIP, OLE2) and the discovery core refines it: an OLE2 is a legacy Word document, a legacy
Excel workbook, or an Outlook `.msg`; a ZIP is an OOXML package, an OpenDocument package, or a plain
archive; a text-looking file is UTF-8, UTF-16, or something needing charset detection.

A format the platform knows it cannot read is an exception with code `unsupported-format` **and the
identified format recorded** — "we could not read this, and here is exactly what it was" is a defensible
sentence; "extraction failed" is not.

### 5.2 Extract

Text out of native bytes, by a route chosen from the identified format:

| Family                                                         | Route                                                        | Where                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| Plain text, CSV, TSV, JSON, XML, HTML                          | Charset-detect and normalize                                 | `crates/discovery-core`                          |
| PDF with a text layer                                          | Glyph-level text with positions                              | `crates/discovery-core` over `crates/pdf-core`   |
| PDF without a text layer (scanned)                             | Recognition, then the searchable-PDF text layer              | OCR Container                                    |
| OOXML (`.docx`, `.xlsx`, `.pptx`)                              | Pure-Rust ZIP + XML part walk                                | `crates/discovery-core`                          |
| Email (`.eml`, `.msg`, mbox members)                           | Headers, body parts, compressed RTF, attachment enumeration  | `crates/discovery-core` over `crates/email-core` |
| RTF                                                            | Control-word stripping to text                               | `crates/discovery-core`                          |
| Legacy binary (`.doc`, `.xls`, `.ppt`, WordPerfect, older ODF) | Convert to a modern format, then extract from the conversion | LibreOffice Container                            |
| Images                                                         | Recognition                                                  | OCR Container                                    |
| Everything else                                                | Exception, format recorded                                   | —                                                |

Two rules bind the whole table. First, **the native route is tried before the recognition route** — a
born-digital PDF must never be OCRed, because recognition of a document whose real text is already
present is slower, worse, and produces text that does not match the document. Closing that gap is what
turns the existing `TextExtractionPort` from an OCR port into a real extraction port, and it benefits
the whole platform's search, not only discovery. Second, **extracted text goes to R2, never to D1** —
`discovery/<reviewSetId>/text/<reviewDocumentId>.txt`, with the review document holding the key. A
50,000-document review set with an average 30 KB of text is 1.5 GB of text; that number alone settles
the placement question.

Extraction also produces, in the same pass and for the same cost, three things that are expensive to
retrofit and therefore built now:

- **Page count**, which the eventual Bates numbering needs and which cannot be recovered later without
  re-reading every byte.
- **The document date** used for sort and filter — for email the sent time, for a document the best
  available internal date, with the file-system date as the last resort and the source of the choice
  recorded.
- **The near-duplicate fingerprint** (section 5.3).

### 5.3 Deduplicate

Two hash families, and only one of them ships in 5·1.

**Exact duplicates ship.** The identity is the SHA-256 already computed at ingest for files, and
`email_message.dedup_key` for messages — the raw-bytes hash of an email is the wrong identity because
two copies of the same message differ in transport headers, and the email subsystem already solved
this. Duplicates within a review set are grouped: the first-loaded document is the group primary, and
each subsequent copy writes a `review_document_occurrence` row.

**Deduplication never destroys attribution.** The single most consequential rule in this section: the
duplicate document row is **kept**, marked non-primary, and its occurrence row records which record
custodian and which load it came from. "Which custodians held this document" is a question a litigator
asks constantly and an opposing party asks under oath; a deduplication that answers it with "we
deleted that" is a defect. What deduplication buys is that the primary is the one that gets extracted,
indexed, embedded, and eventually reviewed — the expensive operations run once — while the occurrence
rows keep the corpus honest. The dedup scope is owner flag D5; the recommendation is review-set-global
with occurrences preserved, which is the behaviour above.

**Near-duplicates do not ship, but their input does.** Clustering, thresholds, and the reviewer-facing
similarity surface are 5·2. What ships in 5·1 is the **fingerprint**: a deterministic SimHash over
shingles of the normalized extracted text, stored on the review document. It is computed inside the
extraction pass, where the text is already in memory, at effectively no marginal cost. Computing it
later means re-reading and re-extracting the entire corpus, which at discovery scale is not a
migration, it is a second processing run. This is the build-when-in-the-area principle at its clearest.
Owner flag D6.

### 5.4 Families

An email and its attachments are one family and must stay together — a responsive attachment makes its
parent message responsive, a privileged parent taints its attachments, and a production that breaks a
family is a production that will be challenged. The model is `family_id` + `family_role` +
`family_sequence`, with the parent's own identifier as the family identifier, so a family is one
indexed read.

Email families come free: `email_attachment` already ties the `file` rows to the message.

**Container files are the hard case.** ADR-0027 stores uploaded archives opaque and never expands them
server-side, on the sound reasoning that not writing extraction code means not defending a zip-bomb
read path. That reasoning holds for the File Manager. It does not survive contact with discovery,
because **a production received from an opposing party arrives as a zip**, and a discovery subsystem
that cannot open one cannot ingest an external production at all — which is half of what discovery is
for.

The recommendation (owner flag D2) is a **narrow, guarded exception scoped to the discovery load
path**: archives loaded into a review set are expanded; archives uploaded to the File Manager remain
opaque. The expansion is pure Rust (the `zip` crate on its `deflate-flate2` feature over `flate2`'s
default `miniz_oxide` backend — no C on any path, per the engine-host convention), inside the
discovery core, under hard guards checked before any byte is written:

- Nesting depth ceiling (recommended 3), beyond which entries are recorded, not expanded.
- Total expanded-bytes ceiling and expansion-ratio ceiling, both per archive.
- Entry-count ceiling per archive.
- Absolute-path and `..` traversal rejection, always, unconditionally.
- Encrypted entries produce an `encrypted-container-entry` exception, not a failure — the archive's
  other entries still load.
- Every expanded entry re-enters the ordinary ingest gate: magic-byte sniff, hash, malware scan. An
  archive is a transport, not a trust boundary.
- The original archive is retained as the as-received evidence copy, exactly as ADR-0027 intends, and
  becomes the family parent of its entries.

If the owner declines, 5·1 records an unexpanded archive as a review document with a
`container-not-expanded` exception, and external productions must be expanded by the firm before
upload. That is a real, workable fallback; it is just a worse product.

### 5.5 Exceptions

The honest exception report is a design goal, not an error-handling detail. **Every review document
ends in exactly one terminal `processing_state`**, and there are only two: `processed` and `excepted`.
There is no third state and no path that reaches neither, for the same reason the shipped index
consumer enumerates its three outcomes explicitly: a document that ends in none of them has fallen out
of the corpus without anyone being able to tell, and in discovery that is a defensibility failure
rather than a cache miss.

The exception codes, each of which is a different conversation with a court:

`unsupported-format`, `corrupt`, `encrypted`, `password-protected`, `encrypted-container-entry`,
`container-not-expanded`, `container-guard-tripped`, `oversize`, `extraction-timeout`,
`no-text-extracted`, `malware-flagged`, `conversion-failed`, `recognition-failed`,
`load-file-metadata-mismatch`, `source-bytes-missing`.

`no-text-extracted` deserves its own note. A document that yields no text is **not** indexed as empty:
an empty index entry asserts "this document contains no text", which is the one answer a discovery
search must never give wrongly. The shipped extraction port already takes exactly this position, and
5·1 keeps it — the document is excepted, appears in the report, and is visible to a reviewer as
"processed but unsearchable", which is the truth.

The **exception report** is written to R2 alongside the manifest, in both a machine-readable and a
printable form, grouped by code with counts, and the load's completion asserts
`loaded = processed + excepted`. A firm hands that report to opposing counsel; it is the artifact that
converts "we produced everything we could read" from an assertion into a document.

### 5.6 Index

Section 8.

### 5.7 Where each stage runs

| Stage                                                      | Placement                                                                                     | Why                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Identify                                                   | Discovery core, in the discovery Container (WASM in the Worker for one-off re-identification) | Microseconds; runs wherever the bytes are                                                                          |
| Native extraction                                          | Discovery core, discovery Container                                                           | CPU-bound, bursty, unbounded input size — exactly the Container lane the performance model reserves for heavy work |
| Recognition                                                | OCR Container, already deployed                                                               | Model-driven, GPU-adjacent, already its own service                                                                |
| Legacy conversion                                          | LibreOffice Container, already deployed                                                       | The consented, network-isolated C++ engine                                                                         |
| Hash and fingerprint                                       | Discovery core, in the same pass as extraction                                                | Free where the bytes already are                                                                                   |
| Dedup grouping, family linking, exceptions, catalog writes | The app Worker's queue consumer                                                               | Database work, through the firm-scoped data-access layer                                                           |
| Split build                                                | The search Container                                                                          | Already designed and built there                                                                                   |

Nothing in this table puts document parsing in a request handler, and nothing puts a database write in
a Container.

---

## 6. The shared Rust core

### 6.1 What it is

`crates/discovery-core` — a new pure-Rust crate built to the engine-host seam: I/O-free, threadless,
`mmap`-free, serde-free, port-free, no Cloudflare knowledge, bytes in and engine types out. It
compiles to **native** for the discovery Container and the Tauri desktop, and to **WASM** for the
Worker and the browser. The white paper's shared-core intent — write once, WASM for web and native for
desktop, so behavior is identical wherever compute lands — is the reason it exists, and identical
behavior is not a nicety here: **the extracted text feeds a hash and an index, so if the desktop and
the server extract differently, the desktop's index and the server's index disagree about what a
document says.**

### 6.2 What is in it for 5·1

- **Format identification** over `engine_host::format::detect`, refined to the subtypes extraction
  needs to route.
- **Native text extraction** for plain text and charset detection, OOXML, RTF, and PDF text layers
  (delegating to `crates/pdf-core`) and email (delegating to `crates/email-core`).
- **Normalization** — the canonical whitespace, Unicode, and line-ending treatment applied before
  hashing, fingerprinting, and chunking. This is the determinism boundary.
- **The passage chunker** — currently a page-based rule living in `packages/search/src/extraction.ts`
  in TypeScript. It moves into the core so web and desktop produce byte-identical passages, hence
  byte-identical splits and reproducible evidentiary hashes.
- **Hashing** — the five-algorithm set in one pass, matching `packages/file-integrity`.
- **The near-duplicate fingerprint** — deterministic SimHash over shingles.
- **Archive enumeration and guarded expansion**, if owner flag D2 is approved.

### 6.3 What stays out, and why

**OCR stays in `crates/ocr-core` and its Container.** It is already a separate, versioned engine with a
pinned model set, and pulling it into the discovery core would couple the discovery core's version to a
model set's version — which is exactly backwards, since the manifest needs to record them separately.

**LibreOffice stays a Container.** It is C++, it is consented, it is network-isolated, and legacy binary
office formats are the one place where the memory-safe alternatives genuinely do not exist at
acceptable fidelity. Golden rule 14 is satisfied by containment and by the fact that this is an
existing, already-recorded trade, not a new one.

**Tantivy stays in `crates/search-core`.** Splits are a different concern with a different lifecycle.

### 6.4 Golden rule 14, stated for the record

Discovery ingests hostile files at scale — that is the threat model's worst case, not an edge case, and
the harm is server-side remote code execution in our own parsers. Therefore:

- **Every parser added in 5·1 is pure Rust.** No C-backed crate feature on any path: `zip` on
  `deflate-flate2`, `flate2` on default `miniz_oxide`, no `libmagic`, no `poppler`, no `antiword` or
  `catdoc`, no C-compiled-to-WASM.
- **The only memory-unsafe code the pipeline touches is already consented and already contained**:
  LibreOffice for legacy conversion, and clamd in the malware-scan Container.
- **The container fail-safe applies**: a panicking handler returns 500 and never crashes the container
  or reports a silently-wrong success. A parser panic on a malicious file becomes an exception with a
  code, which is the correct product behavior anyway.
- **Error payloads carry stable codes, never file content** — the whole pipeline handles privileged
  material, so the redaction discipline is absolute.
- **No new C/C++ dependency is proposed by this design.** If one becomes unavoidable during build, it
  stops and asks.

### 6.5 The Container and its Worker

A new `apps/discovery-worker` + `containers/discovery`, built to the engine-host container pattern
(`containers/file-repair` is the reference shape), reached only by service binding, `enableInternet`
false, fed by its own queue lane. Owner flag D9 asks whether extraction should instead live inside the
search Container. The recommendation is a separate one: extraction is bursty and CPU-saturating for
hours during a large load, while the search Container's entire design premise is that it stays _warm_
with a resident NVMe cache serving sub-second queries. Sharing them means a bulk load makes review
search slow, which is the one combination a discovery user will actually hit.

---

## 7. Untrusted bytes, restated for this pipeline

The platform's untrusted-file discipline is not new, but discovery is the case it was written for, so
the specifics are worth stating in one place:

1. **Every external byte crosses the quarantine gate.** Presign policy check, magic-byte sniff against
   the real bytes, SHA-256, malware scan port, commit-or-quarantine. Discovery has no bypass, including
   for archive entries.
2. **A flagged file in discovery is evidence.** Quarantine, never auto-delete — the generic
   "delete-infected" default is wrong here, and destruction is blocked by holds. A malware-flagged
   document becomes a review document with a `malware-flagged` exception, present in the corpus,
   present in the manifest, and not opened by any parser.
3. **Loaded bytes are never modified.** No normalization, no re-compression, no metadata scrubbing on
   the as-received original. Every derived artifact is a new object at a new key. Production **out**
   will need this and cannot get it back later.
4. **Guards precede parsing, not the other way round.** Size caps, nesting caps, ratio caps, and entry
   caps are checked before the first byte reaches a decoder.
5. **The scan cache applies.** `packages/file-manager/src/scan-cache.ts` already deduplicates scanning
   by content hash; a production containing 10,000 copies of the same exhibit scans it once.

---

## 8. Indexing

### 8.1 The corpus, not the matter

The shipped pipeline scopes the index by **matter**: the split key is `search/<matterId>/splits/`, the
catalog rows are matter-keyed, and `SearchIndexPort` takes a `matterId`. Discovery breaks that, because
a review set is not a matter and material received from an opposing party must not appear in a search
of the firm's own working files.

The recommendation (owner flag D3) is to widen the scope key **now**, before anything is published, to
a **corpus**: a `corpus_kind` (`matter` | `review-set`) plus a `corpus_id`. Concretely:

- `matterSplitPrefix(matterId)` becomes `corpusSplitPrefix(kind, id)`, producing
  `search/<corpusKind>/<corpusId>/splits/`.
- The split catalog rows key on `(corpus_kind, corpus_id)` instead of `matter_id`.
- `SearchIndexPort`'s `matterId` becomes a corpus reference on `index`, `remove`, and `query`.
- The Vectorize partition key becomes the corpus.

None of this is expensive today: the engine is dormant, no split has ever been published, and the
change is mechanical. All of it is expensive after the first firm has a live index, because a split's
R2 key is derived from the scope key and a rename is a rewrite of every object plus a catalog
migration. This is the same reasoning that put `storage_encoding` on `file_version` before any delta
existed.

### 8.2 Two corpora, indexed twice, deliberately

A matter document loaded into a review set is indexed in **both** corpora. It is tempting to share the
split, and the recommendation is not to, for three reasons:

- **Deletion must be provable.** Closing a review set, or reversing a load of a production that turns
  out to be subject to a clawback, must remove those documents from that index wholesale and
  demonstrably. A shared split makes that a per-document surgery whose completeness is an argument
  rather than a fact.
- **The lifetimes differ.** A matter index lives as long as the matter; a review-set index is a
  working artifact that should be collectable when the review set closes.
- **Splits are a derived cache.** They are rebuildable from source at any time, and R2 storage on
  derived objects is the cheapest line in the budget. Paying twice for storage to buy provable deletion
  is a good trade.

### 8.3 How processed text reaches the pipeline

The shipped write pipeline needs three changes and no new architecture:

1. **The extraction port becomes composite.** `resolveTextExtractionPort` today returns either the
   recognition-backed port or a deferred one. It becomes a router: the discovery core's native
   extraction first, the recognition service only when the core reports a raster page with no text
   layer, the conversion Container for legacy binaries. The port's typed outcomes are unchanged, which
   is the point of having had a port.
2. **The enqueue seam gains a second entry point.** Today `enqueueVersionForIndexing` fires at ingest
   commit, keyed by file version, into the matter corpus. Discovery adds
   `enqueueReviewDocumentForIndexing`, keyed by review document, into the review-set corpus. Both go
   through the same coordinator Durable Object pattern and the same consumer.
3. **The consumer's terminal outcomes gain a fourth caller-visible consequence**: on `failed` or
   `deferred` for a review document, it writes a `review_document_exception`. The consumer's own
   contract does not change; discovery just listens to it.

The `deferred` state is what makes this slice shippable before the search Container is deployed. A
review set can be loaded, processed, deduplicated, family-linked, and exception-reported with the index
engine entirely absent — every document parks as `deferred`, the backlog is enumerable through the job
Durable Objects, and deploying the engine and replaying drains it into the same derived splits.

### 8.4 The semantic half, and an honest correction

The search-index design records a Vectorize ceiling of "~5M vector-dimensions per index", concluding
that a flat index holds only ~5,000 vectors at 1024 dimensions. **That figure is wrong**, and it
matters for discovery sizing: the documented limits are **20,000,000 vectors per index**, 1,536
maximum dimensions per vector, 50,000 namespaces per index, 10 KiB metadata per vector, and topK
capped at 50 with values or metadata (100 without). The corrected sizing:

- At roughly 20 passages per document, a 250,000-document review set is ~5,000,000 vectors — a
  quarter of one index. **Index-per-review-set is the right allocation at the ceiling**, and
  namespace-per-review-set within a firm index is fine below it. Either way the earlier spec's
  conclusion (partitioned, never flat) survives; only the arithmetic changes.
- Storage cost at the platform rate (~$0.05 per 100M dimension-months) for that review set is
  ~5M × 1024 = 5.12 × 10^9 dimensions, about $2.56 per month. Cheap.
- The **embedding** cost is the real one: 5,000,000 passages through the platform embedding model at
  load time is a metered, one-time, non-trivial charge, and it is incurred whether or not anyone runs
  a semantic query.

Therefore owner flag D4: **semantic indexing is off by default and enabled per review set**, with the
keyword half always on. Keyword search is what e-discovery actually runs on — exact terms, phrases,
proximity, boolean — and semantic recall is a genuine enhancement that a firm should choose to pay for
on a corpus-by-corpus basis. The `semantic_index_enabled` flag on `review_set` is the switch, and the
fusion path already handles one engine returning nothing.

---

## 9. Scale honesty

Discovery data is not practice-management data with more rows. A whole firm's matters, contacts, time
entries, ledger entries, and invoices might total 10^5 rows over years. **One small production is
10,000 documents. A moderate matter is 100,000 to 500,000.** The largest table in the firm's database
is about to be created by a subsystem that nobody has used yet, and it is the only table in the
platform whose size is set by an outside party.

### 9.1 D1

The hard facts: **10 GB maximum per database** on the paid plan; **100 bound parameters per query**;
**1,000 queries per Worker invocation**; 100 KB maximum SQL statement; 2 MB maximum row/string/BLOB;
100 columns per table; and — the one that shapes the design most — **D1 databases are single-threaded
and process queries sequentially**, so throughput is one over query duration.

What that obliges:

- **Bulk content to R2, always.** Extracted text, the metadata sidecar, the manifest, the exception
  report, and the splits are all R2 objects. D1 holds the review document row and its pointers. This
  is golden rule 3, and discovery is where violating it would be fatal rather than merely untidy.
- **No entity-attribute-value metadata table.** A production's per-document metadata is open-ended and
  large. It goes to a per-document JSON sidecar in R2, with only the handful of fields that are
  filtered or sorted on promoted to columns. An EAV table at 250,000 documents times 40 attributes is
  10,000,000 rows to buy filtering the platform can do better from the index.
- **A budgeted row.** `review_document` as specified is roughly 400 to 600 bytes of data plus its
  indexes; at 250,000 rows that is a few hundred megabytes including indexes — the largest object in
  the firm database by an order of magnitude, but well inside the cap with room for the rest of the
  firm. At 1,000,000 it is not. The ceiling exists because the arithmetic has an end.
- **Batched writes with a measured constant.** A load must never be N single-row inserts, and it must
  never be one giant batch either: 100 bound parameters per query and 1,000 queries per invocation are
  both real walls. The batch size is a named constant with its measurement recorded beside it, in the
  shape the billing plan already uses, and the load coordinator chunks against it.
- **Named seam past the ceiling.** A per-review-set database (the fleet runner already provisions
  per-firm databases; per-review-set is the same machinery with a different key) or a
  Durable-Object-SQLite-per-review-set. Named, sized, not built. The review document rows are the only
  thing that would move, and they are already accessed exclusively through the review set, which is
  what makes the seam viable.

### 9.2 R2

The layout, all under the firm's bucket:

```
discovery/<reviewSetId>/loads/<loadId>/manifest.json
discovery/<reviewSetId>/loads/<loadId>/exceptions.json
discovery/<reviewSetId>/text/<reviewDocumentId>.txt
discovery/<reviewSetId>/metadata/<reviewDocumentId>.json
search/review-set/<reviewSetId>/splits/<splitId>.split
```

Native bytes are not in this layout — they are File Manager objects at File Manager keys, pointed at,
never copied. That single decision removes the largest storage line discovery would otherwise add.

R2 has no object-count ceiling, but **a listing is never used to enumerate anything**: the catalog and
the database are authoritative, exactly as the search design already requires. At 250,000 documents
the derived objects number about 500,000 per review set, and every one of them is reachable by a
derived key. Class A operations during a load and Class B during query are the cost lines; the
compaction cadence is the lever on the second, and it is already the search design's lever.

Derived artifacts are **collectable**: closing a review set makes its text, sidecars, and splits
eligible for deletion, because all three are rebuildable from source. The manifest and the exception
report are not — they are records, and they are kept.

### 9.3 Queues

The hard facts: **128 KB per message**, 100 messages per batch, **5,000 messages per second per
queue**, **250 concurrent consumer invocations**, 25 GB backlog per queue, 15 minutes wall clock per
invocation, 30 seconds CPU default (configurable to 5 minutes), up to 100 retries.

What that obliges:

- **A dedicated discovery lane.** A new `DISCOVERY_PROCESS` queue with its own dead-letter queue, so a
  250,000-document load cannot starve interactive file ingest. The precedent is already in the
  configuration: `FILES_INGEST` and `FILES_INGEST_BULK` route to the same handler and differ only in
  queue topology and concurrency. Discovery is the same pattern with a different handler.
- **Fan-out from a coordinator, not from a request.** A load does not enqueue 250,000 messages from a
  Worker handling an HTTP request. The load's Durable Object coordinator enqueues in chunks, holds the
  cursor in durable storage, applies backpressure against the backlog, reports progress on the
  existing per-job Durable Object progress channel, and resumes after eviction or deploy. This is the
  checkpointing rule the platform already states for long jobs.
- **Messages carry pointers.** A message is identifiers and keys — never bytes, never text. 128 KB is
  generous for that and would be absurd for content.
- **The honest arithmetic.** At 250 concurrent consumers and a per-document processing time dominated
  by extraction, a 100,000-document load with a 1-second average is roughly 7 minutes of wall clock;
  with a 5-second average (OCR-heavy scanned material) it is roughly 35 minutes. Both are fine. What is
  not fine is a synchronous path, and there is not one.

### 9.4 Load-profile obligations

A slice is not built here until it is measured, and discovery's load profile is a new one because no
existing profile has an object at this cardinality. What 5·1 owes
`packages/fixtures/src/load-profile/`:

- **A generator** (`discovery-generate.ts`) laying down review sets, record custodians, loads, review
  documents with realistic family and duplicate distributions, exceptions at a realistic rate, and the
  R2-shadow rows the other generators already model. Every count is a profile parameter, never a
  generator constant.
- **Two volumes**: a standard profile at 25,000 review documents in one review set, and a `large`
  profile at the ceiling.
- **Measurements** (`discovery-measurements.ts`) with snapshotted baselines for: the load declaration
  and chunked fan-out; per-document processing at the p50 and p95; the review-document list page read
  (the read every future review surface is built on); the exception report generation; the
  reconciliation fitness query; the corpus split-catalog read; and — the one no other subsystem
  measures — **the per-firm database size after a full load**, which is the number the ceiling is
  derived from and must be re-derived against.

---

## 10. Defensibility, restated as properties

Everything above serves five properties that a court, an opposing party, or a bar examiner can test:

1. **Nothing enters without a record.** Every review document names its load; every load names its
   source, its operator, and its time.
2. **Nothing is dropped silently.** Two terminal states, a named exception code for every non-success,
   and a reconciliation assertion that the counts add up.
3. **Nothing is altered.** The as-received bytes are never modified; every derived artifact is a new
   object; the original hash is recorded at ingest and re-verifiable at any time through the shipped
   integrity tooling.
4. **Attribution survives deduplication.** Occurrence rows, not deletions.
5. **Everything is reproducible.** The index is a derived cache rebuildable from source; the manifest
   records the engine and model versions that produced the text, so a re-processing years later can
   state exactly what changed.

---

## 11. Permissions and holds

Discovery permissions are a new scope (`discovery:*`) in the existing access-control registry, and the
one non-obvious rule is that **review-set access is not implied by matter access**. A received
production may be attorney's-eyes-only under a protective order, and a platform that leaks it to
everyone with matter access has caused a real problem. The recommendation is: a review set carries its
own access list, defaulting to the matter team, narrowable per review set.

Legal holds compose rather than duplicating: a review document's underlying `file_version` is already
protected by the existing hold and destruction machinery, and a live review set is an additional hold
reason on every version it points at. Discovery does not get its own hold table; it gets a hold source.

---

## 12. The ceiling, derived

The recommended `document_ceiling` of 250,000 per review set is not a round number chosen for
comfort. It is the point at which the arithmetic in section 9.1 leaves the firm database comfortably
inside 10 GB with the rest of the firm's data, the point at which the semantic index sits at a quarter
of one Vectorize index, and roughly an hour of wall clock for a full OCR-heavy load. It is a
**parameter**, not a constant: per-firm, adjustable, refused above rather than degraded, and re-derived
against the load-profile measurement rather than defended by argument. Owner flag D8.

---

## 13. Owner decisions

Each carries a recommended default. Approving the recommendations approves the design as written.

| #       | Decision                                                                                       | Recommended default                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | UI label for discovery's custodian attribution                                                 | **"Record custodian"** in the discovery UI, matching the code vocabulary — a firm running the Custodian register too will otherwise see one word meaning two things in one matter                         |
| **D2**  | Expand archives in the discovery load path (a narrow exception to the opaque-archive decision) | **Yes** — expand inside the discovery load path only, pure-Rust, under depth/ratio/count/traversal guards, with the original retained as the as-received evidence copy; File Manager archives stay opaque |
| **D3**  | Widen the search index scope key from matter to corpus (`corpus_kind` + `corpus_id`) now       | **Yes** — free today with a dormant engine and no published splits; a rewrite of every object later                                                                                                       |
| **D4**  | Semantic (Vectorize) indexing at load                                                          | **Off by default, enabled per review set** — keyword always on; embedding a large corpus is a real metered cost a firm should choose                                                                      |
| **D5**  | Deduplication scope                                                                            | **Review-set-global, with occurrence rows preserved** — the duplicate row is kept and attributed, never deleted                                                                                           |
| **D6**  | Compute the near-duplicate fingerprint in 5·1 (clustering in 5·2)                              | **Yes** — free inside the extraction pass, a full re-processing run to retrofit                                                                                                                           |
| **D7**  | Where externally loaded bytes live                                                             | **File Manager files** on the matter under a system `Discovery` folder tree with an origin marker — one blob store, one scan gate, one hold mechanism                                                     |
| **D8**  | Per-review-set document ceiling                                                                | **250,000**, refused above by name with the count and the ceiling in the message; a per-firm parameter                                                                                                    |
| **D9**  | Extraction engine placement                                                                    | **A new `containers/discovery` + `apps/discovery-worker`**, separate from the search Container, so a bulk load never makes review search slow                                                             |
| **D10** | Legacy binary formats (`.doc`, `.xls`, `.ppt`, WordPerfect)                                    | **Route through the existing consented LibreOffice Container** — no new C/C++ dependency is introduced by this design                                                                                     |

---

## 14. Named seams, not built here

- **Review UI** — every surface a reviewer touches. 5·1 builds the corpus and the reads it will page
  through; it renders nothing. The `review_document` list read is measured in 5·1 precisely because it
  is the read the whole review experience sits on.
- **Tagging and coding** — responsive, privileged, confidential, issue codes, coding layouts, bulk
  operations, and the propagation rules (a tag on a family parent, a tag applied to a dedup group's
  occurrences). Needs its own model; the `dedup_group_id` and `family_id` columns are what it will
  propagate along.
- **Privilege log** — generated from privilege tags plus the metadata 5·1 extracts. The reason 5·1
  extracts and stores the document date and the participant set is that a privilege log is a function
  over exactly those fields.
- **Productions out** — Bates numbering, applied redactions, produced-image generation, load-file
  export, and the production's own manifest and hashes. The reason 5·1 records `page_count` at
  extraction is that Bates numbering needs it and it cannot be recovered later without re-reading the
  corpus. The reason 5·1 never modifies loaded bytes is that a production must be able to state what
  the original was.
- **Near-duplicate clustering and email threading** — 5·2. The fingerprint and `email_thread` are their
  inputs, and both already exist after 5·1.
- **Analytics and technology-assisted review** — deferred by decision; the semantic half and the
  extracted text in R2 are its substrate.
- **Direct collection** — a load lane that is declared and refused in 5·1 so its absence is visible.
- **Desktop-local processing** — the whole reason the discovery core is dual-target. The Tauri client
  runs the same crate natively over local bytes and uploads results; identical output is what makes
  that safe, and it is the parity obligation.
- **Index sharding and massively parallel OCR** — already named as widenings of the search design, not
  rewrites of it.
- **True redaction's licensing question** — the white paper carries the AGPL-versus-permissive routes
  to "the Discovery build". 5·1 is not that moment: it ingests, it does not redact. The question lands
  with productions out.

---

## 15. Open questions

- **Load-file parsing (DAT/OPT/LFP) for received productions.** 5·1 reads a production's bytes and
  derives its own metadata. Whether it also parses an accompanying load file, and how a conflict
  between the load file and the bytes is presented, is real work with real format variance. The
  design's position is that the bytes win and a mismatch is an exception; the parser itself is
  unscheduled.
- **Charset detection quality for legacy material.** Pure-Rust charset detection is available and good;
  it is not perfect on short legacy documents. The fallback behavior and whether a low-confidence
  detection should raise an exception is open.
- **Whether the extracted-text object should be compressed.** It is highly compressible and it is the
  bulk of discovery's derived storage, but the active corpus is deliberately uncompressed elsewhere to
  keep range-streaming available. Extracted text is not range-streamed, so the argument may differ.
  Measure first.
- **The exact batch size for load writes**, which is a measured constant, not a chosen one.
- **Whether `record_custodian` should be firm-scoped with a per-review-set alias** rather than
  review-set-scoped, once a firm has run several matters against the same opposing party. The
  recommendation is review-set-scoped for now because asserting cross-matter identity wrongly is worse
  than asserting it not at all.
