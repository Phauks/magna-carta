---
slug: trust-three-way-reconciliation
status: Proposed
area: Trust accounting / Reconciliation
date: 2026-08-05
summary: "The three-way reconciliation ships as a STORED, IMMUTABLE ATTESTATION over a HUMAN-CONFIRMED matching, and it is allowed to be red. Flags T9, T10, and T11 of the trust-accounting analysis ship as its recommended defaults: the proof is stored and frozen at the close rather than re-derived at read time (T9); the bank side is member-entered, with a CSV import added as a consensual guided conversion under ADR-0214 rather than a bank API integration (T10, extending the recommendation, which named import only as a seam); and 'signed' means an attestation by a named authenticated member recorded on the row, behind a seam a hash chain or the signing engine can be bound to later (T11). Four structural choices carry the design. (1) NOTHING MATCHES AUTOMATICALLY — the matcher ranks bounded candidates and prints the reasons, and a match row exists only because a member named both ends; a wrong automatic match makes the totals tie out while the ledger and the bank disagree about which events happened, which is the discrepancy the exercise exists to find, so there is deliberately no composer that takes a suggestion. (2) The book side of a match is a LEDGER ENTRY, not a trust_movement: an earned-fee transfer out of trust records a trust_transfer and no movement row at all, so a movement-keyed match could never clear one and every such transfer would sit outstanding forever. (3) A PROOF THAT DOES NOT BALANCE IS RECORDED, NOT REFUSED — the close freezes which leg disagrees and by how much, with no plug figure and no rounding to agreement, because a close that refused an unbalanced period would leave firms with a year of periods open (the same as no record) and would make the platform the judge of when a firm is allowed to have a problem. (4) The freeze runs ONE WAY: a closed reconciliation refuses every further write, so a backdated reversal moves the live proof and never the attestation, and a period redone later is a new reconciliation superseding the old. Both ledger legs are computed from dated ledger rows rather than from the stored account_balance, so a period reproduces; book and client therefore agree by construction while the composition guard holds, which makes a book-to-client disagreement a report that something reached the ledger without going through the guard."
---

**The three-way reconciliation is a stored, immutable attestation over a human-confirmed matching,
and an unbalanced period closes recording exactly that.**

**Context:** The no-negative floor guards the firm's own book. It structurally cannot guard the bank
account, because an overdraft can arise from an item the firm never recorded — a bank fee, a returned
deposit, a forged or duplicated check. Reconciliation is the only place those become visible, which
makes it a correctness feature rather than a reporting convenience, and makes every shortcut in it a
correctness problem rather than a usability trade.

Three flags in the trust-accounting analysis were left to the owner and are answered here as its
recommended defaults, each behind a seam.

**Decision — T9, stored and frozen.** A reconciliation is an attestation about a moment. If a
reversal posts next week with a backdated effective date, a re-derived "as of last month" report
changes after somebody signed it, which is exactly what an archived artifact exists to prevent. So
the close writes the three totals, the outstanding amounts, the unmatched counts, and whether the
legs agreed onto the row, and the migration's triggers refuse every further write to it. The live
proof is still recomputed on every read — of an open period, and of a closed one — and the two may
differ. That difference is not a fault: it is the ledger having moved since the attestation, and a
reader is shown both with the frozen one labelled as what the firm attested to.

**Decision — T10, member-entered and CSV-imported, no bank API.** The analysis recommended manual
entry only, with import named as a seam. This ships the seam as well, because the import is the same
posture ADR-0214 already binds the product to and building it later would mean building the
statement model twice. Detection and reporting are always on: reading a file reports the column
mapping it resolved, every row it could read and what each would become, every row it could not and
why, and the totals — and stores nothing. Storing takes a separate explicit act that quotes the
preview's fingerprint back, so a file that changed between being reviewed and being agreed to is
refused rather than stored. A date convention is stated by the caller and never detected: 03/04/2026
is two different days on two sides of an ocean, and a reconciliation built on the wrong one is wrong
in a way nobody notices. A file whose columns nothing recognizes is refused naming the headers it
found, never resolved by position. No bank API integration is built; an importer of a different
format becomes another producer of the same rows.

**Decision — T11, an attestation by a named member.** The rules require a reconciliation to be made
and kept; none of the researched jurisdictions compels a cryptographic form. `closed_by` and
`closed_at` on the frozen row are the attestation, and the append-only discipline is what makes it
worth anything. A hash chain over the artifact, or a real e-signature through the signing engine,
are additive to the same row and can be bound later without changing what a reconciliation IS.

**The four structural choices.** *Nothing matches automatically.* The matcher offers bounded
candidates — the amount must agree exactly and the direction must correspond, which is the bound
rather than a weight — with the reasons attached as facts a person can check: same day or within the
window, reference equal, counterparty similar. There is no score, because a suggestion nobody can
audit is one that gets confirmed without being read, and no composer that accepts a suggestion,
because one would let a caller loop over the top candidate with nothing in the module having changed.

*The book side is a ledger entry.* Anything that moves the bank balance is an entry touching the
trust bank account, whatever composed it. Keying a match on `trust_movement` would have been the
obvious shape and would have quietly excluded every earned-fee transfer out of trust, which records a
`trust_transfer` and no movement row.

*An unbalanced proof is recorded, not refused.* The close names which leg is out and by how much.
Unmatched statement lines and unmatched recorded items are first-class outcomes rather than error
states — the first is usually the item the firm never recorded, the second a deposit in transit or an
outstanding check — and neither has to be cleared before a period may be closed.

*The freeze runs one way.* A correction is a new reconciliation naming the one it supersedes. That
also gives the only remedy for a match somebody got wrong in a period they then closed: the
outstanding read ignores matches belonging to a superseded reconciliation, so the replacement
re-asserts the matches that were right and omits the one that was not.

**Considered & rejected:** **Re-derive the proof at read time** — simpler, no frozen columns, and it
makes last month's signed reconciliation change next week; the analysis names this as the failure the
artifact exists to prevent. **Auto-match on an exact amount-and-date agreement** — it would clear the
great majority of lines correctly and would be indistinguishable, from the report, from clearing them
incorrectly; the value of the exercise is entirely in the residue, and an automatic match dissolves
the residue at the moment of creating it. **Refuse to close an unbalanced period** — superficially
the strict, ethical choice; in practice it produces firms with a year of open periods and no record
at all, and it puts the platform in the position of deciding when a firm may have a problem. **Key
the match on `trust_movement`** — the vocabulary the rest of the subsystem uses, and it silently
excludes the earned-fee transfer, which is the single operation most likely to be reconciled wrong.
**Allow a closed reconciliation's matches to be withdrawn** — it would make the frozen attestation a
statement about a set that can still change, which is not an attestation. **Detect the date format
from the file** — every heuristic here is a guess about a jurisdiction, and the one that is wrong is
wrong silently, on money.

**Consequences:** A firm reconciling a month confirms each match by hand, bounded by a candidate list
that is short because the amount must agree exactly; the accumulating-confirmation relief ADR-0214
describes for bulk conversions is not available here and should not be, since each confirmation is
about a distinct event rather than a repeated question. Aggregated bank lines — one deposit slip
covering three checks — are not expressible as a single match and read as one match plus items left
outstanding, with the proof reporting the resulting difference rather than hiding it; that is an
honest degradation and a named place to extend. The frozen columns make a reconciliation report
renderable from stored rows with no recomputation, which is the read contract the reporting slice
needs. And every trust account now carries an external input the platform can be wrong about
out loud, which is the point.
