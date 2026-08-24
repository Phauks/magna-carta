---
number: 335
slug: a-lead-is-a-prospective-matter-and-conversion-is-one-way
status: Proposed
date: 2026-08-15
area: Client intake
summary: "A lead and a prospective matter are one record, not two: the matter shell already carries a responsible attorney, a title, a type, parties, documents and calendar events, and the custom-fields engine extends it, so a separate lead entity would duplicate all of it and then need a migration at conversion that moves documents — the specific harm avoided by making each consultation its own matter. Conversion is the shipped open transition and intake adds only the preconditions in front of it; it draws the number inside the matter's own atomic batch and there is no second write path to an open matter. Conversion is one-way and stays one-way: un-converting would either release a drawn number back to a counter that a primary key exists to prevent, or leave a gap a firm's numbering audit reads as a missing file. The correct undo for a mistaken conversion is closing the open matter. The engagement letter and the fee agreement are hand-offs to the packages that own them, in that order, after the number exists."
---

**A lead is a prospective matter, conversion is the shipped open transition, and the drawn number is
why there is no going back.**

**Context:** every product in this category models a lead as its own object with its own fields and
its own lifecycle, converting it into a matter at the end. The matter lifecycle here already went the
other way — everything is a matter, one data model, and a consultation is an individual prospective
matter so its documents never move on retention and its parties feed conflicts permanently.

**Decision:** there is no lead table. A lead **is** a prospective matter, and everything a lead needs
is already on it or extends it: a responsible attorney, a title, a type, party links, documents,
calendar events, and firm-defined fields through the shipped custom-fields engine on either the
matter type or the client's entity category. A separate lead entity would duplicate that surface and
then require a conversion migration that moves documents from the lead to the matter — precisely the
harm the consultation-is-a-matter shape was chosen to avoid.

Conversion is the shipped open transition: it draws the number from the segment-template engine inside
the matter's own atomic write batch, asserts the prospective status on the UPDATE itself rather than
only in a pre-read, and confirms after the commit that the row carries the number it drew. Intake
adds the preconditions in front of it and composes no matter update of its own; there is no second
write path to an open matter and this design creates none.

**Conversion is one-way, and that is a property to keep rather than a limitation to fix.** The reopen
path already returns a closed matter to prospective only when it was never opened. Once a number is
drawn it is frozen: releasing it back to a counter is what the number-allocation primary key exists to
prevent, and leaving the gap gives a firm's own numbering audit a missing file to explain. The
correct undo for a mistaken conversion is closing the open matter, and the mistaken-conversion rate
is not worth optimising against a numbering invariant.

The two hand-offs run in a fixed order, and intake owns neither. The matter is opened first, because
the number is a merge field the engagement letter will almost always carry and the merge context
reads it from the matter row. Then the engagement letter is assembled by the document-automation
engine against a template the firm registered and filed to the matter through the ordinary path —
intake supplies no template and no merge fields. Then the fee agreement is recorded through billing's
append-only versioned arrangement writer.

**Considered and rejected:** a lead entity converted into a matter (a document migration at the worst
possible moment, and a second identity to reconcile); drawing the number at prospective creation
(dead consultations burn numbers and wrong-year them — already settled); a reversible conversion that
returns the number to its counter (the allocation primary key refuses it, correctly); intake owning an
engagement-letter template or a fee-agreement writer of its own (two subsystems that already own
those, and two copies that would drift).

**Consequences:** conversion needs no new machinery, only preconditions, and a consultation's
documents and calendar entries are the open matter's documents and calendar entries with nothing
moved. The cost is that a firm cannot un-convert, which has to be said plainly in the user
documentation rather than discovered.
