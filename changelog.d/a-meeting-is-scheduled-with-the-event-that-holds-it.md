---
category: Added
audience: public
---

**Scheduling a meeting is recording a calendar event with a medium on it.** The event form — the one
form, for a matter's event, the firm's, or one member's — gains a **Meeting** choice on its Where
tab: None, Video meeting, Audio call. Answering it writes the meeting row at save time through
`createMeeting`, so the entry window offers **Join** from the moment the event exists rather than
from the moment somebody presses Start. There is no second record and no second form: a meeting has
never carried a title, a time or a participant list of its own, and a scheduling feature that minted
its own invitation record would have been minting a second answer to when the meeting is and who is
at it.

**The room opens after the event commits, and that ordering is forced rather than chosen.**
`createMeeting` reads the event through the visibility predicate before it writes, so a meeting
composed into the batch still inserting the event it hangs on would be refused by its own gate. What
makes the second write safe is the property the create path already had: one meeting per event, held
by a partial unique index rather than by anything the caller passes — so the step carries no
idempotency key of its own, a retried save finds the room the first attempt opened and writes
nothing, and the response carries the same identifier on a replay as on the first commit.
`POST /api/v1/matters/{matterId}/events` and `POST /api/v1/firm-events` take
`meeting: { medium: "video" | "audio" } | null` and answer `{ id, meetingId }`; the two `PATCH`
routes take the same field and answer `{ ok: true, meetingId }`.

**An edit keeps the meeting; a cancellation settles it.** Moving an event's day or hour touches
nothing on the meeting, which carries no time of its own — and `meeting` on a correction can only
ADD a room, never take one away, because ending a gathering is an act with its own route and its own
audit row. Cancelling an event ends a **scheduled** meeting in the same batch as the cancel, so a
room nobody entered cannot outlive the setting it was for. Cancelling an event whose meeting is
**live** is refused, `409` with the new `meeting-in-progress` problem type naming the remedy: ending
a live meeting as a side effect of a calendar edit would take a room away from the people in it on
somebody else's click, and cancelling while leaving it running would have the record say the setting
is off while the product says it is happening.

**The colleagues on the event are told, through the notifications subsystem and nothing else.**
`calendar.event.meetingScheduled` is an outbox row in the same atomic batch as the room it announces
— so a batch that rolls back leaves no message, and a message that exists is proof the room was
opened. It carries identifiers, the medium, and the member handles named on the event at the write,
and no title, description, location or participant name. The new `named-members` audience is the
plural of `named-recipient` and resolves on its reasoning: the people to invite are the people who
were on the event when it was recorded, not whoever happens to be on it when the queue drains.
Directory-entity participants get nothing, and the form says so under the choice rather than leaving
a member to discover it from a client who never arrived. Firm events do not raise the invitation
yet: `notification_event.subject_kind` is a SQLite `CHECK` with no `firmEvent` value, and widening
one rebuilds a table `notification_recipient` points at — the firm meeting is scheduled, created and
joinable, and it is the notification alone that waits on that migration.

**Who is already busy is read, never refused.** Where the form lists colleagues, each one's own
calendar is read for the day being booked — the member filter the server already resolves in SQL —
and what it finds at the chosen hour is stated beside their name. It states and never blocks: two
things at once is routinely correct, and a scheduling form that would not let a member book over a
colleague is a form people stop using. What it prints is what the grid paints and never a title: the
federated read declares non-privileged labels by contract, so a matter event reads as its type, and
printing one matter's content on another matter's form would be a disclosure.

**The Meetings page schedules.** It gains the product's one create control, which opens the same
event form with the meeting choice preset to Video meeting, over the same `calendarContext` every
other calendar surface reads — a second assembly of the roster, the type catalog and the firm's
rooms would be a second answer to what the form is offering.

## Public

**Schedule a meeting or a call from the calendar.** When you record an event — on a matter, for the
firm, or on a colleague's calendar — the Where tab now asks whether it is also a meeting: **Video
meeting**, **Audio call**, or **None**. Choose one and the room is created with the event, so
everybody on it sees **Join** straight away instead of waiting for somebody to press Start.

**Everyone at the firm on the event is invited**, and each of them gets a notification with a link
to the event. A client or another party from the Directory is not sent a way in yet — the form says
so under the choice, so you know before you send it.

**You can see who is already busy.** As you add colleagues to the Who tab, each name shows what is
already on their calendar at the time you have chosen. It never stops you booking — two things at
once is often exactly right — it just puts the answer where you are asking the question.

**Moving the event keeps the meeting**, and cancelling the event closes a room nobody has joined. If
people are actually in the meeting, cancelling the event is refused until somebody ends the meeting
— a calendar edit will not close a room you are sitting in.

**The Meetings page has a New Meeting button**, which opens the same form already set to a video
meeting. Guides: [Meetings](../docs/user/features/meetings.md) and
[Case calendar and deadlines](../docs/user/features/case-calendar-and-deadlines.md).
