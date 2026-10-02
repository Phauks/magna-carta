---
number: 417
slug: a-consultation-is-numbered-from-its-own-sequence
status: Proposed
date: 2026-08-31
area: Matters
summary: "A prospective matter draws a tentative CONSULTATION number at creation, from a sequence of its own, rather than remaining unnumbered until it opens. The two sequences are kept separate — a consultation that never becomes a matter must consume no matter number, because a gap in the firm's matter run reads as a lost file — and opening a matter ADDS its permanent number rather than replacing the tentative one, so a document filed under the tentative number still resolves and the two never contend for one column. Both draws ride the existing matter_number_counter / matter_number_allocation mechanism under scope keys namespaced with a 'consultation/' prefix, rather than a second pair of tables that would duplicate the mechanism and the subtlety that makes it correct; '/' is outside the URL-safe set every rendered segment is folded into, so no matter scope key can collide with a consultation one. numbering_scheme gains a purpose column with one active scheme per purpose, and the consultation purpose — unlike the matter purpose — falls back to a built-in default scheme when the firm has configured none, because refusing to take a consultation until somebody visits the settings screen is a worse failure than rendering a shape the firm did not choose for a number that is scaffolding rather than the firm's file spine."
---

**A consultation is a real file a firm has to be able to name, and "Consultation" is not a name.**

**Context:** A prospective matter carried `matter_number = NULL` by design: the number was the firm's
own file numbering, drawn when the matter opened, and a consultation had not earned one. Every
surface then had to print something where a number belongs, and what they printed was the word
"Consultation" — the docket's number column, the matter header's eyebrow, the overview's key facts.
That is a category, not an identifier. A firm that takes a consultation has a physical file, an
intake sheet, a conflicts check to run and often a bill to raise for the consultation itself, and
none of those can be indexed by the word "consultation" when the firm takes three a week.

The obvious repair — draw the matter number early — is the wrong one, and it is wrong in a way that
is invisible until a year of numbers has been issued. Most consultations do not become matters. A
matter number drawn for one that does not is a number issued to nothing, and a firm reading its own
run later cannot tell a declined consultation from a file that went missing. The matter run is the
spine of the file room; it has to stay dense.

**Decision:** A second sequence. `matter.consultation_number` is drawn at creation for a prospective
matter, from a scheme whose `purpose` is `consultation`, and frozen there. Opening the matter draws
`matter_number` alongside it and leaves it standing.

Four things follow, and each was the alternative considered and rejected:

**Not one column reused.** The tentative number does not become the matter number and is not
overwritten by it. A document filed, an email sent, or a conflicts result recorded under the
tentative number must still resolve after the matter opens, and it cannot if the column it was in
now holds something else.

**Not a second counter mechanism.** The draw rides `matter_number_counter` and
`matter_number_allocation` with a `consultation/` prefix on the scope key. A second pair of tables
would duplicate the counter idiom — and specifically the reasoning that a zero-row guarded UPDATE
aborts nothing, so the allocation primary key is the real backstop — into a place where it would
drift. The prefix is safe because scope keys are built from rendered segment values, every rendered
value is folded into the RFC 3986 unreserved set, and that set contains no `/`.

**Not one active scheme per firm.** `numbering_scheme.purpose` splits the template table, with one
active scheme per purpose. A firm shapes its consultation numbers independently of its matter
numbers because they answer different questions; sharing a template would mean a firm could not
distinguish the two by looking at them.

**Not the same "no scheme" behaviour for both.** A matter draw with no configured scheme still
refuses (`scheme-missing`): there is no defensible default shape for a number that is then frozen and
becomes the firm's permanent reference, so inventing one would stamp a decision the firm never made.
A consultation draw falls back to a built-in default (`C{YYYY}-{NNNN}`, the year scoping so the run
restarts each January). The asymmetry is deliberate and follows from what each number is for:
refusing to take a consultation because nobody has been to the settings screen is a worse failure
than a tentative number in a shape the firm will later change, and the consultation number is
scaffolding for a file that may never exist.

**Consequences:** The read surfaces carry both numbers rather than one — summary, detail,
consultations list, create acknowledgement — and the docket's search matches either, since for a file
that is still a consultation the tentative number is the only number anyone has. The number column
shows the consultation number while the matter is prospective and the matter number once it opens;
the "Consultation" designation survives only as the fallback for a prospective matter created before
this sequence existed, which is an honest gap rather than a backfilled guess. `GET`/`PUT
/api/v1/numbering-scheme` take a `purpose` defaulting to `matter`, so every existing caller keeps its
meaning, and the GET reports `usingDefault` so a settings screen can show what is actually rendering
today rather than an empty box beside numbers people can already see.
