---
number: 385
slug: a-corpus-is-the-index-scope-and-the-catalog-says-so
status: Proposed
date: 2026-08-19
area: Discovery
summary: "The ratified widening of the search-index scope key from a matter to a CORPUS was built everywhere except the half that decides disclosure: `packages/search` took a corpus, the split's R2 key derived from one, and `SearchIndexPort`'s three operations all named one — but the split CATALOG was still keyed by matter, and the catalog is what a query enumerates its splits from. A review set indexed under its own matter would therefore have surfaced material an opposing party produced in an ordinary matter search. `index_split` gains `corpus_kind` and `corpus_id`, every scope read moves onto them, and `matter_id` is retained as provenance nothing enumerates by. On that foundation a review document reaches the index through the same coordinator and the same consumer as a committed file version, indexing the text the discovery pipeline ALREADY extracted rather than re-parsing an opposing party's bytes — with a form-feed page separator so the certified text can be read back as the passages it was, and a refusal rather than a positional guess when the text and its page metadata disagree. And a document the index has not taken is recorded on its own row rather than as a `review_document_exception`, deviating from the plan, because the exception vocabulary is a CHECK-enforced closed list of sentences about what could not be READ and every one of them is rendered into a report a firm hands to another party."
---

**A scope key that is right in the type system and wrong in the catalog is a scope key that is
wrong, and the catalog is the half that decides who sees what.**

**Context.** The owner ratified widening the index scope key from a matter to a corpus while the
engine was dormant and no split had ever been published, precisely so a review set could later take
an index scope of its own without a data migration. The corpus type shipped, `split.ts` derived the
R2 key from it, and the port's three operations took it. The catalog did not: `index_split` carried
`matter_id` and every enumeration matched on it, with a comment in the consumer saying the catalog
"widens with the corpus kind that first needs it".

That kind is now here, and the consequence of leaving the catalog behind is not a tidiness problem.
A query resolves its split keys from the catalog and from nothing else. A review set's splits live
under the review set's own R2 prefix — the object side of the widening was done — but a
matter-keyed catalog would have handed a matter's ordinary keyword search the keys to them. Material
an opposing party produced is routinely under a protective order the matter team is not uniformly
cleared for, and the review-set access list exists because holding every discovery permission is not
the same as being cleared for it.

**Decision.**

**The catalog's scope key is the corpus, and only the corpus.** `index_split` gains
`corpus_kind` (defaulted `matter`) and `corpus_id`, backfilled from `matter_id`, with the live-splits
index moved onto `(corpus_id, superseded_at, created_at)`. `listLiveSplitsForCorpus`,
`countLiveSplitsForCorpus`, `listCorporaWithLiveSplits`, `listCompactionInputSplits`,
`listStaleMembersForCorpus` and `countStaleMembersForCorpus` all match on the corpus. The kind is
stored and never matched on, for the same reason the R2 key needs only the id: an identifier is a
self-describing handle, so two kinds cannot collide on one, and a scope read that had to match a pair
is a scope read somebody can get half right.

`matter_id` stays, populated with the matter the corpus belongs to. It is provenance — which file the
index work was done under, and the dimension the split object is stamped with — and dropping it would
be a rebuild of a table firms have already provisioned to reclaim one column on the catalog of a
derived cache.

**A review document is indexed from the text the corpus already certified, never from its bytes
again.** `enqueueReviewDocumentForIndexing` sits beside the version-keyed enqueue and runs through
the same coordinator and the same consumer; the split id is derived from the review document alone,
because a review document is already a version pin and hashing a version beside it would be hashing a
constant. What the consumer does differently is read the extracted-text object and its metadata
sidecar instead of the original bytes. Re-extracting would be a second parse of an opposing party's
document, producing a second answer to what it says from whatever engines happened to be deployed
that day, with nothing comparing it to the answer in the manifest the firm stands behind.

Reading it back needs page boundaries, so the text object's pages are separated by a **form feed** —
what a page break in a plain text file has been since line printers, honoured by every text viewer,
and impossible inside a passage because normalization drops every control character before anything
derived is derived. A blank line could not make that promise: legal prose is full of them. Where the
block count and the sidecar's page list disagree the job REFUSES and records why, rather than pairing
them positionally: a hit that names the wrong page of a production is worse than no hit, because
somebody cites it.

Only the primary of a duplicate group is enqueued. That is the whole economic argument for
deduplicating — one set of bytes, one extraction, one index entry — and the duplicates keep their
rows, their Custodians of Record and their occurrences, so nothing is hidden.

**A review set never feeds the natural-language corpus.** That surface's audience is the matter team
and its scope is the matter; a review set's access list is narrower. The feed write is skipped for a
review-set corpus explicitly rather than by the feed's own allow-list happening to exclude it.

**Deviation from the plan, taken deliberately: an unindexed document is a row state, not an
exception.** The implementation plan asked that a `failed` or `deferred` index outcome write a
`review_document_exception`, so an unindexed document is visible in the exception report rather than
only inside a Durable Object. The property is right and it is built; the mechanism is not, for two
reasons that compound.

The vocabulary is closed and enforced by a CHECK constraint, so adding a code is a rebuild of a
shipped table — which the expand-contract discipline forbids without a reviewed exception. And no
existing code is true of "the index engine is not deployed": all fifteen are sentences about what
could not be READ, and every one of them is rendered into the exception report a firm hands to
opposing counsel. A `not-indexed` line reading "25,000" in that report would assert something false
about the production and would silently change the next time somebody deploys a container.

So `review_document.index_state` (`indexed` / `deferred` / `failed`) and `index_deferred_reason` sit
beside `processing_deferred_reason`, which already draws exactly this distinction one stage earlier:
"we have not got to it" is not a verdict about the document. The backlog is one indexed read over the
review set and a route reports it. The one index-stage failure that IS about the document — its
derived text no longer in the bucket — files `source-bytes-missing`, which the vocabulary already
carries and which is exactly true.

**Considered and rejected.** **Adding a `not-indexed` exception code**, which is the plan as written:
it needs a reviewed rebuild of a shipped table and it puts a number in a court-facing record that is
not about the production. **Excluding the `index` stage from the rendered report and keeping the
code**: defensible, and it still requires the rebuild, and it leaves a code in the closed vocabulary
whose only property is that the report must remember to drop it. **Deriving the backlog by
anti-joining the corpus against the split catalog**: no new column, and a quarter-million-row anti-join
for a progress figure. **Re-extracting at index time instead of reading the certified text**: it would
have made the index a second, unreconciled opinion about what an opposing party's documents say, and
doubled the most expensive stage of the pipeline.

**Consequences.** The corpus separation is now structural rather than conventional, and is proved by
a suite that deliberately places both corpora on the SAME matter — a test using two matters would
pass against a matter-keyed read. Whether an unindexed document should ALSO be an exception is
recorded as an owner question on the ledger rather than answered here. The text object's bytes
changed shape (a form feed where two newlines were), which is safe because it is a derived cache no
firm holds yet, and is now a compatibility contract like every other derived artifact in the
subsystem.
