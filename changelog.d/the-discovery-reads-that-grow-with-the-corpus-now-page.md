---
category: Fixed
audience: internal
---

**Five discovery reads that grow with the corpus answered with a page and no way to reach the rest.**
Each carried a LIMIT and no cursor, so a review set larger than a page returned a prefix that read
exactly like a complete answer.

The coding history is the one that mattered most. It is the record a challenge to a production is
answered from — who coded what, when, under what criteria, and who reversed it — and its whole value
is that it is complete. Truncated to the most recent fifty acts, it omitted precisely the history a
meet-and-confer is about. It now pages, newest first.

The matter's review sets, a review set's loads, its Custodians of Record, and a document's other
copies page too. Two of them needed their sort key made total first: `display_name` alone does not
order two custodians who share a name, and the occurrence list ordered on the duplicate's identifier
with nothing behind it. Both now carry the row's own identifier as the tiebreak, so the keyset cannot
skip or repeat at a page boundary. The custodian list stays alphabetical and ascending, because that
is how a person looks a name up; the copies list is the read behind "which custodians held this
document", and a boilerplate announcement held by every custodian in the matter is exactly the
document that question gets asked about.

Every one of these composes the review-set access predicate into its SQL. The keyset clause is placed
between that predicate and the ORDER BY, so the predicate still precedes the LIMIT and the visibility
fitness pass holds unchanged.

**Two are recorded as bounded by construction, each with the index that bounds it.** A review set's
access list holds one row per member (`review_set_access_member_unique_index`), and a document's live
coding holds one row per tag (`review_document_tag_live_unique_index`), so the bounds are the firm's
headcount and its own tag catalog rather than the corpus.

**`keysetClause` joins the cursor helpers.** The existing helpers push onto a conditions array, which
does not fit a statement assembled by string concatenation around an access predicate whose position
in the WHERE clause is load-bearing. Five reads needed the same clause; it now has one home.
