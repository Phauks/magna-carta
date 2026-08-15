---
category: Added
audience: internal
---

**Search split compaction — a corpus's live split count now tracks a threshold the platform chooses,
not the number of documents ever indexed into it.** The write pipeline publishes one split per document
version, and the standing read-path benchmark priced that shape: one query over 5,000 documents issued
**186,293 ranged reads** published as one split each, against **45** for the same documents compacted.
A ranged read is an R2 range GET in a deployment, so no engine speed reaches a sub-second query from
there. Compaction stops being a later optimization and becomes the thing that makes the read path
viable.

**The engine** (`crates/search-core`) gains `merge_splits_over_readers` — a segment-level merge, not a
re-index, because the schema indexes `body` without storing it and the documents cannot be read back out
of a split. Deletions are applied inside the merge: the superseded document ids are deleted by term and
the segment is repacked, so their postings leave the published bytes rather than being masked. It also
gains the two things the benchmark named as absences. `SplitSearcher` holds a split open across queries,
so a resident process pays the footer read, the index open, and the per-field setup once for the life of
the split — 2 warm reads against 40 cold, at the smoke tier — which is the state the sub-second target
is actually stated against and could not previously be measured at all. `query_splits_over_readers` is
the ranged multi-split query, so the fan-out shape production has now exists in the engine instead of
being assembled by the harness.

**The pass** is triggered by a live-split threshold the write path notices in one indexed count after
publishing, single-flighted per corpus by a `SearchCompactionJob` Durable Object, and run off a
dedicated queue. It is bounded by split count and by bytes and re-enqueues itself while the corpus is
still over threshold, so a matter holding thousands of splits converges over several bounded merges
rather than attempting one no Container could finish. The daily reconciliation cron is the backstop for
corpora that crossed the threshold through deletion or stopped being written to.

**The correctness is the publication order**, and it runs one way: the merged split is written to R2
first; one atomic batch then inserts its row, inserts its membership, and marks every source superseded;
and the source objects are left in place, retired by a later sweep after a grace period. A query that
resolved its split keys before the swap holds source keys whose objects still exist; one that resolved
after holds the merged key and none of the sources. No interleaving yields both, and none yields neither.
Deleting a source inside the pass that superseded it is the one ordering that could hand a live query a
key to bytes that are gone, which is why retirement is a separate sweep.

**Deletion and re-indexing** are handled by a new per-firm `index_split_member` table plus a per-split
exclusion on the query path. A merged split covers document versions and claims none on its own row, so
the membership is what says which versions are inside it. Re-indexing a document marks its membership
stale in the same atomic batch that publishes the replacement, and the query path carries those ids to
the engine per split — per split, because the same document is legitimately live at a newer version in a
different one. Marking is what makes a superseded version stop matching immediately; the next compaction
passes the same ids to the merge, which is what makes it stop costing anything.

Every threshold is a per-firm setting rather than a constant: compaction trades a query's Class B reads
against the merge's own reads and its write, and only a deployment can price that.

The benchmark reports it: a third axis merges every fan-out point through the engine and re-queries it,
so the saving is a subtraction inside one run over identical documents rather than a comparison across
two differently-built corpora.
