---
category: Fixed
audience: internal
---

**Three defects in the trust reconciliation and statement-import reads: a fingerprint whose canonical
form reserved a character the file is free to contain, a capped read with no truncation probe, and
one word with two definitions.**

**The preview fingerprint is unambiguous rather than merely reproducible.** The canonical text a
statement-import fingerprint is taken over ran the parsed fields together with a control character
between them. A separator can only carry that weight if a field cannot contain it, and a bank writes
whatever it likes into a description, a reference, or a payee column — this parser passes every
character through. A file carrying the separator inside a field canonicalizes exactly as the same
characters arranged one field to the left do, so a shift across a field boundary reproduces the
fingerprint the preview already returned and the confirmation stores a file nobody reviewed. Every
field is now written as `<length>:<text>`, which leaves a reader one place to cut, and the two
invisible control characters leave the source with it. This changes the fingerprint value of every
file, which is harmless: a fingerprint is only ever compared against one a preview returned in the
same request cycle, no column anywhere stores one, and a preview taken before the change and
confirmed after it is refused with `statement-import-preview-mismatch` — the honest answer, and one
whose remedy is to preview again.

**The unmatched-statement-line read asks one row past its ceiling, like the read beside it.** The
outstanding-item read has always probed for truncation and refused
`reconciliation-outstanding-items-truncated` rather than proving a period from a list that stopped at
its cap; the line read did not. It was whole only because a statement is separately capped at
`MAX_TRUST_BANK_STATEMENT_LINES` (2,000), which happens to sit below `MAX_TRUST_RECONCILIATION_ROWS`
(5,000) — an arithmetic accident neither constant states and nothing would have caught if either
moved. `frozen_unmatched_line_count` is one of the figures a close freezes as the firm's attestation,
so the same invariant binds: the new `reconciliation-unmatched-lines-truncated` refuses with a
sentence a member can act on, and both truncation refusals now answer as the
`trust-reconciliation-truncated` problem type instead of falling through the catch-all that tells a
firm the trust rules refuse its reconciliation.

**One definition of "unmatched line".** The proof derived it from SQL; the matching surface
re-derived it by subtracting the reconciliation's active matches from the statement's lines in
memory. The two agreed — same active-match predicate, same reconciliation scope, same treatment of
withdrawn matches and of matches on a superseded period — which is precisely why the duplication was
worth removing rather than reporting: both forms answer plausibly, so the day they parted company a
member would have worked one list while the close attested to another. `matching.ts` now calls
`readUnmatchedTrustBankStatementLines`, which is also how the matching surface inherits the new
truncation probe.
