---
number: 309
slug: compaction-is-a-catalog-swap-on-a-threshold-never-a-write-hook
status: Proposed
date: 2026-08-13
area: Search
summary: "Index compaction is triggered by a live-split threshold, not by every write and not by a bare schedule: the write pipeline counts a corpus's live splits in the read it already makes and enqueues a bounded merge when the count crosses the threshold, and the daily sweep is the backstop for corpora that cross it through deletion or stop being written to. A pass merges at most a bounded number of splits and bytes at a time and re-enqueues itself while the corpus is still over threshold, so a matter with thousands of splits converges over several passes instead of attempting one merge no Container can finish. Publication is ordered object-then-catalog-then-retirement: the merged split is written to R2 first, one atomic batch then inserts its row and its membership and marks every source split superseded, and the superseded objects are deleted by a later sweep after a grace period — so a query holding split keys resolved a moment before the swap still finds every object it named, and a query resolving a moment after sees the merged split and none of its sources. Because a merged split covers document versions that a later re-index can supersede, the catalog records per-split membership and the query path carries a per-split exclusion list; the exclusion is what makes a superseded version stop matching immediately, and the next compaction is what physically removes it from the bytes. The trigger constants are per-firm settings rather than code, because the right threshold is a cost trade between R2 Class B reads and Class A writes that only a deployment can price."
---

**Compaction is not a step in the write path. It is a threshold the write path notices and a merge
somebody else performs, and its correctness lives entirely in the order the catalog is swapped.**

**Context:** The write pipeline publishes one split per document version, and it publishes it at a key
derived from `(document, version)`. That derivation is load-bearing — it is what makes a retried index
job overwrite its own object instead of leaving a second copy behind — so the shape is not a mistake to
be corrected upstream. It is simply a shape the read path cannot afford: a query is handed every live
split key the catalog holds, and the standing read-path benchmark measured what that costs at the scope
the design is built for. One query over 5,000 documents published as 5,000 splits issued **186,293
ranged reads**; the same documents in one compacted split issued **45**. Each of those reads is an R2
range GET in a deployment. No amount of engine speed reaches a sub-second query from there.

The storage design already specified compaction's mechanism — merge, publish, swap the catalog, delete
the sources — and left one question open by name: what triggers it, split count versus age versus size.
It also left the harder question implicit, which is what a merged split does when one of the document
versions inside it is later superseded.

**Decision:**

**The trigger is a live-split threshold, noticed in a read the write path already makes.** After the
index consumer publishes a document's split it counts the corpus's live splits — one indexed count
against a table it is already writing — and enqueues a compaction when the count crosses the threshold.
A per-corpus coordinator single-flights that message, so a burst of a thousand ingests produces one
compaction in flight rather than a thousand. The daily reconciliation sweep is the **backstop**, not the
primary trigger: it catches a corpus that crossed the threshold through deletions rather than writes,
and one that stopped being written to before it was compacted.

**Considered and rejected: compacting on every write.** A merge is proportional to the corpus, so a
merge per ingest is quadratic in the corpus; a matter's whole index would be rewritten once per
document. **A bare schedule with no threshold** spends a full merge on corpora nothing changed in and
still leaves a heavily-ingested matter uncompacted until the next fire. **A threshold evaluated at query
time** puts the decision on the hot path golden rule 10 keeps clear, and makes the first member to search
a large matter pay for everyone.

**A pass is bounded, and re-enqueues itself.** One compaction merges at most a bounded count of splits
and a bounded total of bytes, oldest-first, and produces exactly one new split; if the corpus is still
over threshold when it commits, it enqueues the next pass. A matter holding thousands of splits
therefore converges over several bounded merges rather than attempting one merge that would exceed a
Container's memory and its wall clock. Bounding by bytes as well as by count matters because splits are
not the same size — a hundred pages and a single memo are both one split.

**The publication order is the concurrency guarantee, and it has three steps in one direction.** The
merged split is written to R2 first, at a key derived from the corpus and the sorted ids of its sources,
so a retried pass overwrites its own object rather than orphaning one. Then **one atomic batch** inserts
the merged split's catalog row, inserts its membership, and marks every source split superseded. Then
nothing: the superseded objects are left in place and collected by a later sweep once they have been
superseded for longer than any query can live.

That order is what makes a query mid-flight correct rather than partial. A query resolves its split keys
from the catalog and then reads those objects. If it resolved them before the batch, it holds the source
keys, and those objects still exist because retirement is deferred — it returns the pre-compaction
answer, which is the same answer. If it resolved them after, it holds the merged key and none of the
sources — the post-compaction answer, which is also the same answer. There is no interleaving that
yields both, because the catalog moves in one atomic step, and none that yields neither, because the
merged object is written before the row that names it. **Deleting the sources inside the same pass would
break exactly this** — it is the one ordering that can hand a live query a key to an object that no
longer exists — which is why retirement is a separate sweep with a grace period rather than a fourth
step.

**A merged split's coverage is recorded, and a superseded version is excluded before it is removed.**
Once documents are merged, the split no longer carries a document id of its own, so nothing in the
catalog would otherwise be able to say which document versions are inside it. A membership record per
`(split, document, version)` says exactly that. When a document is re-indexed or withdrawn, its member
rows on live merged splits are marked stale in the same batch that publishes the replacement, and the
query path carries those document ids to the engine as a **per-split exclusion**. The exclusion has to be
per split rather than per query: the same document is legitimately live at a newer version in a different
split, and excluding it globally would hide the current text along with the stale text. The next
compaction of that split passes the same ids to the merge, which deletes them and repacks, so the stale
postings leave the published bytes rather than being filtered forever. Marking is what makes a superseded
version stop matching **immediately**; compaction is what makes it stop costing anything.

**Considered and rejected: rewriting the merged split on every re-index.** It is the obvious way to keep
the split exactly true, and it makes a single-document edit cost a merge of the whole corpus — the
quadratic behaviour the threshold exists to avoid, arrived at from the other direction. **Filtering stale
hits in the app Worker after the engine ranks** would be cheaper to build and is wrong: the engine
truncates to the requested limit before the Worker sees anything, so a page of results that was mostly
stale would come back short, and a caller could not tell an under-filled page from a genuinely small
result set.

**The thresholds are firm settings, not constants in the source.** Compaction trades R2 Class B
operations (a query's range GETs, which the merge reduces) against Class A operations and egress (the
merge's own reads and its write, which the merge adds). Which way that trade falls depends on how often a
corpus is searched versus written, and neither this design nor the local benchmark can price it — only a
deployment can. Shipping the recommended values as defaults on a per-firm setting means the answer can be
changed for a firm that searches constantly, or one that ingests constantly, without a deploy.

**Consequences:** The read path's cost stops tracking the number of documents ever ingested and starts
tracking the number of splits the threshold allows to accumulate, which is a number the platform
chooses. The costs are real and named: a per-firm membership record proportional to the indexed corpus,
a second catalog read on the query path to assemble the exclusion lists, superseded bytes that live in
the firm's bucket for the length of the grace period, and a background merge whose R2 traffic is paid
whether or not anybody searches that matter afterwards.

The compaction pass is also the first thing in this subsystem that **deletes a firm's bytes on a
schedule**, and it does so on the strength of a catalog row. That is safe only because a split is a
derived cache of documents that durably live in R2 — a wrongly-collected split costs a re-index, never a
document. It would not be safe for anything that was the system of record, and nothing that is one should
be given to this sweep.
