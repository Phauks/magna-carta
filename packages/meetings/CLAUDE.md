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
- `src/meeting-service.ts` — create, join, leave, end; each one batch with its audit rows

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

## Attendance is a row per stay, and the roster is derived from it

Somebody whose connection drops and who dials back in was in the room twice; a flag per person would
say they were present through a gap they were absent for. So who is in the room right now is "the
rows whose `left_at` is null" — counted on every read rather than kept as a column, because a stored
count is a second answer the rows already give, and the two disagree the first time a socket closes
without a leave. `MAX_MEETING_PARTICIPANTS` is measured against exactly that count.

A join by somebody who already has an **open** stay returns that stay rather than opening a second
one, so a reconnecting browser occupies one seat and a leave has one row to close.

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
