# Search split compaction — Implementation Plan

**Design:** [`2026-07-17-discovery-search-index-stateful-service-design.md`](2026-07-17-discovery-search-index-stateful-service-design.md)
— compaction's mechanism is specified there (_The Tantivy index as immutable splits in R2_, _The index
catalog_, _Deletion, rebuild, re-index_). This plan does not redesign it. It closes the one question that
design left open by name — the compaction trigger — and the one it left implicit: what a merged split
does when a document version inside it is later superseded.

**Evidence:** the standing read-path benchmark (`crates/search-eval`) measured one query over 5,000
documents at **186,293 ranged reads** published as one split per document version, against **45** for the
same documents compacted. A ranged read is an R2 range GET in a deployment. That moves compaction from a
later optimization to a precondition for the search Container being usable.

**Goal:** a corpus's live split count stops tracking the number of documents ever ingested and starts
tracking a threshold the platform chooses, without any query ever being pointed at a key that no longer
exists and without a superseded document version ever matching.

**Architecture:** no new package and no new Worker. `crates/search-core` gains the merge; the per-firm
catalog gains a membership table and a supersession lifecycle it already has the column for;
`apps/worker` gains one queue, one coordinator Durable Object, and two sweeps. Everything heavy is in the
queue consumer, never in a request handler.

---

## Global constraints

- **Golden rule 12 — no shorthand.** `excludeDocumentIds`, not `excludeIds`; `splitIdentifierForCompaction`,
  not `compactionSplitId`; "the data-access layer", never an abbreviation.
- **Golden rule 13 — no process references in source.** No ADR numbers, no spec citations, no slice
  numbers in code, tests, config, or OpenAPI descriptions.
- **Golden rule 3 — every read and write through the firm-scoped data-access layer.** The compaction pass
  never reaches a bucket or a database except through the firm handle it was given, and split bytes are
  R2, never the per-firm database.
- **Golden rule 10 — nothing heavy on a hot path.** The write path may only _count_; it may never merge.
- **Every object written into a firm's bucket carries its dimensions** (`@magna-carta/object-dimensions`).
  A merged split belongs to exactly one matter, so it is `matterScopedObjectDimensions`.
- **Any new metric goes in the telemetry catalog.** A metric missing from the catalog is silently
  dropped.
- **The per-firm migration journal is contiguous from zero.** Take the next free index; retag rather than
  leave a hole.

---

## Slice ordering

| Slice | Ships                                                                                                                                  | Useful alone because                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | The engine: merge splits through ranged readers with a delete set; hold a split open across queries; query many splits ranged          | The merge is the thing compaction is made of, and the two absences the benchmark named block measuring the target at all. All three are pure Rust, testable with no Cloudflare |
| **2** | The catalog: the membership table, the supersession and collection statements, the compaction-candidate reads                          | The catalog can answer "which corpora need compacting" and "which document versions in this split are stale" before anything acts on the answers                               |
| **3** | The pass: the port operation, the queue, the per-corpus coordinator, the consumer                                                      | Compaction runs end to end, triggered by hand or by the sweep                                                                                                                  |
| **4** | The triggers and the collection sweep: the threshold count on the write path, the daily backstop, the retirement of superseded objects | The system maintains itself and reclaims the bytes it supersedes                                                                                                               |
| **5** | The query path: per-split exclusions from catalog to engine                                                                            | A re-indexed document stops matching its own stale passages between compactions                                                                                                |

Slices 1 and 2 are independent and may run in parallel. Slice 5 must land no later than slice 3 goes
live in a deployment: a merged split with no exclusion path is correct only until the first re-index.

---

## Slice 1 — the engine (`crates/search-core`)

- [x] **`merge_splits_over_readers(readers, exclude_document_ids) -> MergedSplit`.** A segment-level
      merge, not a re-index: the schema indexes `body` without storing it, so the documents cannot be
      read back out of a split and re-added, and merging the source segments directly is both the only
      option and the cheaper one. `merge_splits` is the in-memory twin for tests.
- [x] **Exclusions are applied inside the merge.** Delete by the untokenized `document_id` term, commit,
      then repack the segment so the superseded postings leave the published bytes rather than being
      masked. An exclusion naming a document that is not in the merge set is reported, not refused — a
      compaction and a re-index can legitimately race.
- [x] **Bundle only the files the merged index declares live.** Applying deletions leaves the
      pre-deletion segment in the scratch directory; asking Tantivy which files are live is the one
      answer that cannot drift.
- [x] **`SplitSearcher`** — a split opened once and held open, so a resident process pays the footer read,
      the index open, and the per-field setup once for the life of the split rather than per query. The
      one-shot free functions become thin wrappers over it.
- [x] **`query_splits_over_readers`** — the ranged multi-split query, so the fan-out shape production
      actually has exists in the engine rather than being assembled by a harness.
- [x] **A searcher carries its split's exclusions** (`excluding_documents`), applied as `MustNot` term
      clauses. Per split, never per query: the same document is legitimately live at a newer version in
      a different split.
- [x] **`crates/search-eval` measures the result.** Every fan-out point is merged through the engine and
      re-queried, so the saving is a subtraction inside one run over identical documents; warm and cold
      are reported separately. The two caveats the benchmark raised against the engine come out of the
      unmeasured list, and the one it can now state honestly — the Container's disk cache — goes in.

## Slice 2 — the catalog (`packages/database`, `packages/data-access`)

- [ ] **`index_split_member`** (per-firm): `split_id`, `document_id`, `version`, `superseded_at`. One row
      per document version inside a **merged** split. A per-document split needs none — its own
      `document_id`/`version` columns are its membership. Indexed on `split_id` and on `document_id`.
- [ ] **One per-firm migration** at the next free journal index, hand-registered in
      `apps/worker/src/per-firm-migrations.ts`, snapshot regenerated and **formatted**.
- [ ] **`countLiveSplitsForMatter`** — the indexed count the write path makes to notice the threshold.
- [ ] **`listCompactionInputSplits`** — live splits for a matter, oldest first, bounded by count and by
      cumulative bytes. The bound is what keeps one pass inside a Container.
- [ ] **`listStaleMembersForLiveSplits`** — the per-split exclusion lists, one read for a whole corpus.
- [ ] **`publishCompactedSplitStatements`** — the atomic batch: insert the merged row, insert its
      membership, mark every source superseded. Returned as one ordered array, never split across
      batches.
- [ ] **`markMembersStaleForDocumentStatement`** — called in the same batch that publishes a document's
      replacement split, so a re-index marks and publishes together or does neither.
- [ ] **`listSupersededSplitsReadyForCollection`** — superseded longer than the grace period, the input
      to the retirement sweep.
- [ ] **`deleteIndexSplitStatement`** already exists; add the member cascade beside it.

## Slice 3 — the pass (`packages/search`, `apps/worker/src/search`)

- [ ] **`splitIdentifierForCompaction(corpus, sourceSplitIds)`** — derived from the corpus and the sorted
      source ids, so a retried pass recomputes the same key and overwrites its own object instead of
      orphaning one. Same discipline as the per-document derivation, same reason.
- [ ] **`SearchIndexPort.compact`** — sources in, one published split out. Typed outcome, never a throw.
      The deferred port reports `engine-not-implemented`, as every other operation does.
- [ ] **`SearchIndexCompactionJob`** — a per-corpus coordinator keyed `firmId:corpusId`, single-flighting
      so a burst of a thousand ingests produces one compaction in flight rather than a thousand.
- [ ] **The `SEARCH_COMPACTION` queue and its consumer.** The order is object, then catalog, then
      nothing: write the merged split to R2 with its object dimensions; commit one batch inserting the
      row and the membership and superseding the sources; leave the source objects for the sweep. **Do
      not delete a source object in this pass** — that is the one ordering that can hand a live query a
      key to an object that no longer exists.
- [ ] **Re-enqueue while still over threshold**, so a corpus of thousands of splits converges over
      several bounded passes.

## Slice 4 — triggers and retirement

- [ ] **The write-path threshold.** The index consumer counts the corpus's live splits after publishing
      and asks the coordinator to start a compaction when the count crosses it. One indexed count, no
      merge, no scan.
- [ ] **The daily backstop** on the existing reconciliation cron: walk reachable firms, find corpora over
      threshold, enqueue. Catches corpora that crossed through deletion and corpora that stopped being
      written to.
- [ ] **The retirement sweep.** Splits superseded longer than the grace period: delete the R2 objects,
      then delete the rows. Objects before rows — a crash between them leaves a row pointing at nothing,
      which the next compaction replaces, where the other order leaks bytes nothing references.
- [ ] **The thresholds are per-firm settings** with the recommended values as defaults, beside
      `search.indexing_enabled`. Compaction trades a query's Class B reads against the merge's Class A
      writes, and only a deployment can price that.
- [ ] **Telemetry**, registered in the catalog: splits merged, splits superseded, bytes reclaimed,
      passes deferred, passes failed.

## Slice 5 — the query path

- [ ] **`SearchQueryInput.splits`** becomes `{ objectKey, excludeDocumentIds }[]`, replacing the bare key
      list. The engine applies each split's exclusions as it queries it.
- [ ] **`runKeywordSearch`** assembles them: the live splits it already reads, joined to the stale
      members read in one further indexed query.
- [ ] **A test that pins the window**: publish a document, compact it into a merged split, re-index the
      document, and assert the query returns the new passages and not the old ones — before any further
      compaction runs.

---

## What this plan does not build

- **Footer pruning.** The per-field digest that lets a query skip a split whose terms exclude it is still
  unimplemented. It reduces the cost of the splits that remain; compaction reduces how many remain. They
  compose, and neither substitutes for the other.
- **Global term statistics across splits.** BM25 weights a term by rarity within a split, so ranking
  across many splits is an approximation. Compaction improves it as a side effect by leaving fewer
  splits; it does not fix it.
- **A compaction UI or route.** Backend only, by owner direction.
