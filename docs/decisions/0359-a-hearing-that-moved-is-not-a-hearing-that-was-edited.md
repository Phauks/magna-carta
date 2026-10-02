---
number: 359
slug: a-hearing-that-moved-is-not-a-hearing-that-was-edited
status: Proposed
date: 2026-08-15
area: Calendar
summary: "The calendar's three matter-event write paths gain real outbox topics — `calendar.event.scheduled`, `.rescheduled`, `.cancelled` — written in the same atomic batch as the row they describe, with payloads of two identifiers and nothing else. `rescheduled` is raised only when the edit actually moves the setting (its dates, its times, or its zone), never on a title or room correction; a continuance raises exactly one `rescheduled` naming the NEW setting rather than a cancellation plus a scheduling, because one real-world thing happened. The three topics are spelled once in `packages/calendar/src/notifications.ts` and the frozen emission-point list is built from those constants, so a producer and a subscriber cannot come to disagree — which matters more than it looks, because an unrecognized topic on the per-firm bus is acked and ignored by design and a misspelling therefore stops delivery silently instead of throwing."
---

**Three of the calendar's declared emission points were writes all along, and a write that announces
itself in its own batch is the only kind of announcement that cannot be lost.**

**Context:** `CALENDAR_NOTIFICATION_EMISSION_POINTS` has been a list of names wired to nothing since
the calendar shipped, named early for the stated reason that adding a raise to a write being built is
one line where finding every write path afterwards is archaeology. Three of those names — scheduled,
rescheduled, cancelled — describe things a person does, which the package already commits a row and
an audit entry for. The rest describe comparisons nobody performs, or firm events with no matter to
anchor a recipient's visibility to.

**Decision:** The three matter-event points become outbox topics on `createMatterEvent`,
`updateMatterEvent`, `cancelMatterEvent`, and `continueMatterEvent`, in the batch each already
composes. The package learns nothing about delivery: it publishes a name and stops. Its "no cron, no
queue, no recipient resolution here" property is untouched.

**Rescheduled means the setting moved.** The update path serves both a correction and a real
reschedule, and the two are told apart by comparing exactly the five columns that answer _when this
happens_ — `starts_on`, `starts_at_time`, `ends_on`, `ends_at_time`, `time_zone` — against the merged
patch. Comparison is byte equality on civil text and a zone identifier, so there is no arithmetic
here to get wrong, and a patch that names a date and repeats it raises nothing. A title fix or a room
change raises nothing at all.

This is not fussiness. A notification is the one thing a reader acts on _without_ opening the record:
"your hearing moved" reorganizes a week. Raising it for a typo correction is how a team learns that
the announcements do not mean anything, and a channel people have learned to ignore is worse than no
channel.

**A continuance raises one message, and it says rescheduled.** The batch cancels a row and inserts
another, because that is how the record honestly expresses a court vacating one setting and making
another. But one thing happened in the world. Announcing the two rows would tell a team the hearing
is off, and separately that some different hearing exists, and leave them to work out that these are
the same hearing. The subject is the new setting, because that is the one that is going to happen.

**The payload is two handles.** The matter event and its matter. Not the title, which is routinely
the parties and the dispute; not the court reference, which is a case number; not the location or a
participant's name. The message crosses a queue and lands in a notification row that outlives the
access check which justified writing it, so what a reader needs is resolved behind the deep link,
through the calendar's own access-checked read.

**Considered and rejected:** **Raising `rescheduled` on every update** — simpler by one function, and
it makes the loudest notification in the calendar fire for a spelling fix. **Raising both `cancelled`
and `scheduled` for a continuance** — mechanically faithful to the batch and false about the world.
**Carrying the new date in the payload** — within the fact grammar, genuinely useful, and the single
most stale-prone thing the row could hold, since the entire reason this topic exists is that settings
move. **Wiring the three firm-event points at the same time** — a firm event has no matter, so it
needs the firm-scoped audience question answered before it can reach anybody; they stay declared.

**Consequences:** Three emission points that were names are now guarantees, transactional rather than
best-effort. Everyone carrying a file hears when its settings move. The remaining seven names in the
list are now genuinely a to-do list rather than a mixture of to-do and done.
