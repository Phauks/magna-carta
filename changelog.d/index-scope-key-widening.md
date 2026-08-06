---
category: Changed
---

Search — the index scope key widened from a matter to a **corpus**, while it is still free to do so.
A search index is partitioned by something, one split belongs to that something, and a split's R2
object key is **derived** from it rather than stored — so the scope key is the one part of the index
that cannot be renamed later without rewriting every object in every firm's bucket and migrating the
catalog that names them. The engine is dormant, no split has ever been published, and today the
partition happens to be a matter; the moment a firm has a live index, changing what it is becomes a
migration. So it changed now, at the cost of a type and a derivation.

A **corpus** is a discriminated union with exactly one member today — a matter — and the mapping is the
identity: a matter's corpus is that matter. `SearchIndexPort`'s `index`, `remove`, and `query` take a
corpus instead of a matter identifier, the split key derivation takes a corpus, and the write pipeline
resolves the corpus once and threads it. Nothing gained a review-set concept, a table, or a column.

**Every key that exists today is byte-identical, and that is the deliverable.** The derived key stays
`search/<corpusId>/splits/<splitId>.split`, because a corpus identifier is a self-describing handle
(`matter_…`) and adding a separate kind segment would have bought nothing while changing every key
that has ever been published — the exact outcome this change exists to prevent. The literal keys and
prefix are now pinned in a fixture, so the compatibility contract with the objects in a firm's bucket
is a test rather than an intention.

Two things stayed matter-shaped on purpose, both cheap to widen whenever a second corpus kind arrives
and neither of them derived from: the `index_split` catalog column, whose widening is a per-firm
schema migration this change is defined not to need, and the queue message, so a message enqueued
before a deploy is still readable after one. Where the catalog and a corpus meet, the compiler is the
guard — the enumeration a query runs stops type-checking the moment a corpus can be something other
than a matter, which names the one place that has to widen with it.
