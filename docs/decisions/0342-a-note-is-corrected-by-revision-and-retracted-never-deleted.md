---
number: 342
slug: a-note-is-corrected-by-revision-and-retracted-never-deleted
status: Superseded — 2026-09-01, by the owner
date: 2026-08-15
area: Notes and activity
summary: "A note is a chain — an identity row carrying the matter, the original author and the created instant, plus revision rows each carrying a body, its own author and its own instant. An edit appends a revision and moves the head; every prior body is retained. Retraction is a state with its own actor, instant and reason: the body stops rendering everywhere and drops out of the federated timeline entirely, while the row and its revisions remain. There is no hard-delete path, no route and no capability, and the one case where bytes genuinely must leave — an erasure obligation, or another person's protected data typed into a note — routes through the deferred erasure orchestrator under the PII registry's report-manual action, which exists for exactly this and neither auto-erases free text nor silently refuses. The reasoning is that a note is neither the ledger nor the calendar: the ledger is append-only because a third party relies on it and the firm demonstrably could not have changed it, which no rule of conduct demands of a note; the calendar edits in place because it records a plan, and a firm made to file a compensating row to fix a typo stops recording — but a note is a contemporaneous record whose evidentiary weight comes from having been written then, by that person, saying that, and editing it in place destroys the property that makes it worth keeping."
---

> **SUPERSEDED on 2026-09-01, hours after it was built, by the owner's direction.** A note is now
> edited in place and deleted outright: the revision chain, the three `RAISE(ABORT)` triggers and the
> retraction state are all gone, and `notes:retract` retired with them. The owner's reason is that
> replacing a note with another note every time somebody fixes a word accumulates without end. The
> concern below was put to them with the scenarios spelled out and they reaffirmed the decision, so
> the argument is kept here as what was weighed rather than deleted as if it had never been made.
> What replaced it: `20260901T120000_matter-notes-edit-and-delete` and `packages/notes/CLAUDE.md`.

**A note is corrected the way a ledger is corrected and retracted the way nothing else here is, because
it is evidence written in a hurry.**

**Context:** every append-only subsystem in this platform refuses edits and takes a new row — the
ledger and audit log by invariant, trust holds and transfers by database trigger, the custody register
through a `correction` movement kind, the conflicts log behind six `RAISE(ABORT)` triggers. The
calendar is the one deliberate departure, and it argues its case well: "a calendar is a plan and a
record of a plan, hearings move, and a firm made to record a compensating row to fix a typo stops
recording."

A note primitive has to pick a side, and neither side fits.

**It is not the ledger.** What makes a trust movement append-only is that a **third party relies on
it** — a bar auditor, a court, the client's accountant — and its value is that the firm demonstrably
could not have changed it. Nobody audits a firm's notes, and no rule of professional conduct requires
a note to exist at all.

**It is not the calendar.** A calendar entry is a plan; its current value dominates its historical
value, and a hearing date that was wrong yesterday is simply wrong. A note is a contemporaneous
record. Its evidentiary weight is that it was written at that moment, by that person, saying that.
Editing it in place destroys precisely the property that makes it worth having.

And a note carries a pressure neither subsystem has. It is the record a lawyer writes fastest and
least carefully. It will contain typos, the wrong client's name, and occasionally something that
should never have been typed at all: another person's protected health information, or a privileged
communication belonging to a different client.

**Decision: revisions, retraction, and no delete.**

**A note is a chain.** `matter_note` holds the identity — matter, original author, created instant,
state. `matter_note_revision` holds a body with its own author and its own instant. An edit appends a
revision and moves the head; every prior body is retained and reachable from the note's own surface.
This is the ledger's discipline applied to text: the correction is a new row and the old one stays.

**Retraction is a state, not a delete.** A retracted note stops rendering its body everywhere — the
matter surface shows a tombstone and the federated timeline excludes it entirely — while the row, its
revisions, its author and its instants remain. Retraction carries its own actor, instant, and a
required reason, and it is deliberately visible: the firm can see that a note was retracted and by
whom. That visibility is what makes retraction usable as a correction mechanism rather than a quiet
erasure, and it is why retraction gets its own permission rather than riding an ordinary write.

**There is no hard delete in the product.** No route, no capability, no bulk action. The one case
where bytes genuinely must leave the database is legal rather than editorial, and the PII registry
already has the right action for it: **`report-manual`**, defined there as "free-text / document
content — surfaced in the residue report, not auto-erased." A note is what that action was written
for. The platform neither silently erases a note nor silently refuses to; it reports it and a person
decides.

**Considered and rejected:** **edit in place with an audit row**, the calendar's answer — it is right
for a plan and wrong for evidence, and the audit row records that a change happened without preserving
what was changed from. **Soft-delete with a `deleted_at` column** — it conflates "this was wrong" with
"this should never have existed" and gives neither an actor or a reason. **A `superseded_by` pointer
between whole notes** rather than revisions within one — it makes a three-edit note into four notes on
the timeline and pushes deduplication onto every reader. **Hard delete behind a narrow permission** —
there is no permission narrow enough; the first firm to hold one will use it to remove something
inconvenient, and the record will not say it happened.

**Consequences:** a note's history is complete and a firm can prove what it knew and when. Retraction
handles the case that would otherwise force a delete, at the cost of leaving a visible tombstone,
which is the correct trade. Two PII registry entries follow: the revision body as `report-manual` on
the entity axis, and the author reference as `pseudonymize-keep` on the user axis.

**One thing this decision leaves to the owner:** whether the append-only discipline on the revision
table is **enforced by database trigger** on the conflicts-log pattern, or by application code alone.
Triggers make a note's history unrewritable by any future statement builder or maintenance script;
they also make honouring a genuine court-ordered deletion a migration rather than a query. The
recommendation is triggers on the revision table and none on the note head, whose state column has to
move for retraction — but the cost lands on the owner and the owner decides.
