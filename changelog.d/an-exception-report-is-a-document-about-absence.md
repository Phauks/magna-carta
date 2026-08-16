---
category: Added
audience: internal
---

**A discovery load now produces the two records a firm hands to another party: a manifest of what
arrived, and an exception report naming every document that could not be read and why. Duplicate
copies are suppressed from extraction without being suppressed from the corpus, and an archive
becomes a family instead of a file that mysteriously held no words.**

This is the remainder of the processing sub-slice: deduplication with occurrence rows, container
families over the guarded archive expansion the engine already had, and the load manifest and
exception report written at load completion.

**The exception report is the piece worth having.** A production is a claim — _we produced everything
we could read_ — and without a document the claim is an assertion. The report names every item the
claim excludes and gives the reason for each, from a closed vocabulary in which every code is a
different sentence: `encrypted` and `password-protected` stay apart because a password can be asked
for and a key cannot, and `no-text-extracted` exists precisely so a document that yields nothing is
listed rather than indexed as empty. It is written per load, in a machine-readable and a printable
form, only once the load reconciles — a report that does not add up is not one — and it is
**reproducible**: the generation reads the instant the corpus stopped moving off the load row rather
than taking a clock, every walk is ordered by identifier, and nothing is derived from the
environment, so the same load reported twice is byte-identical.

**Deduplication keeps the duplicate.** The identity is the content hash the ingest gate already
recorded, or the email record model's own dedup key for a message — never the near-duplicate
fingerprint on the same row, which collides by design and would be suppressing a document from review
on a heuristic. The copy is marked non-primary, keeps its own Custodian of Record and its own load,
reaches its own terminal state (mirroring the primary's, including inheriting its named reasons when
the primary is one nothing could read), and is named by an occurrence row. "Which custodians held
this document" is one indexed read. Primacy is taken by a single guarded statement and held by a
partial unique index, so a group can never have two primaries and the copies can never be extracted
twice or attributed to neither.

**A container family is a chain-of-custody claim.** An archive that reaches the extractor is expanded
by the engine under its five existing guards, and every entry re-enters the ordinary ingest gate —
presigned session, magic-byte sniff, hash, malware scan — by the same path an email attachment takes.
The entries become `container-child` documents of the archive, sorted by path so a re-processing
numbers them the same way; the archive becomes the family head, processed with no text object of its
own and an entry listing in its sidecar. Entries the engine described rather than opened become a
named exception on the archive carrying a **count and a kind, never a path**. One level of expansion
per document, absolutely: a child that is itself a container is one the engine already declined to
open, and it says so.

**Found and fixed along the way.** A document waiting on the scan gate parked and was acked, which
meant nothing would ever look again — it now re-reads the row and throws so the queue redelivers,
which is what a container's children need since their bytes cross the gate after their message
exists. A `quarantined` verdict is deliberately never re-read, because the two failure directions are
not symmetrical.

Also: the extraction facts gain the digest set the engine already computed in the same pass, so the
manifest's MD5 and SHA-1 — which load-file specifications still ask for and which nothing else in the
platform would ever compute — reach the row; a legacy binary keeps the digests of the bytes that
arrived rather than of the conversion made to read them; the exception row gains its load, so the
report walks its own index instead of joining the corpus; and the record artifacts carry a
`review-load-record` object class, stamped apart from the derived text and sidecars so a collection
rule cannot delete the evidence and keep the cache.

Not built: the review-document index enqueue, opt-in semantic indexing, the review-document list read
and the shared discovery load-profile volume, which are the next sub-slice. No review surface.
