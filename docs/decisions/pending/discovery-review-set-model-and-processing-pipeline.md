---
slug: discovery-review-set-model-and-processing-pipeline
status: Proposed
area: Discovery
date: 2026-08-05
summary: "THE OBJECT DISCOVERY WAS MISSING IS THE CORPUS, NOT AN ENGINE: search-core, the split format, the SearchIndexPort, the whole enqueue-coordinator-consumer write pipeline, OCR, email parsing, PDF glyph reading, and five-algorithm hashing all shipped dormant, and every deferred discovery feature — filters, tagging, threading, near-duplicates, privilege log, production — is a function over one object nobody had built: the REVIEW SET, a matter-scoped corpus filled by recorded LOADS whose REVIEW DOCUMENTS are pointers, never copies, attributed to a RECORD CUSTODIAN. The naming collision with the shipped Custodian register of physical originals is resolved mechanically rather than by convention: nothing anywhere is a bare `custodian` — the physical register keeps `custody*` and its `custodyOwner`, discovery gets `recordCustodian` / `record_custodian` in two words always, and a source scan enforces both directions, because two words read naturally to a litigator and cannot be confused by anyone reading either the code or the screen. DEDUPLICATION NEVER DESTROYS ATTRIBUTION — the duplicate row is kept, marked non-primary, and carries an occurrence row naming its custodian and its load, because 'which custodians held this document' is asked under oath and 'we deleted that' is not an answer; what dedup buys is that only the primary is extracted, indexed, and embedded. EVERY DOCUMENT ENDS IN EXACTLY ONE OF TWO TERMINAL STATES, processed or excepted, with a named code for every non-success and a reconciliation assertion that loaded equals processed plus excepted — the honest exception report is the artifact that converts 'we produced everything we could read' from an assertion into a document. A new pure-Rust dual-target `crates/discovery-core` owns format identification, native extraction, normalization, the passage chunker moved out of TypeScript, hashing and the near-duplicate fingerprint, so web and desktop produce byte-identical passages and therefore identical splits and reproducible evidentiary hashes; OCR and LibreOffice stay Containers, and NO NEW C/C++ DEPENDENCY IS INTRODUCED. The opaque-archive rule is narrowed inside the discovery load path only, under five guards checked before the first decompressed byte, because a production received from an opposing party arrives as a zip and a discovery subsystem that cannot open one cannot ingest an external production at all. The index scope key widens from matter to CORPUS now, while the engine is dormant and no split has ever been published, because the split's R2 key is derived from it and a rename later is a rewrite of every object; the two corpora index the same document twice on purpose, because provable wholesale deletion of a clawed-back production is worth more than the storage on a derived cache. SEMANTIC INDEXING IS OFF BY DEFAULT per review set, and the earlier spec's Vectorize ceiling is CORRECTED — 20,000,000 vectors per index, not ~5,000 — which changes the arithmetic but not the partitioned-never-flat conclusion. Scale is stated in numbers rather than adjectives: one small production is 10,000 documents, the review-document table becomes the largest in the firm database by an order of magnitude, and the per-review-set ceiling is REFUSED ABOVE BY NAME rather than degraded, because the alternative is a firm discovering at 400,000 documents that its 10 GB database is full, which is an outage with no good exit."
---

**Discovery 5·1 builds the corpus the shipped engines have been waiting for, and settles the four
things that are cheap now and expensive forever after: the vocabulary, the index scope key, the
fingerprint, and the page count.**

**Context:** Discovery is the largest unstarted area and the one with the most substrate already on
the tree. `crates/search-core` has the split format, the build-split-query round trip, generation
gating, and a range-reading Tantivy directory. `packages/search` has the port seams and the derived
split key. `apps/worker/src/search/` has the entire write pipeline running and parking on
`engine-not-implemented`. OCR, email parsing, PDF glyph reading, OOXML metadata, five-algorithm
hashing, and the untrusted-upload gate all ship. What does not exist is any object that says which
documents are under review, where each came from, whose records they were, and what happened when we
processed them.

**Decision:**

1. **Four nouns.** A **review set** is a matter-scoped corpus with its own index, lifecycle, and
   access list. A **load** is one recorded act of putting material in, and the unit of provenance and
   resumability. A **review document** is the reviewable unit — a pointer plus discovery facts, never
   a copy. A **record custodian** is whose records these were. Families are a self-referencing
   `family_id` plus a role, not a junction table.

2. **The custodian vocabulary is mechanical, not conventional.** Nothing anywhere is a bare
   `custodian`. The physical register keeps `custody*` and `custodyOwner`; discovery gets
   `recordCustodian` / `record_custodian` / "record custodian", always two words, in code, schema,
   comments, and consumer-facing strings. A source scan enforces both directions.

3. **Four source lanes**, because what the platform may assume differs: `internal-files` and
   `internal-email` move no bytes and reuse the recorded hash and scan verdict; `received-production`
   is an ingest operation at scale through the existing quarantine gate, where an accompanying load
   file is parsed but never trusted over the bytes; `direct-collection` is refused by name so its
   absence is visible.

4. **Deduplication keeps the duplicate.** Exact only in 5·1 — SHA-256 for files, the existing
   `email_message.dedup_key` for messages, because a raw-bytes hash of an email is the wrong identity.
   The duplicate row survives, marked non-primary, with an occurrence row naming its custodian and
   load. Near-duplicate **clustering** is 5·2; the **fingerprint** is computed in 5·1 inside the
   extraction pass, because retrofitting it is a second full processing run.

5. **Two terminal states and an honest exception report.** `processed` or `excepted`, never neither,
   with fifteen named codes; a document that yields no text is excepted rather than indexed empty,
   because an empty index entry asserts the one thing a discovery search must never say wrongly. The
   load completes only when loaded equals processed plus excepted, asserted by a fitness query.

6. **A new pure-Rust dual-target `crates/discovery-core`** on the engine-host seam owns format
   identification from bytes, native extraction (text, OOXML, RTF, PDF text layers, email),
   normalization, the passage chunker moved out of TypeScript, the five-algorithm digest, and the
   fingerprint. OCR stays `crates/ocr-core` in its Container; LibreOffice stays the consented,
   contained C++ engine; Tantivy stays `crates/search-core`. Extraction gets its **own** Container and
   Worker rather than sharing the search Container, whose whole premise is staying warm.

7. **The opaque-archive rule is narrowed to the File Manager.** Discovery loads expand archives, pure
   Rust, under nesting-depth, expanded-bytes, expansion-ratio, entry-count, and path-traversal guards
   all checked before the first retained byte, with every entry re-entering the ingest gate and the
   original kept as the as-received evidence copy.

8. **The index scope key widens from matter to corpus now** — a `corpus_kind` + `corpus_id` pair in
   the type system, with the derived split key becoming `search/<corpusId>/splits/`. **The kind is
   not a path segment.** The design proposed `search/<corpusKind>/<corpusId>/splits/`, and the build
   ruled the kind segment redundant: a corpus identifier is a self-describing prefixed handle
   (`matter_…`, and a review set's own prefix later) drawn from disjoint namespaces, so two kinds can
   never collide on an id, and adding the segment would buy nothing while changing the key of every
   split ever published. The kind survives where it does real work — the discriminated union that
   makes a second kind an additive member the compiler finds every behavioural consumer of. Because
   the key is derived rather than stored, its exact bytes are a compatibility contract with the
   objects in the bucket, pinned by a byte-identical fixture in `packages/search/test/split.test.ts`.
   A matter document loaded into a review set is indexed in both corpora on purpose.

9. **The extraction port becomes composite**, native-first, recognition only for raster pages with no
   text layer — which closes the born-digital-PDF gap the shipped port documents, platform-wide rather
   than for discovery alone.

10. **Semantic indexing is off by default**, per review set. The earlier spec's Vectorize ceiling is
    corrected to 20,000,000 vectors per index; the partitioned-never-flat conclusion survives, the
    arithmetic does not.

11. **Scale is a refusal, not a degradation.** A per-review-set document ceiling derived from measured
    database size, refused above by name; a dedicated queue lane; fan-out from a checkpointing
    coordinator Durable Object, never from a request; bulk content to R2 always; no
    entity-attribute-value metadata table; and a new load profile at 25,000 and ceiling volumes whose
    measured per-firm database size is what the ceiling is derived from.

**Considered and rejected:** _reusing the bare word "custodian" in discovery_ (one word meaning two
things in one matter); _firm-scoped record custodians_ (asserting cross-matter identity of a person
named in a production is a defensibility problem); _deleting duplicates_ (destroys the attribution a
litigator is asked for under oath); _indexing a review set into its matter's corpus_ (a received
production would pollute the firm's own file search, and wholesale deletion of a clawed-back
production would become a per-document argument rather than a fact); _sharing splits between corpora_
(same); _deferring the corpus scope key_ (a split's R2 key is derived from it; free today, a rewrite of
every object later); _deferring the near-duplicate fingerprint and the page count_ (both free inside
the extraction pass, both a second full processing run to retrofit); _an entity-attribute-value table
for production metadata_ (millions of rows to buy filtering the index does better); _semantic
indexing on by default_ (embedding a large corpus is a real metered cost incurred whether or not
anyone queries semantically); _folding extraction into the search Container_ (a bulk load would make
review search slow, which is the one combination a user will actually hit); _a parallel discovery R2
prefix outside the file table_ (duplicates the scan gate, the hold mechanism, the destruction policy,
and the tiering path, and gives discovery its own answer to "is this under hold"); _degrading past the
document ceiling instead of refusing_ (a firm discovering at 400,000 documents that its database is
full has no good exit); _any new C/C++ dependency_ (discovery ingests hostile files at scale, which is
the worst case golden rule 14 exists for, not an edge case).

**Consequences:** the dormant search pipeline gains its first real consumer and its `deferred` state
becomes a drainable backlog rather than a permanent park; born-digital PDFs become searchable
platform-wide; the File Manager's opaque-archive guarantee now holds in one place and not the other,
which must be stated in both areas' local rules; the firm database acquires a table whose size is set
by an outside party, with a refusal as the only guard; and every deferred discovery feature — review,
tagging, threading, privilege log, production — now has the object it is a function over, plus the
page counts and fingerprints it would otherwise have had to re-derive from the whole corpus.
