---
category: Added
audience: internal
---

**A discovery review set is now its own search corpus, and a matter query is structurally unable to
name its splits.** The index scope key had been widened from a matter to a corpus everywhere except
the half that decides disclosure: the split CATALOG was still keyed by matter, so a review set indexed
under its own matter would have put material an opposing party produced into the result set of an
ordinary matter search. Under a protective order that is not a cache miss. `index_split` gains
`corpus_kind` and `corpus_id`, every scope read moves onto them, and `matter_id` stays as provenance
that nothing enumerates by — which is what the split's R2 prefix, the compaction backstop's candidate
set, and the query path's own key resolution all now agree on.

**A review document reaches the index through the same coordinator and the same consumer as a
committed file version. What differs is only where the passages come from.** Its text was already
extracted, certified in a manifest and written to R2, so indexing reads that object rather than
handing an opposing party's bytes to a second parser — a second parse is a second answer to what the
document says, produced by whatever engines happen to be deployed that day, with nothing comparing it
to the one the firm stands behind. The text object gains a form-feed page separator so the pages come
back as the passages they were; a form feed cannot occur inside one, because normalization drops every
control character before anything is derived. Where the text and its page metadata disagree the index
job REFUSES rather than pairing them positionally, because a search hit that names the wrong page of a
production is worse than no hit: somebody cites it. Only the primary of a duplicate group is indexed,
which is the entire economic argument for deduplicating at all.

**A document the index has not taken is recorded on its own row, and deliberately not as an
exception.** The exception vocabulary is a closed list held by a database constraint, every code in it
is a sentence about what could not be READ, and every one is rendered into a report a firm hands to
another party — so "our own search index has not caught up" is not one of them, and a later deploy
would silently change the number. `review_document.index_state` gives the property that was actually
wanted: the backlog is countable and pageable from the corpus rather than only from a Durable Object
somebody has to know to open. The one index-stage failure that IS about the document — its derived
text gone from the bucket — files `source-bytes-missing`, which the vocabulary already has.

**The reads the review surface will sit on exist and are measured.** The review-document list page
filtered by Custodian of Record, load, family, processing state and exception code; the live exception
surface with its counts by reason; the occurrences a suppressed copy stays reachable through; and what
the corpus still owes the index. The list is keyset-paged over `(sort_date, id)` in two segments
rather than one predicate — a production routinely arrives with documents nothing can date, a
descending sort puts those after every dated one, and a single keyset clause over a nullable column
either drops the whole undated tail or becomes an OR the planner cannot turn into a range.

**Found and closed while building on it: none of the discovery surface was access-scoped except
coding.** The review-set list was not, and a name is enough — "Plaintiff's production, Ridgeway
settlement" on a matter tells a reader that a production was received. Neither were the review set,
its loads, its Custodians of Record, or any of the write routes: a member holding every discovery
permission and on no access list could rename or CLOSE a walled review set, which releases its derived
artifacts irreversibly. All of them now go through the access list and answer ABSENT rather than
refused, and the visibility fitness sweep grew a second registry so the new reads are held to the same
wall from the same table-driven pass.

**The load profile found a real defect on its first run, which is what it is for.** The list page —
the read every reviewer makes hundreds of times a day — cost 10.3 ms per page mid-corpus at the
250,000-document ceiling, because SQLite turns `a < ? OR (a = ? AND b < ?)` into a scan from the end
of the index down to the cursor rather than a seek. The same predicate written as a row value is
0.26 ms and flat with corpus size: a 39-fold difference on the hottest read in the subsystem, and
invisible at any volume small enough to demo. Two further reads sorted through a temporary b-tree
because their indexes stopped one column short of the order they are served in.

**Two numbers that were asserted are now derived.** The per-review-set ceiling rests on 633 MiB
measured at 250,000 documents against 66 MiB at 25,000 — at the exact size rather than extrapolated
from a tenth of it — which leaves room for roughly a dozen ceiling-sized review sets inside a firm's
database. The allocation batch size stays at 100 because one batch costs 0.62 ms and the parameter and
query walls are what cap it, not its cost.

**Semantic indexing is deliberately not built.** The owner flag is open on evidence rather than
neglect: the cost is now priced at roughly 490 times the keyword half's for a ceiling-sized review
set, and the recall gain that would justify it has never been measured on legal prose with relevance
judgements. The per-review-set flag stays a column nothing reads, because turning it on would embed a
corpus on a guess and the embedding model pin is unchangeable once one vector exists.
