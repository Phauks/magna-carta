---
category: Added
audience: internal
---

**The matter Calendar section reads the firm's own record.** Thirty-three calendar endpoints have
been built since early August and no screen called any of them; the section rendered a stub. It now
reads two things a matter's calendar is actually made of: every deadline recorded against the matter,
soonest first, and every event, furthest ahead first. Neither list is narrowed — a deadline already
satisfied or vacated is part of the record, and a cancelled setting is shown as cancelled rather
than hidden, because a setting that was called off and one that never existed are different facts.

Overdue leads. A deadline that is open and past its moment is the only thing on the screen anyone
still has to act on, so it is the only thing that alarms; the count is stated at the top. Past due is
the server's own read-time derivation in each deadline's own time zone, not a stored flag — there is
no column anywhere that says a firm missed something, and this screen adds none.

**The event listing answered with a type identifier and no name.** A screen handed
`eventTypeId` has nothing to render, which is the same hole the cost listing had for its vendor and
the time listing had for its timekeeper. The listing and the single-event read now resolve the type's
name through a display projection that joins the type catalog; the join is LEFT, so an event
classified under nothing stays in the list rather than falling out of it. The lean single-event read
the six lifecycle services use is untouched — resolving whether a change is allowed does not need a
type name, and widening six reads to serve one is the wrong trade.

Recording a date from this screen still waits on the participant picker, so those actions render
disabled and say why. Where a page shows only the first page of a longer record, it now says so
rather than presenting a truncated list as the whole thing.
