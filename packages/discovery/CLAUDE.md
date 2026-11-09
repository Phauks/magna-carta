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
- `src/review-set-visibility.ts` — **the access seam**: the one predicate every review-set statement
  composes, and the marker the fitness pass proves it by
- `src/review-set-access-statements.ts` / `src/review-set-access-service.ts` — the access list itself
- `src/coding-statements.ts` — every coding read and write, and `ACCESS_SCOPED_BUILDERS`, the registry
  the visibility fitness pass enumerates
- `src/coding-panel-service.ts` — the seeded panel, and creating/renaming/deactivating questions and
  tags
- `src/coding-service.ts` — applying, removing, family and bulk gestures, and exact undo
- `src/processing.ts` — how an extraction's derived facts are stored, and the sidecar's shape
- `src/processing-statements.ts` — the dispatch read, the three terminal writes (text, container, and
  exception), the parked write, the exception insert, and the reads the report and the reconciliation
  stand on
- `src/dedup.ts` / `src/dedup-statements.ts` — **what makes two review documents the same document**,
  the one guarded claim on primacy, and the occurrence rows a suppressed copy stays reachable through
- `src/manifest.ts` — the two record artifacts as PURE text, and the three rules that make them
  reproducible
- `src/manifest-statements.ts` — the keyset-ordered walks both artifacts are built from
- `src/review-reads.ts` — **the member-facing reads**, all nine access-scoped: the review-set list,
  the review set and its loads, the review-document list page and its undated tail, the exception
  surface, and the occurrences. Its own `ACCESS_SCOPED_REVIEW_READS` registry, swept by the same
  fitness pass as the coding builders
- `src/index-statements.ts` — where a review document stands with the SEARCH index, and the backlog
  reads over it

## Invariants that apply here

- **The word "custodian" never appears alone, anywhere — and the code's word is not the reader's
  label.** The platform ships a register of physical client originals whose family is `custody*` and
  whose person-shaped noun is `custodyOwner`; the discovery attribution — whose electronic records
  these were — is a completely different thing, and the two appear in the same matter, sometimes on
  the same screen. So there are exactly two permitted forms and no third.
  **`record_custodian` / `recordCustodian`** is the code word: identifiers, tables, columns, route
  paths, refusal codes, and comments. **"Custodian of Record"** is what a person reads: the owner
  named it, and it is what belongs in an OpenAPI `description`, a refusal sentence a route surfaces
  as a problem `detail`, a field label, and [`docs/user/`](../../docs/user/). Neither is ever
  shortened to the bare word. `tooling/lint-custodian-vocabulary.mjs` enforces all of it
  mechanically — both permitted forms, and no `custody*` identifier anywhere in this package.
- **The list page is keyset-paged in TWO segments, and the second one is not an optimization.** A
  production routinely arrives with documents nothing can date, and a descending sort puts those
  after every dated one. A single keyset predicate over a nullable column either drops the whole
  undated tail (any comparison with NULL is NULL) or is written as an OR the planner cannot turn into
  a range. The dated segment and the undated tail are separate statements over the same index, and
  the cursor distinguishes "no cursor" from "a cursor on an undated document" — collapsing those two
  restarts the walk at the top every time it reaches the tail. The dated segment's predicate is a
  ROW VALUE, `(sort_date, id) < (?, ?)`, not the equivalent OR: SQLite seeks on the first and scans
  from the end of the index on the second, measured at 0.26 ms against 10.3 ms at the ceiling.
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
- **"We have not read it yet" is not one of them, and it is not an exception either.** A document an
  UNDEPLOYED engine has not reached stays `pending` carrying `processing_deferred_reason`. Recording
  it `excepted` would say the platform tried and the document could not be read — untrue, and worse,
  it would put a number in an exception report a firm hands to opposing counsel that a later deploy
  silently changes. The reason lives on the row so what a review set is still owed is one indexed
  read over the corpus rather than a question only a dead-letter queue can answer, and it is cleared
  on the next attempt so it can never be stale.
- **A processed row always names the format it was read as AND the engine that read it.** The format
  is held by a CHECK; the route is not, because there is no `ALTER TABLE ADD CONSTRAINT` in SQLite
  and the per-firm lineage is additive-only. The write statement is the only path that sets
  `processing_state = 'processed'` and it always binds both — `test/processing-statements.test.ts`
  holds the rule where the schema cannot.
- **The processing statements take no access predicate, and that is not an omission.** The access
  list governs what a MEMBER may read; the processing consumer runs off a queue with no member and no
  session, over a corpus the platform itself put there. There is nobody to check, and composing a
  predicate with nobody bound would be a clause matching whatever the previous binding happened to
  be. Anything a member reaches goes through `ACCESS_SCOPED_BUILDERS` and its fitness pass.
- **The INDEX is a different stage with a different answer, and it is not an exception.** A document
  that has been read but not yet indexed is recorded in `index_state` / `index_deferred_reason` on
  its own row — the same shape `processing_deferred_reason` gives the stage before. It is deliberately
  not a `review_document_exception`: that vocabulary is a CHECK-enforced closed list in which every
  code is a sentence about what could not be READ, and every one is rendered into a report a firm
  hands to another party, so "our own search index has not caught up" is not one of them and a later
  deploy would silently change the number. The one index-stage failure that IS about the document —
  its derived text gone from the bucket — files the existing `source-bytes-missing`.
- **The extracted-text object separates pages with a FORM FEED, and that is a compatibility
  contract.** It has two readers with opposite needs: a person opening a plain text file, and the
  index, which needs the pages back as the passages they were so a hit can name its page. A form feed
  is what a page break in a text file has been since line printers and cannot occur inside a passage,
  because normalization drops every control character before anything derived is derived. A blank
  line could not make that promise. Where the block count and the sidecar's page list disagree, the
  reader REFUSES rather than pairing positionally.
- **A load completes only when `loaded = processed + excepted`.** Enforced as a row CHECK on
  `discovery_load` as well as by the service, so a write path nobody has built yet cannot get past
  it. The exception report is what converts "we produced everything we could read" from an assertion
  into a document, and a report that does not reconcile is not one.
- **Deduplication keeps the duplicate.** The row survives, marked non-primary, with an occurrence
  naming its record custodian and its load. "Which custodians held this document" is asked under
  oath, and "we deleted that" is not an answer. The copy still reaches its own terminal state,
  mirroring the primary's — including inheriting the primary's named codes on its own row when the
  primary is one nothing could read, so a custodian who held an encrypted document is counted as
  having held one.
- **The identity is a content hash, never the near-duplicate fingerprint.** Both live on the same row
  and only one of them is an identity. The fingerprint is a similarity score that COLLIDES BY DESIGN,
  which is what makes it useful for clustering and disqualifying for suppression: a document
  suppressed from review is a document nobody reads, and deciding that on a heuristic is not a
  decision this layer gets to make. A document with no recorded hash gets no group at all rather than
  a group of one — the platform declines to assert anything about bytes nobody hashed.
- **Primacy is taken once, held by the database, and never moves.** `claimDedupPrimaryStatement` is a
  single statement whose `WHERE NOT EXISTS` refuses the claim while a holder exists, and the partial
  unique index on `(review_set_id, dedup_group_id) WHERE dedup_group_id IS NOT NULL AND
  is_dedup_primary = 1` is the same rule held for the write path nobody has written yet. A read
  followed by a write would let two consumers each see "nobody holds it".
- **The record artifacts are reproducible, and that is a property of `src/manifest.ts` rather than a
  habit.** It reads NO CLOCK: the knowledge instant is an argument, and the caller passes the load
  row's `updated_at` — the moment its last counter moved, and therefore the moment the corpus stopped
  moving for that load. Every set it renders arrives keyset-ordered by identifier, and nothing is
  derived from the environment. `test/manifest.test.ts` renders twice and compares bytes, and scans
  the module for a clock. Taking `now` would make every rebuild a different document, which is the
  difference between a record and a snapshot.
- **An exception row may sit on a document whose terminal state is `processed`.** A container that
  expanded fifty entries and skipped two encrypted ones is the case: it processed, and it still owes
  the reader a sentence about the two. The report renders the terminal state beside every reason, so
  a reader tells them apart without inferring; the reconciliation counts STATES and is untouched.
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
- **The review-set access predicate is a REQUIRED argument to every statement that touches review-set
  content, composed into the `WHERE` clause before the `LIMIT`.** Required rather than optional so the
  omission is a type error first and a fitness failure second. Composed in SQL and never applied in
  the Worker after the rows come back: a post-filter under-fills the page and turns the page size into
  an existence oracle for the rows it removed, which on a corpus that may be attorneys'-eyes-only is
  the difference between a wall and a hint. `test/review-set-visibility-fitness.test.ts` proves it for
  every builder in `ACCESS_SCOPED_BUILDERS` from one table-driven pass, scans the source so the
  registry cannot fall behind the file, and asserts behaviourally that the predicate excludes.
- **The access list is FAIL-CLOSED and never empty.** No row means no access, so a bug in the seeding
  path hides a corpus rather than disclosing one — and only one of those two failures gets noticed. A
  new list is seeded in the same batch as the review set's insert, and the last member cannot be
  removed, because under fail-closed an empty list is permanent short of a migration.
- **The unit of tag storage is one row per (document, tag) application** — never an inherited one.
  Family and bulk are SCOPES, not storage: the event records the gesture, the rows record the result,
  and a production reads rows and only rows. Inheritance resolved years later at production time is
  where a bug becomes a produced privileged document.
- **Single choice is structural, not guarded.** A partial unique index on
  `(review_document_id, review_tag_group_id) WHERE removed_at IS NULL AND single_choice = 1`. The
  denormalized `review_tag_group_id` and `single_choice` columns exist so that index can be written at
  all — an index cannot reach through a join, so without them the rule would be a service guard two
  concurrent writers walk straight past.
- **Coding rows are never deleted; removal is a state with an actor and an instant.** That is what
  makes the coding history of one document one indexed read years later, and it is held by a CHECK
  that refuses half a removal.
- **Semantics drive the machine, names never do.** Production membership, privilege logging and
  completion arithmetic read `review_tag.semantic` only. A tag created through the API carries none,
  so a renamed label can never change what a production withholds; a tag that carries one cannot be
  deactivated, because hiding "Privileged" would remove the only way to withhold anything.
- **Coding writes NO generic audit row.** The `review_tag_event` journal is the audit and is richer
  than the generic row — scope, criteria, frozen selection, reversal. Two homes for one fact drift.
  Panel edits and access-list changes are not coding decisions and DO write one.

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
- The route layer (`apps/api-worker/src/http/routes/discovery/discovery.ts`) hands every service the firm-scoped
  database, the real clock, a crypto random source, and the authenticated actor. None of those is
  client input. The firm's document ceiling is read there and passed in, so this package reads no
  configuration of its own.
- The fan-out coordinator (`apps/api-worker/src/discovery/discovery-load-coordinator.ts`) holds the
  cursor; `apps/api-worker/src/discovery/run-internal-load.ts` does the database work. The split is
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
  `duplicate_of_review_document_id` reads backwards to half of everyone on the row that _is_ the
  duplicate.
- **`assertVersionsAreClean` refuses, it does not filter.** A firm that selected fifty files and
  silently received forty-eight review documents has a corpus it cannot certify the contents of.
- **A bulk coding selection DOES filter, and that is the opposite rule for the opposite reason.** A
  document id naming another corpus vanishes from the selection rather than being refused by name:
  refusing it by name confirms the id exists to somebody who cannot see it. The load rule protects a
  corpus a firm must certify; this one protects a corpus somebody must not learn about.
- **A bulk coding operation is several batches, not one transaction.** A ceiling-sized selection
  cannot be one atomic write anywhere, which is what the event's `running` state is for: a run that
  dies part-way leaves exactly the rows it wrote attributed to it, and an undo reverses exactly those.
- **Bulk selections live under `discovery/<reviewSetId>/selections/` and are RECORDS, not caches** —
  deliberately outside `reviewSetDerivedPrefixes`, so "which documents did that act touch" survives
  the review set closing. That is the question asked when a production drawn from this coding is
  challenged.
- **A message with no extracted attachments is `standalone`, not `parent`.** A `parent` role on a
  one-member family would make every family read ask "is this a real family", which is the question
  the role exists to answer.
- **The exception and occurrence tables carry `review_set_id` of their own**, redundantly with the
  path through `review_document`. The exception report is a read across the whole review set, and
  joining a quarter-million rows to get there is the read that column exists to avoid. The exception
  table carries `discovery_load_id` too, for the same reason one grain finer: the report is written
  per load.
- **The exception walk pages on the PAIR `(review_document_id, id)`, never on the document alone.**
  Several reasons on one document is normal, so a page boundary can fall inside one — resuming from
  the document would skip the reasons after the boundary, and a dropped reason reads as a document
  that had no trouble.
- **The manifest carries three digests, not the design's five.** The shipped row has three columns,
  and no e-discovery load-file specification asks for SHA-384 or SHA-512. MD5 and SHA-1 reach the row
  from the extraction engine's own pass over the bytes and are rendered LABELLED as legacy-interop;
  `content_sha256` stays the ingest gate's value and no engine overwrites it, because two authorities
  on whether two documents are the same document is one too many.
