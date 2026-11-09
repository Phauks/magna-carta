---
number: 261
slug: calendar-firm-events-resources-links-continuance
status: Accepted
date: 2026-08-07
area: Calendar and docketing
summary: "Calendar slice 2 executes the owner's two docket overrides (L1: firm events and room availability must exist; L4: a continuance is a real-world reschedule the record must show honestly) with five new per-firm tables and one additive column, and no change to any shipped row's meaning. FIRM EVENTS get their own firm_event table rather than a nullable matter_id — rejected once on the domain ground slice 1 stated (every matter_event read keys off the matter, and the visibility predicate's value is that it has no branches) and once mechanically: dropping NOT NULL on a shipped SQLite table is a rebuild, which the additive-only lineage forbids, so the loosening is not merely undesirable but unshippable. A firm event shares the civil-date/time/zone shapes and the three-shape participant model (its own participant table, same rebuild reason), reuses the matter_event_type catalog (its category column already carries firm; the matter_ name prefix is an accepted, recorded wart cheaper than a second home for one vocabulary), and adds audience = all_members | participants so a firm holiday is on everyone's calendar without enumerating members — a list that decays with every hire. Visibility is an HONEST DECLARATION, not a silent exemption: the source contract gains visibilityAnchor = matter | firm; matter-anchored sources compose the predicate exactly as today (fitness-enforced), firm-anchored sources are a reviewed allowlist whose rows are firm-visible by construction under the trusted-insider posture — ethical walls are matter screens with nothing to bind to on a firm meeting. RESOURCES (rooms, vehicles, equipment) are their own firm_resource table — NOT Directory entities (the Directory is the conflicts corpus; a conference room beside opposing counsel is the forced-judge problem with less dignity) and NOT custody_location nodes (that tree answers where the original will is, and bookability is not custody). A BOOKING is its own row attached to EXACTLY ONE event (matter or firm; a bare 'book the car' is a Reservation-type firm event), with its own window defaulted from the event (setup time is real) and a zone frozen from the resource's office at the write; its LIVENESS IS DERIVED from the event's status — no released flag, no second write, a room freed by cancellation cannot drift because releasing is not an action. Overlap is a two-stage bounded check (coarse civil-date SQL widened a day each side, precise instant intersection in application code through each row's own zone), and DOUBLE-BOOKING IS WARN-AND-ALLOW WITH VISIBLE CONFLICTS: refusal would make the platform referee rooms it does not own (tentative holds and shared rooms are real intentions), could not be held by the schema anyway (SQLite has no interval exclusion constraint, so a refusal is a race), and must never be the reason a hearing cannot be recorded — the overdue-deadline posture applied to rooms: report, never adjudicate. EVENT LINKS are one calendar_event_link table with four end columns (exactly one per end), kinds continuance_of | related plus a free-text note, real foreign keys because the calendar linking to itself can afford integrity. CONTINUANCE dissolves slice 1's edit-or-new-row dichotomy instead of picking the other horn: a CORRECTION is still an edit (the row misdescribed reality; slice 1's mutable-event rule stands), a CONTINUANCE is a new setting — the old row keeps every historical column untouched, its status becomes cancelled (accurate: that setting will not occur; also the only option, since widening the status CHECK is a rebuild) with a new nullable status_reason, a new row carries the setting as it now stands, and one continuance_of link points new to old, constrained to a CHAIN by two hand-written partial unique indexes (at most one predecessor and one successor per setting — the schema, not a service invariant, refuses a fork). Slice 1's every-consumer-hides-one objection assumed the old row would still read scheduled; it does not, so consumers change not at all. The continue operation is one atomic batch whose response lists open deadlines whose trigger names the continued event (a lookup, never a cascade — the ratified no-arithmetic position binds in full) and the bookings the status change just released by derivation. Continuance binds matter events only; a moved staff meeting is not procedural history. Four notification emission points are declared and wired to nothing (calendar.firmEvent.scheduled/rescheduled/cancelled, calendar.booking.conflict); a continuance raises the existing calendar.event.rescheduled. Three owner flags, all confirmations: the warn-and-allow posture, the closed resource-kind enum, and no freestanding bookings."
---

**Calendar slice 2: firm events in their own table, resources with derived-liveness bookings and
warn-and-allow double-booking, typed event links, and continuance as a chain-linked new setting that
never rewrites history.**

**Context:** The owner's 2026-08-07 docket overrode two of the calendar slice-1 flags: L1 (the
recommendation that every event require a matter) fell to "we need to enable people to put firm
meetings" and "availability of rooms", and L4 (continuance as an in-place edit) fell to the position
that a continuance is a real-world reschedule the record must show — what was continued from what —
without falsifying history. The owner also directed event links. Everything else from slice 1 was
ratified and stands: federation over projection, per-row zones, civil dates, the visibility seam,
the window-cap refusal, and the refusal of deadline arithmetic.

**Decision:** Per the summary. Spec:
[`docs/specs/2026-08-07-calendar-slice-2-firm-events-and-resources.md`](../specs/2026-08-07-calendar-slice-2-firm-events-and-resources.md)
(design and implementation plan, one document). Five tables (`firm_event`,
`firm_event_participant`, `firm_resource`, `firm_resource_booking`, `calendar_event_link`), one
additive column (`matter_event.status_reason`), one new timeline source (`firmEvent`), one contract
field (`visibilityAnchor`), zero rebuilds.

Built as designed (all three build slices in one pass; migration
`20260807T070000_calendar-firm-events-resources-links`). Two details the build pinned down within
the design's terms: a timed booking with no recorded end time occupies its resource through the end
of its last civil day (a room booked "from nine" with no end is not free at one minute past nine —
the warn posture's safe direction), and the firm-events list's filters are the status and the
event-type, the two vocabularies the table actually carries.

**Considered & rejected:** _nullable `matter_id` on `matter_event`_ (a branch inside the one seam
whose value is having none — and a table rebuild the lineage forbids, which closes the question);
_a new `continued` status value_ (same rebuild constraint; and `cancelled` is accurate — the
successor link, not the status, is what distinguishes continuance from cancellation);
_resources as Directory entities_ (conflicts-corpus pollution — the forced-judge argument, harder);
_resources as `custody_location` nodes_ (couples bookability to custody semantics);
_bookings folded into an event column_ (one resource per event and one window for two facts, both
false); _freestanding bookings_ (would reinvent audience, cancellation, and the calendar read per
booking; a Reservation-type firm event already carries all of it); _a stored booking release flag_
(a second write that can drift from the event's status, where a join cannot); _refusing
double-bookings_ (adjudicates intentions the platform does not own, cannot be held by SQLite as an
invariant, and must never block recording a hearing); _silent double-booking_ (a grid that lies by
omission); _continuance via the audit log alone_ (slice 1's edit model — overridden by its author:
editing the row unhappens a setting that occurred); _a platform vocabulary of link kinds beyond the
two_ (the engine branches on `continuance_of` and on nothing else; the rest is the note's job).

**Consequences:** The calendar answers "whose calendar is this on" with two tables instead of one
nullable column, and the federated read gains one source and one honest declaration instead of a
branch in the predicate. Room availability is a read over facts the calendar already holds, with
conflicts as visible data rather than refused writes. A continued hearing's full procedural history
— every setting, every reason, in order — is walkable from any node, held to a chain by the schema
itself, while a typo remains one edit. The costs, stated: a participant-table shape duplicated
(schema-level only; the service logic is parameterized), a shared type catalog whose name says
`matter_` while serving both scopes, and a booking model that cannot express "hold this room for
nothing at all" without a Reservation event — each recorded above as the cheaper side of its trade.
Owner flags R1 (warn-and-allow), R2 (closed resource-kind enum), R3 (no freestanding bookings) are
confirmations of recommendations; the scope itself carries owner direction and proceeds without
further asks.
