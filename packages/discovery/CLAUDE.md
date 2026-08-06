# @magna-carta/discovery — CLAUDE.md

**Purpose.** The review-set model: the corpus of documents under review on a matter, and everything
that puts material into one. The review set and its forward-only lifecycle, the record custodian,
the load and its source lanes, the batched allocation of review documents, and the derived R2 key
layout. Validates in memory and composes statements into `@magna-carta/data-access`'s
`composeEffectBatch`; holds no binding, reads no clock, touches no bucket, and never calls an
external service.

**White paper:** _Core domain — Discovery_, with _Tenancy and data isolation_, _Performance &
concurrency model_, and _Matters and File Manager_ (whose version model every review document points
into) as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0003, ADR-0027,
ADR-0039.)
**Spec:** [`docs/specs/2026-08-05-discovery-5-1-design.md`](../../docs/specs/2026-08-05-discovery-5-1-design.md).

## Key files / entry points

- `src/types.ts` — the closed vocabularies: review-set states, custodian kinds, load lanes and
  states, source kinds, family roles, processing states, and the fifteen exception codes
- `src/limits.ts` — every bound, each with the wall it is derived from beside it, and the firm's
  document-ceiling setting
- `src/validation.ts` — every refusal as a code the route maps to a problem type
- `src/load-source.ts` — **the load-source contract, and the home of the transcript control**
- `src/r2-keys.ts` — the derived key layout, and the one place a key is spelled
- `src/review-set-statements.ts` / `src/review-set-service.ts` — create, rename, lock, close
- `src/record-custodian-statements.ts` / `src/record-custodian-service.ts` — whose records these were
- `src/load-statements.ts` / `src/load-service.ts` — declaration, transitions, and the reconciliation
- `src/review-document-statements.ts` — the allocation insert and the family/dedup reads
- `src/internal-lane.ts` — resolving a selection of files or filed email; no bytes move
- `src/external-lane.ts` — the destination and the reconciliation for a received production
- `src/allocation.ts` — planning rows and chunks, pure and deterministic

## Invariants that apply here

- **The word "custodian" never appears alone, anywhere.** The platform ships a register of physical
  client originals whose family is `custody*` and whose person-shaped noun is `custodyOwner`; a
  **record custodian** is a completely different thing — whose electronic records these were — and
  the two appear in the same matter, sometimes on the same screen. Two words, always, in code, in
  schema, in comments, and in anything a person reads. `tooling/lint-custodian-vocabulary.mjs`
  enforces both directions mechanically, and no `custody*` identifier may appear in this package.
- **A review document is a POINTER and never a copy.** It holds no bytes, and it holds no bulk text:
  the extracted text and the metadata sidecar are R2 objects it names by key. A 50,000-document
  review set averaging 30 KB of text is 1.5 GB, and this is the one table in the platform whose size
  is set by an outside party.
- **Loading is a snapshot of a version, not a subscription to a file.** The review document pins
  `file_version_id`. A later version of the underlying file does not change the review set, because
  the corpus under review is what was reviewed; a newer version enters only through a new load,
  which is a recorded act with its own manifest.
- **Exactly two terminal processing states, and there is no third.** `processed` or `excepted`, with
  a named code for every non-success. A document that ends in neither has fallen out of the corpus
  with nobody able to tell, which in discovery is a defensibility failure rather than a cache miss.
  A `BEFORE UPDATE` trigger forbids a direct flip between the two terminal states — a re-processing
  resets to `pending` first, visibly.
- **A load completes only when `loaded = processed + excepted`.** Enforced as a row CHECK on
  `discovery_load` as well as by the service, so a write path nobody has built yet cannot get past
  it. The exception report is what converts "we produced everything we could read" from an assertion
  into a document, and a report that does not reconcile is not one.
- **Deduplication keeps the duplicate.** The row survives, marked non-primary, with an occurrence
  naming its record custodian and its load. "Which custodians held this document" is asked under
  oath, and "we deleted that" is not an answer.
- **A review set moves forward only.** `open` → `locked` → `closed`, enforced by trigger. Closing
  releases a derived CACHE (text, sidecars, splits — all rebuildable from source) and never a
  record: every row, every manifest, and every exception report survives it. There is no reopen.
- **The ceiling is refused, never degraded.** A load past it is refused at declaration with the
  count and the ceiling in the message. The alternative is a firm discovering at 400,000 documents
  that its database is at its hard limit, which is an outage with no good exit.
- **Nothing identifying is a telemetry dimension or an audit-metadata field.** No review-set name, no
  custodian display name, no source description, no file name. Identifiers, lanes, kinds, states, and
  counts, and nothing else — every one of the excluded fields is free text somebody routinely writes
  a person's name into.
- **An exception `detail` is never file content.** The whole pipeline handles privileged material, so
  a detail carrying a fragment of a document is a redaction failure wearing an error message.

## The transcript control — required, and with no default

A load declaration carries `transcriptScope`, and it has **no default in either direction**. The
firm's assistant transcripts are its own work product, and whether the firm's reasoning about a
matter belongs in a corpus it is about to certify the contents of is a decision a person makes
visibly. A silent exclusion decides as much for somebody as a silent inclusion would — it just fails
the other way, and a firm that believed transcripts were in scope would find out after producing.

The control is carried on **every** lane's declaration, not only the lanes that could reach a
transcript, because a load record that sometimes carries the scope and sometimes does not is a record
whose silence means two different things. It is stored on `discovery_load.transcript_scope` so the
manifest can state what the corpus was **drawn from** and not only what landed in it.

`include` is currently refused **by name**, the same device the unbuilt `direct-collection` lane
uses: the lane that resolves transcripts arrives with the review surface. Do not "simplify" this into
a default, and do not make the field optional — a default here is the exact failure the ruling that
produced it forbids.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`, and
  `zod` (for the one firm-setting definition). It depends on no other domain package: a file, a file
  version, an email message, and a Directory entity all arrive as handles, following the
  `matter_party` precedent of an id column with no cross-domain foreign key.
- The route layer (`apps/worker/src/routes/discovery.ts`) hands every service the firm-scoped
  database, the real clock, a crypto random source, and the authenticated actor. None of those is
  client input. The firm's document ceiling is read there and passed in, so this package reads no
  configuration of its own.
- The fan-out coordinator (`apps/worker/src/discovery/discovery-load-coordinator.ts`) holds the
  cursor; `apps/worker/src/discovery/run-internal-load.ts` does the database work. The split is
  deliberate: a Durable Object that wrote the firm's rows would be a second write path with its own
  idea of what a chunk is.

## Gotchas

- **`REVIEW_DOCUMENT_INSERT_BATCH_SIZE` is a placeholder for a measured number.** It is deliberately
  conservative rather than tuned; the load-profile harness that measures the real one lands with the
  discovery profile, and the constant moves when that measurement exists rather than when somebody
  has an opinion.
- **The R2 keys are DERIVED, so their exact bytes are a compatibility contract** with the objects
  already in the bucket. `test/r2-keys.test.ts` pins them byte-identically; changing one is changing
  where every existing object lives.
- **`review_set.document_count` is maintained, not counted.** A `COUNT(*)` over a quarter-million
  rows on the hot path of every load declaration is not a read. It is advanced relatively, in the
  same batch as the rows it counts, so two concurrent chunk commits cannot lose each other's work.
- **The occurrence table's two columns are named for what they hold**, not for the relation:
  `primary_review_document_id` and `duplicate_review_document_id`. The design's
  `duplicate_of_review_document_id` reads backwards to half of everyone on the row that *is* the
  duplicate.
- **`assertVersionsAreClean` refuses, it does not filter.** A firm that selected fifty files and
  silently received forty-eight review documents has a corpus it cannot certify the contents of.
- **A message with no extracted attachments is `standalone`, not `parent`.** A `parent` role on a
  one-member family would make every family read ask "is this a real family", which is the question
  the role exists to answer.
- **The exception and occurrence tables carry `review_set_id` of their own**, redundantly with the
  path through `review_document`. The exception report is a read across the whole review set, and
  joining a quarter-million rows to get there is the read that column exists to avoid.
