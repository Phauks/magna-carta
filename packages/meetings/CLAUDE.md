# @magna-carta/meetings — CLAUDE.md

**Purpose.** The meeting record: one room per calendar event, who opened it, who was in it, and when
each of them arrived and left. It validates in memory and composes statements into
`@magna-carta/data-access`'s `composeEffectBatch`; it holds no binding, reads no clock, and never
calls an external service. The media, the signaling socket and the routing credentials are the
Worker's and are unreachable from here.

**White paper:** _Communications layer_ and _Calendar and rules-based docketing_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-09-18-meetings-design.md`](../../docs/specs/2026-09-18-meetings-design.md).

## Key files / entry points

- `src/types.ts` — the two closed vocabularies, the room's one ceiling, the stored row shapes, and
  the `MeetingSummary` a surface paints
- `src/validation.ts` — every refusal as a code the route maps to a problem type
- `src/meeting-statements.ts` — the SQL, and **the access gate**: `visibleEventClause` is the one
  place the walled-matter question is answered
- `src/meeting-service.ts` — create, join, leave, end, and the socket-loss close; each one batch
  with its audit rows

## A meeting has no visibility rule of its own

It hangs from a calendar event, and the event's rule is the whole of the answer: a matter event is
reachable when the member may see the matter (`visibleMatterPredicate` from
`@magna-carta/calendar/visibility`), a firm event is firm-visible. Every read here composes that
predicate against the event's matter, as a **required** argument rather than an option with a
default — the notes and communications precedent, for the same reason.

The firm branch is written as a literal `event_kind = 'firm'` rather than as the absence of a clause,
so both answers sit in one expression and a reader can see the firm case was decided rather than left
out.

## One refusal for every way a room is out of reach

An event that does not exist, an event on a matter the reader may not see, and a meeting handle that
names nothing all raise `meeting-unknown-event`. They are one question: a meeting is reachable only
through its event. Telling them apart would make the route an existence oracle for walled matters —
ask about an id, learn from the wording whether it is real.

`meeting-already-ended` and `meeting-room-full` are separate because each is a different problem with
a different fix, and neither reveals anything about a matter.

## The room carries nothing the event carries

No title, no time, no participant list — each of those is the event's, read through a join, and a
second copy would be a second answer to the same question. What the meeting row adds is the three
facts the event cannot supply: that somebody started it, when the first person actually arrived, and
when it ended.

`started_at` is set by the **first join**, never by the creation. A host who opens a room and is then
called away leaves a record saying exactly that.

## The medium is chosen at Start and never changed

`meeting.medium` is `video` or `audio` (`MEETING_MEDIA`), set by `createMeeting` and written by no
other statement in this package — there is deliberately no update path for it. An audio call is a
kind of meeting rather than a second subsystem: same record, same room, same screen, and what differs
is what may be published into it.

**It cannot change afterwards because the people already in the room agreed to one thing.** A medium
that could be widened mid-gathering would be a camera switched on for everybody by somebody else's
click; a second meeting on the same event is what "let us switch to video" actually means, and one
meeting per event is what makes that a deliberate act rather than a toggle. The create path is
find-or-return, so a second Start that asks for a different medium gets the EXISTING meeting
unchanged — the first Start decides, and `created: false` is what says so. The room enforces the
other half (a picture published into a call is refused there, not here): this package holds no
socket.

## Attendance is a row per stay, and the roster is derived from it

Somebody whose connection drops and who dials back in was in the room twice; a flag per person would
say they were present through a gap they were absent for. So who is in the room right now is "the
rows whose `left_at` is null" — counted on every read rather than kept as a column, because a stored
count is a second answer the rows already give, and the two disagree the first time a socket closes
without a leave. `MAX_MEETING_PARTICIPANTS` — **300** — is measured against exactly that count.

The number is a product decision rather than a limit of the routing layer, and it moved from twelve
to three hundred once the two ends could carry a room that size: each browser pulls video only for
the tiles it shows and audio only for the people talking, cameras publish three simulcast layers, and
the signaling room sends what changed rather than the whole roster. None of that is this package's —
it is the Worker's room and the browser's client — but the ceiling this package holds is what those
three make honest, so a change to it belongs with a change to them.

A join by somebody who already has an **open** stay returns that stay rather than opening a second
one, so a reconnecting browser occupies one seat and a leave has one row to close.

**Every read here is a round trip ahead of its write, and the database holds what the read cannot.**
Both rules that a read-then-write cannot span are in the schema, and both are partial on the open
stay because the closed ones are the record: a unique index on `(meeting_id, user_id) WHERE left_at
IS NULL`, and the ceiling as the attendance insert's own `WHERE`, marked `guarded()` so a batch past
it rolls back whole rather than seating somebody past the ceiling. The service's own count still runs, and
still produces the REASON a member reads — it just no longer produces the limit. The route maps the
guard label (`JOIN_CAPACITY_GUARD`) and the two constraint predicates
(`isOpenStayConflict`, `isMeetingPerEventConflict`) onto the answers the member wanted, which is the
open stay, the full room, and the winner's room.

**A stay can also be closed by nobody.** `closeAttendanceAfterSocketLoss` is the room's sweep, not a
member's act: addressed to the STAY rather than to the meeting-and-member pair, refusing nothing, and
carrying no visibility predicate — the room is closing its own record rather than answering a reader.
It writes the same `meetings.meeting.left` event with `reason` from `MEETING_DEPARTURE_REASONS`, so
how a gathering emptied is one read rather than two event names meaning nearly the same thing.

## The three lists are three orderings, not three filters

`listMeetings` takes a `MeetingListScope` and each scope brings its own sort key: live by how long
somebody has been in the room, upcoming by when it starts (soonest first — a page of the FIRST ten is
the answer and the last ten is not), recent by when it ended. One ordering would make two of the
three pages wrong. The keyset is over the sort key the query itself returns, so a cursor is the same
opaque pair whichever scope minted it.

**The upcoming scope takes the caller's day as an argument and will not derive one.** A civil date is
a day in a place; this package reads no clock and the Worker has no zone to read one out of an
instant with. `since` on the recent scope is an INSTANT and is the caller's to compute, because two
instants compare the same everywhere. Standard: [`docs/conventions/dates.md`](../../docs/conventions/dates.md).

## What the audit log carries, and what it never could

Identifiers and instants. There is nothing else: the meeting stores no title, no roster copy, and
above all nothing anybody said — audio, video and screen share are routed between browsers and never
reach this platform's storage at all. That is a property of the architecture rather than a rule this
package enforces, which is why nothing here has a redaction step.

## Not built here, and where each one lands

- **Signaling and the routing credentials.** The room Durable Object and the client that talks to the
  routing service are the Worker's (`apps/api-worker/src/meetings/`). Nothing in this package knows
  whether meetings are configured at all — that is a fact about bindings, so the route carries it
  beside a summary rather than inside one.
- **External guests.** A participant is a firm member with a session. A signed one-time join link for
  a client or opposing counsel is the rung after this one.
- **Recording.** Server-side media processing and a consent gate on the jurisdiction profile, neither
  of which is basic. Nothing here is shaped around it.
