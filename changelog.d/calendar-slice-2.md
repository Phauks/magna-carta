---
category: Added
---

Calendar slice 2 — firm events, rooms and resources, event links, and honest continuance. The
owner-directed second slice, built through every layer: five new per-firm tables, one additive
column, one new federated source, and fifteen new routes.

**Firm events.** The calendar stops assuming every event belongs to a case. A firm meeting, an
office closure, training, a firm holiday, or a reservation gets its own `firm_event` table — never
a nullable matter on the case-event table — with the same civil-date, wall-clock-time, and per-row
zone model, plus an **audience** switch: an all-members event is on every member's calendar without
a list that decays with each hire. Firm events interleave on the one firm calendar (a new `scope`
filter narrows to either side) and never appear on any matter's timeline. The federated read gains
the declared `visibilityAnchor` contract field: matter-anchored sources compose the visible-matter
predicate exactly as before, fitness-enforced, and the firm-anchored source sits on a reviewed
allowlist — an honest declaration, never a silent exemption.

**Rooms and resources.** Conference rooms, pool cars, and equipment become first-class firm
resources, and a booking ties one resource to exactly one event with its own window (the room from
half past eight for a nine o'clock deposition) in the resource's own zone, frozen at the write. A
booking blocks its resource **only while its event is live** — cancelling or continuing an event
frees its rooms by derivation, with no release step to forget. **Double-booking warns and allows:**
the write succeeds, the response carries the conflicts it created, and the availability read
pre-pairs every overlap — the platform reports what it sees and does not referee rooms. The grid
shows windows and kinds, never titles.

**Event links and continuance.** Events link (`related`, with a note), and a continued hearing
becomes a **new setting pointing at the vacated one**: the old row keeps every historical byte, its
status says that setting will not occur and why (`status_reason`, additive on the shipped table),
and the schema itself holds the chain to a chain — one predecessor, one successor, no forks, even
under racing writes. The full procedural history of a hearing is walkable in order from any
setting. A typo remains a one-row edit: correcting a record and rescheduling reality are different
acts, and the platform now has a verb for each. Continuing moves **no deadline** — the response
lists the deadlines that referenced the old setting as pure information, because what a continuance
does to a briefing schedule is a legal judgement.

Four notification emission points declared and wired to nothing; five firm-scope platform event
types seeded, and a firm event takes one of those firm-category types — the shared catalog's
category is what separates the two scopes, so typing the all-hands as a "Hearing" is refused by
name rather than filed as procedural history; the five load-profile bounds asserted over the fixtures corpus (a year of weekly firm
events, eight resources, deliberate overlaps, a five-node continuance chain). Owner flags R1
(warn-and-allow), R2 (closed resource kinds), R3 (no freestanding bookings) built as confirmed.
