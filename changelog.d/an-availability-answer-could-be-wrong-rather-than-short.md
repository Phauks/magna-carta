---
category: Fixed
audience: internal
---

**A resource's availability could report a room as free when it was double-booked.** The read caps at
two thousand bookings in the window, then pairs overlapping bookings over the rows it was handed. A
booking past the cut that overlapped one inside it was a conflict the grid never painted — a _wrong_
answer rather than a short one, and wrong in the direction that says a room is available.

The cap was reachable with ordinary data, not only pathological data: the window is capped at 366
days, and a well-used meeting room booked six times a working day crosses two thousand inside one
year. The read now **refuses** past the ceiling and names the remedy — ask for a shorter window —
taking the posture the continuance walk and the stocktake reconciliation already take when an answer
cannot be given accurately in one pass. The ceiling is injectable so the refusal is provable at a size
a test can seed rather than by writing two thousand rows.

**The resource picker's silent backstop now reports itself.** Five hundred was a magic number in the
route handler; it is `MAX_FIRM_RESOURCES` beside the statement, and the response carries `capped`. The
picker still returns the whole catalog rather than a page, because a picker missing a room says the
room does not exist — but a firm that somehow holds more bookable things than one answer carries is
now told to filter by kind or office instead of being shown a short list that looks complete.

**The event-type catalog and the continuance chain are recorded as bounded by construction**, each
with what bounds it: a firm's own event vocabulary, and `MAX_CONTINUANCE_CHAIN_DEPTH`, which
`readContinuanceChain` already asserts on every step because a chain longer than that is corrupt
rather than continued. The chain must also stay whole — it is the procedural history of one hearing,
and half of it is a different account of what happened.
