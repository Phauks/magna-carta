---
category: Added
---

Calendar slice 2 — design. The owner's docket sent the calendar back for a second slice: firm
events, room and resource availability, links between events, and honest continuance semantics.
This is the specification and implementation plan for all four; no product code in this cycle.

**Firm events.** The calendar stops assuming every event belongs to a case. A firm meeting, an
office closure, training, a firm holiday — these get their own table with the same civil-date,
wall-clock-time, and per-row time-zone model hearings use, plus one thing hearings never needed: an
audience switch, so a firm-wide entry is on everyone's calendar without enumerating every member
into a list that decays with each hire. Firm events appear on the one firm calendar interleaved
with matter events under the same cursor, and never on a matter's timeline, because they belong to
none.

**Rooms and resources.** Conference rooms, pool cars, and equipment become first-class firm
resources — their own register, not Directory entries (the Directory is the conflicts corpus, and a
conference room does not belong next to opposing counsel) — and a booking ties a resource to
exactly one event, with its own window (booking the room from half past eight for a nine o'clock
deposition is real) in the resource's own zone. A booking blocks the room only while its event is
live: cancelling the event frees the room by derivation, with no second record to forget.
**Double-booking is recorded and reported, never refused.** Firms double-book on purpose —
tentative holds, shared rooms — and the front desk resolves rooms, not the software; the write
succeeds and both sides see the conflict, on the booking, on the grid, and in the response. A
room's schedule spans every matter, so the grid shows windows and kinds, never titles.

**Event links and continuance.** Events can be linked — a prep session to its deposition — and one
link kind carries real machinery: a continued hearing becomes a **new setting pointing at the
vacated one**. The old row keeps its date, its participants, and its history untouched; its status
says that setting will not occur and why; the new row is the hearing as it now stands; and the
schema itself holds the chain to a chain — one predecessor, one successor, no forks. Nothing is
rewritten and nothing is hidden: the timeline shows every setting in order, which is the procedural
history a litigator actually needs. A typo remains a simple edit — correcting a record and
rescheduling reality are different acts, and the platform now has a verb for each. Continuing a
hearing moves **no deadline**: the response lists the deadlines that referenced the old setting for
a person to review, because what a continuance does to a briefing schedule is a legal judgement,
not arithmetic.

Five per-firm tables, one additive column, one new federated source, four declared notification
emission points wired to nothing, and three owner flags — all confirmations, the scope itself
already owner-directed.
