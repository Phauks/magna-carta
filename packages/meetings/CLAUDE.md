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
- **The recording's audio and its sink.** The recorder, the socket the routing service dials and the
  announcement are the Worker's (`apps/api-worker/src/meetings/`); this package holds the recording's
  RECORD and the arithmetic over a frame — see the section on recording below.

## Authority over a meeting is a grant on the meeting, not a capability of a seat

`hosting-types.ts` / `hosting-statements.ts` / `hosting-service.ts` are the hosting concern's trio.
`meetings:host` is what a firm hands the people who may convene meetings; it cannot answer "is this
member running THIS room", because that changes during the meeting — hosting is handed over,
co-hosts are named and withdrawn, and the member who opened the room may have been called away an
hour ago. So `meeting_host` holds the answer, and `requireHostGrant` is **the one authority
chokepoint**: every host act composes it ahead of itself and reads back the caller's role, so a
sixth act cannot be added without it.

Four rules travel with it.

**A grant is a row with an interval, closed and never deleted.** A `host_user_id` column would
answer the live question and only the live question: co-hosts are several, and a column overwritten
on hand-over erases who was running the room before it. `meeting.created_by_user_id` stays what it
is — who opened the room — and is deliberately not read as the host; the two are the same person
only until the first hand-over.

**The invariants are in the database.** Every path here is a read-then-write and is blind to the
instant it does not span, so the two partial unique indexes (one live host per meeting, one live
grant per member) are what settle two hand-overs racing. The loser's whole batch rolls back — the
one-meeting-per-event precedent — and the route answers with the conflict rather than an Error ID.

**Hosting never passes by itself.** A host whose tunnel drops has not stopped hosting, and a room
reassigned on a socket loss would hand a client meeting to whoever was next in the roster. What
replaces it is `claimHosting`, refused while any OTHER grant-holder has an open stay, refused
(`meeting-not-joined`) to a claimer who holds no open stay of their own, and audited as a claim,
because nobody gave it. That second refusal is what keeps the claim an act of the MEETING rather
than of the permission key: nobody hands this grant over, so being in the room — or at its door — is
the whole of what makes taking it legitimate, and without it any key-holder who could see the event
could take a live meeting a minute after the host's tunnel dropped. **Ending a meeting is a host act for the same reason** — on the key
alone, any key-holder could close any meeting they could see the event for, without being in it.

**What is written here and what is a frame.** Removing somebody, shutting the door and changing who
is hosting are written through this package, because somebody could later ask who did them. Muting,
asking somebody to unmute and spotlighting are frames the room handles
(`apps/api-worker/src/meetings/room/room-hosting.ts`) and reach nothing in this package: they are
about this moment, and an audit row for each would fill a matter's log with the mechanics of a
conversation. A removal writes TWO audit rows — the same `meetings.meeting.left` every departure
writes, labelled `removed`, and `meetings.meeting.removed` beside it carrying the host who acted,
because the departure row's actor is the member whose presence it records.

## The door is a per-meeting fact, and it split "in the room" from "has an open stay"

`lobby-types.ts` / `lobby-statements.ts` / `lobby-service.ts` are the waiting room's trio. `meeting.lobby`
is `'off' | 'on'`, chosen at Start beside the medium and — unlike the medium — changeable by a host,
because a medium is what the people already in the room agreed to and a lobby is a standing decision
about who may come in. One lobby per MEETING and never one per firm: a firm holds several at once.

**A waiting arrival is a stay from the moment it reaches the door.** `meeting_attendance.waiting_from`
and `admitted_at` are columns on the existing row rather than a second table, for three reasons: the
socket upgrade's ticket is an open stay and a waiter needs a socket, the signaling room's storage is
transient and is deleted when the last socket closes, and the record has to be able to say who waited
and was never let in. `joined_at` therefore means "when this stay began", at the door or in the room.

Four rules travel with it.

**One predicate, one home.** `IN_THE_ROOM_PREDICATE` and `WAITING_PREDICATE` in
`meeting-statements.ts` are single exported SQL fragments, composed by the live count, the capacity
guard, the roster and the lobby list — so the four cannot drift into disagreeing about who is present.
They live there rather than in the lobby trio because the lobby did not invent them; it only made them
two different sentences.

**The capacity guard moved to ADMISSION.** `MAX_MEETING_PARTICIPANTS` counts stays that are in the
room, so the door insert cannot be what holds it. `admitAttendanceUnderCapStatement` carries the count
in its own `WHERE` and is `guarded()`; the door has its own much smaller ceiling, `MAX_MEETING_LOBBY`,
refused as `meeting-lobby-full`. A batch that half-lands is decided the way the join path is decided:
the service's own count produces the REASON per person (`room-full`, seats spent down the list in the
order the host sent it) and the guard produces the limit.

**Whoever may run this room does not wait, and a grant admits.** The join path asks for a live GRANT
rather than the permission key — a key-holder walking past the door of a confidential matter
discussion is what a host turns the lobby on to prevent. And a grant written for a member whose stay
is waiting admits that stay in the same batch (`admitWaitingStay` in `hosting-service.ts`), which is
what dissolves the lobby's one deadlock: a lobby-on meeting whose host has gone. That one admission
deliberately carries no capacity count, because refusing the claimer for a full room would restore the
deadlock the claim exists to end.

**The door is enforced in the STATEMENT, and an admission deliberately ignores it.** Two rules that
look like one and are not. The join path reads the lock and the lobby a round trip before it writes,
which settles the ordinary case and produces the reason a member is shown; it cannot settle the case
it was not there for, so both conditions are predicates on the insert itself
(`DOOR_ADMITS_DIRECTLY_PREDICATE` and, inverted, `DOOR_QUEUES_PREDICATE` in `meeting-statements.ts`)
and the guarded write rolls the whole batch back. That window is exactly the moment the control is
being used — a host shuts a door because of who is about to arrive.

**A LOCKED ROOM DOES NOT REFUSE AN ADMISSION**, and that is decided rather than missed. The lock is
what the room answers an ARRIVAL with; an admission is a host looking at a named person and deciding
that this one comes in. Refusing it would mean a host who shut the door could no longer let in the
colleague they shut it for, and the remedy would be unlocking the room for everybody standing outside
in order to admit one of them. The capacity ceiling still binds, because that is a fact about the room
rather than a decision about a person.

**A hand-over leaves the outgoing host a co-host**, written in the same batch as the revocation, so
there is no instant in which they hold nothing. Handing the room over is not leaving it. Its twin:
**a grant is resignable by the person holding it** — `revokeHosting` naming the caller is a
resignation with its own audit event, refused only for the sole grant-holder, because a host
resigning out of a room where nobody else holds anything leaves a running meeting with nobody running
it. And **only a live HOST grant whose holder is in the room refuses a claim**
(`countOtherHostsPresent`): counting co-hosts meant two of them in an abandoned room each saw the
other and neither could take it.

**Barred entry is one rule with two labels.** `readBarredStay` finds a stay closed `removed` or
`denied`; both bar the member for the life of the meeting, and only the sentence differs. A denial
that did not bar would be a button that does nothing.

## The chat is the one thing here that stores content — and it changes the paragraph above

`chat-types.ts` / `chat-validation.ts` / `chat-statements.ts` / `chat-service.ts` hold in-meeting
chat, kept on the record by the owner's ruling of 2026-09-20. The section on what the audit log
carries still stands word for word — identifiers and instants, never the body, on either the sending
or the removal — but "the meeting stores nothing anybody said" is now true of the media and not of
`meeting_message`: a chat message carries a filed message's retention, its personal-data
classification, and a redaction step this package did not have.

Three rules travel with it. A message hangs from the **stay**, so being in the room is the whole of
the permission to post (`readOpenAttendance`, the same row the socket upgrade demands) and the member
is resolved through the stay rather than copied beside it. The stay is named **by value** —
`participant_kind` plus `participant_id`, no foreign key — because a member's stay is a
`meeting_attendance` row and a guest's is a `meeting_guest_stay` row; `postMeetingMessage` writes
the literal `'member'` and `postGuestMeetingMessage` the literal `'guest'`, each from its own open,
in-the-room stay. A guest's line has no member behind it, so only a host may take it back — that
falls out of the author comparison rather than needing a branch, and there is deliberately no guest
redaction act. And **removal is a redaction, never a delete**:
the body is blanked and the row stays, guarded so the batch rolls back whole, and a second removal
produces no statements rather than moving an instant somebody's record already carries.

## Polls and the question queue are content on chat's terms, and a poll's anonymity is two tables

`poll-types.ts` / `poll-validation.ts` / `poll-statements.ts` / `poll-service.ts` and the same four
for `question-*` hold the meeting's second and third stored content. Everything the chat section says
about the audit log, the stay-by-value and the redaction holds for a question word for word; what is
new travels in four rules.

**Anonymity is held by the rows, not by a read filter.** `meeting_poll_answer` holds WHAT was chosen
and, on a poll that shows no names, a participant pair of literal NULLs written by
`insertAnonymousAnswerStatement`, which has no argument that could carry a stay.
`meeting_poll_respondent` holds THAT a stay answered, and is the one home of WHEN — the answer row has
no instant, because one would re-link it to the respondent row written beside it. The tally counts
answers; the guard is the respondent row. No audit row carries the question, a label or which option
was chosen, on either kind of poll.

**One participation per MEMBER.** The unique indexes hold one per stay; the respondent and upvote
inserts also carry, in their own guarded `WHERE`, that none of this member's stays in the meeting has
already answered or upvoted — otherwise leaving and rejoining is a second vote.

**An answer names its option as a pair.** `(poll_id, option_id)` references the option table's own
unique `(poll_id, id)`, so an answer to another poll's option fails at the foreign key whoever writes
it; `assertAnswerChoices` gives the member the reason first. **`max_choices` is held by that
validator and the one-respondent guard, never by the database**: on an anonymous poll the answer
rows carry no participant, so no CHECK or index can count one person's rows — the respondent row is
written once per participation and the validator bounds what that one participation may contain.

**The idempotency record is a third table, and it is held to the same split.** The answer route
(`apps/api-worker/src/routes/meeting-polls.ts`) stores the poll's handle and nothing else as the
replayable body, and its fingerprint is over the path alone: a digest of a body that is one of ten
choices is the choice, and two consecutive tallies differ by exactly it.

**Two rules on the queue that look like small choices.** An upvote on a question that has been taken
back is refused (`meeting-question-redacted`) — withdrawing one is not, so a signal can always be
cleared. And a withdrawal's audit row names the stay the upvote was CAST from, which is the stay the
`upvoted` row beside it names, not whichever stay the member holds when they take it back. `since`
without `sinceId` on the queue is inclusive (`asked_at >= ?`) and the caller drops ids it holds.

**Every host act asks the grant.** Opening, closing, reading who answered what, marking a question
answered — and the host half of taking a question back — go through `requireHostGrant` or
`readLiveHostGrant`, never the permission key. Answering, asking and upvoting need an open stay
(`readOpenAttendance`), as posting a message does. The participant CHECKs on all four participant
tables accept `attendee` beside `member` and `guest` (`MEETING_CONTRIBUTOR_KINDS`), and polls and
questions carry a nullable `breakout_id`; nothing here writes either yet.

## A guest is a second kind of stay, and every read of who was present sees both

`guest-types.ts` / `guest-statements.ts` / `guest-service.ts` are the guest concern's trio, and
`guest-removal.ts` holds the two pieces the member-side host acts reach (`isGuestStayHandle` and
`removalOfGuestStatements`) so that `hosting-service.ts`, `lobby-service.ts` and `meeting-service.ts`
never import the guest service, which itself composes `requireHostGrant`. A guest is somebody from
outside the firm on a signed link: a `meeting_guest_invitation` row per Directory entity per meeting
(the link, holding only the SHA-256 of its secret), and a `meeting_guest_stay` row per stay.

Four rules travel with it.

**Presence is unioned, and the union has one home.** `MEETING_STAY_TABLES` in
`meeting-statements.ts` names both stay tables, and `inTheRoomCount` / `waitingCount` compose the
in-the-room and waiting predicates over both. The live count, the room's ceiling, the door's ceiling,
the roster read, the lobby list and ending a meeting all go through them, so a guest counts against
`MAX_MEETING_PARTICIPANTS` and `MAX_MEETING_LOBBY` exactly as a member does. A fitness test in
`test/guests.test.ts` enumerates every table carrying the stay columns and fails when one is not in
the list — a third kind of stay would otherwise be invisible to every count.

**The link proves possession of a mailbox and nothing more.** A guest always waits at the door, the
lobby setting notwithstanding; what the host reads there is the name typed at the door beside the
Directory name the link was minted for, which is what catches a forwarded link. The secret, the token
and the address are never written anywhere this package reaches — the audit rows carry identifiers
and instants, with a null actor for the guest's own acts.

**The row is the authority for a link.** `guestCredentialRefusal` decides a signed credential against
the invitation and the meeting — withdrawn, a stale secret version, a secret that does not hash to
the row's, expired, or the meeting ended — and `recordGuestArrivalStatement` carries every condition
that makes a link spendable in its own `WHERE`, guarded, so a withdrawal or a rotation racing an
arrival rolls the arrival back rather than seating somebody on a dead link.

**Minting again replaces; it never adds.** The unique index on `(meeting_id, entity_id)` holds one
invitation per person per meeting, and a second mint rotates that row's secret (reinstating it when
it was withdrawn). Rotation refuses a withdrawn link, so reinstating is always the deliberate act of
inviting again. A removal or a denial bars the link for the life of the meeting, as it bars a member.
A reissue — rotation or mint — starts `arrival_count` again, because the count bounds a LINK and the
old one stops working in the same statement; carried forward, a guest whose connection failed twenty
times would be sent a fresh link that arrived already used up.

**An act on the LINK never closes a stay `removed`.** `removed` and `denied` are the two departure
labels that bar re-entry, and each is a decision about a person. Withdrawing a link, and replacing
it, close any stay open on it `left` in the same batch, with `cause` (`link-withdrawn`,
`link-replaced`) on the `meetings.guest.left` row and the stay's handle on the host's own row — so
inviting the entity again brings them back instead of telling them they were removed.

**An admission is never inherited.** An arrival on a stay that is already open returns THAT stay —
the partial unique index holds one per link — but puts it back at the door under the name just
typed (`returnGuestStayToTheDoorStatement`), because whoever pressed Join this time is not known to
be whoever a host let in. A stay that was already waiting keeps its place; one that had been
admitted starts a new wait and counts against the door's ceiling. The name the stay carried before,
and who admitted it, are on the arrival's audit row, which is the one place the old name survives.
The Worker tells the room after the commit (`guestCredentialReplaced`), which drops the old roster
or door entry and supersedes the old socket.

**The entity must still be on the event.** A link whose entity has been taken off the meeting's
event is refused as withdrawn at the summary read and at the arrival — the host who took them off
may never have opened the Guests panel — and the refused arrival carries its own audit row
(`meetings.guest.arrivalRefused`) on `GuestNoLongerOnTheEventError`, which the route commits before
answering. The summary writes nothing, because opening the link is a read.

## A recording is a record of what it captured and who was told

`recording-types.ts` / `recording-statements.ts` / `recording-service.ts` are the recording's trio,
`settings.ts` holds its four firm switches (all default off — recording, captions, summaries — and the
track ceiling), and `pcm-frame.ts` is the hand-written reader of the routing service's three-field
envelope plus the mono fold, the silence and the sequence-gap arithmetic. `pcm-mix.ts` is the compose
step's mixer — tracks at their own offsets, summed in 32 bits and clamped ONCE, a window at a time so
memory never grows with the recording — and `wav.ts` the 44-byte canonical header for mono 48 kHz
16-bit, written at the head of the first part because the length is known before mixing begins. The design is
[`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../../docs/specs/2026-09-20-meetings-recording-and-transcription-design.md).

Seven rules travel with it.

**The consent record is what the server delivered, not what a browser rendered.** The owner's ruling
made the announcement the consent mechanism, so `meeting_recording_notice` holds a row per stay per
fan-out — `start`, `arrival`, `stop` — written by the ROOM from the sockets it actually handed the
frame to (`recordingNoticeEffect`, one batch and ONE audit row with the count). This package re-reads
no stay for it: the room is the only witness to a delivery. A reconnect is another arrival and another
row. The start route checks the room's answer before anything is captured: fewer notices than
recipients is somebody told with no record of it, and the start fails rather than recording.

**Every stay is named by kind and by value**, on chat's precedent: `participant_kind` (`member`,
`guest`, `attendee`), `participant_id` with no foreign key, and a nullable `user_id`, on both the track
and the notice. A guest is on the consent record, and has a track, exactly as a member does.

**The recording's vocabularies are whole from the first migration.** `meeting_recording` is a parent
table, so every state (`recording`, `composing`, `filed`, `failed`, `abandoned`) and every stop reason
the later slices write is in its CHECK now; and running means not stopped, in both directions, held by
`meeting_recording_stopped_shape_check`. One recording runs per room, held by a partial unique index on
the main room (`breakout_id IS NULL`); `isRunningRecordingConflict` lets the route answer the loser of a
race as `meeting-recording-already-running`.

**Who may.** Starting is `meetings:record` (the route's chokepoint) AND a live grant on this meeting
(the service asks it, `meeting-not-host`): the key says the firm lets this member create a recording at
all, the grant says they are running THIS room. It refuses a firm event (no matter to file into), an
ended meeting, a running recording and a room past the ceiling. Stopping is the key — labelled `member`
— or a live grant on this meeting — labelled `host`; the route passes `mayRecord` and the service asks
the grant. Every ending of a meeting stops its recording in the same batch: the host's end
(`stopRecordingForMeetingEnd`) and a cancelled event's closing (`endScheduledMeetingForCancelledEvent`),
both `meeting-ended`. A track is never dropped from the record: one past the ceiling, or whose
socket never came back, is a `lost` row, and a lost track stays lost through every later settle.

**A failure is recorded once, and a start that failed says so.** A start the room or the recorder
could not carry out stops as `start-failed` (`stopRecordingAfterStartFailure`), never `sink-lost` —
one is a recording that never began, the other a meeting whose audio went away. Two parts of the
Worker can give up on one recording, and `failRecordingStatement` lets only the first move it to
`failed`; `recordingFailedAuditStatement` is written only when the row carries ITS Error ID afterwards,
so the log says it failed once. A stop the recorder never acknowledged leaves the state alone and puts
the Error ID on the `composing` row (`recordRecorderUnreachableStatement`); the recorder settles itself
later, and an Error ID on a row that is not `failed` names a fault on the way, never the outcome.

**Composing and filing are the platform's acts on its own record, and every one is guarded.** The
compose cursor is five columns on `meeting_recording` (`compose_*`): the begin is guarded on no upload
session yet and commits with the session, the advance on the cursor it started from (two deliveries of
one message never both advance it), the filing on `composing`, and the sweep's abandonment on
`recording` — each with its own exported guard label so a caller tells "somebody got there first" from a
fault. A sixth column, `compose_claimed_at`, is the window's CLAIM (`claimComposeWindowEffect`,
`COMPOSE_CLAIM_GUARD`): a lease stamped on the cursor it read, released by the window's own progress, so
two consumers never compose one window; progress also resets `compose_attempts`, and a stall is measured
from the latest of the stop, the claim and the progress. `failComposeEffect` is guarded too
(`FAIL_COMPOSE_GUARD`), because the Worker commits the upload session's abort beside it and a failure that
lost the race to a filing must not abandon a filed document's version. `filed` brings `captured_seconds`
down to the composite's own length, never up. Staging keys are cleared in statements of at most
`STAGING_KEYS_PER_STATEMENT` handles, because a Durable Object's SQLite binds at most a hundred.

**A staged track lands stretch by stretch.** `meeting_recording_track.segments` (JSON of
`MeetingRecordingTrackSegment[]`) names, for each stretch of the staged object, the staged sample it
begins at, the instant it was heard, and — for a stretch a departure closed with padding — where its
audio ends; `placeTrackSegments` in `recording-types.ts` is the one placement both the recorder (what was
captured) and the compose (where it lands) use. A null column is one stretch from `first_frame_at`.

**The WAV-length policy is decided** (`WAV_SIGNED_READER_MAXIMUM_DATA_BYTES` in `wav.ts`): a recording
past the signed 32-bit boundary (about 6.2 hours) is still ONE canonical WAV, whole, never capped or
split; only past the unsigned limit is a composite refused. `abandoned` is the sweep's state for a recording whose recorder is gone: open tracks are `lost`,
nothing is composed. The filed, abandoned and failed audit rows carry handles and counts only — never the
document's name, which is the event's title. The ceiling at the start counts STAYS, as the recorder does.

**Its refusals are a vocabulary of their own** (`MeetingRecordingRefusedError` in `validation.ts`), on
the poll's precedent, so the room's one switch over `MeetingValidationCode` is not widened by codes only
the recording routes raise. Reaching the meeting at all still raises `meeting-unknown-event`.

## A transcript is content, made per track, and it settles the staging

`transcript-types.ts` / `transcript-statements.ts` / `transcript-service.ts` are the transcript's trio, and
four pure modules do its arithmetic: `speech-spans.ts` (where somebody is talking, from a track's own
energy against its own noise floor, with a pre-roll and a hangover, cut into thirty-second pieces at a
pause), `resample.ts` (48 kHz to the speech model's 16 kHz behind a windowed-sinc anti-alias filter),
`transcript-assembly.ts` (a piece's lines placed on the recording's timeline, the gap lines, the reading
order, the prompt tail) and `webvtt.ts` (the filed document, with every piece of somebody else's text made
safe for where it goes). The Worker's `transcript-consumer.ts` drives them; the design and its amendments
(A34 onward) are in the recording spec.

Seven rules travel with it.

**The words are CONTENT, and the second store of it this package holds after chat.**
`meeting_transcript_segment.text` is what was said in a privileged conversation, attributed. No statement
here logs it, no audit row carries it (`meetings.transcript.ready` and `.failed` are handles and counts),
and the header row `meeting_transcript` holds none — it is in `NO_PII_TABLES`, the segment's text and stay
are in `PII_TABLES`.

**The speaker is the TRACK, by value.** A line names the stay its track was (`participant_kind`,
`participant_id`), the member behind it (`user_id`, null for a guest) and the track itself; the name is read
off the stay when the transcript is read or filed (the member's display name, or the name a guest typed at
the door), never stored. A diarizing model's "speaker 0" is not a person a record can name.

**A pending transcript's lines are not in order, and nothing reads them.** Each line is written with a
NEGATIVE provisional ordinal in the order it was written, because one track is transcribed before the next
and a line's place among the others is known only at the end. `assembleTranscriptStatements` writes the gaps,
renumbers every line chronologically (start, end, handle — `compareLines`) in ONE `UPDATE … FROM` over a
window function, and records the filing's session, in one guarded batch; negative and final ordinals never
collide, so the unique index never refuses a line on its way to its place. `listTranscriptSegments` reads
only ordinals from zero up.

**Every act that can lose a race is guarded, with its own label**: the claim (on the cursor and an expired
or absent lease), each piece's progress (on the claim and the cursor it moved from — two consumers never
write one piece), a model's refusal counted (on the claim), the filing's begin (on no session yet and
the claim), `ready` and `failed` (both on `pending`). The audit row beside `failed` is written only by the failure the record keeps, because the
guarded write rolls the whole batch back.

**The staging is the transcript's until it settles — and a failure keeps it when a retry could still
use it.** A filed recording keeps its staged tracks because the transcript reads them;
`listExpiredStagingTracks` releases a filed recording's staging a grace after its transcript became
`ready`, and only after the seven-day unsettled retention once it `failed` (a model that stayed down,
or a stall, leaves the only per-speaker copy where a retry can read it; a refusal no retry can change
released it at once). `hasRecordingsToTend` counts a pending transcript, so the sweep sees one that
stopped moving. `failTranscriptStatement` is guarded on the upload session the failure READ, so a
filing begun in between refuses the failure rather than being left open, and the sweep's on the claim
and progress it judged stalled.

**The read follows the filed document, and is audited.** The segment rows are a second copy of the
WebVTT document's words. The route serves them only while the transcript's filed version exists, is not
in the trash and is not held by the scan (`transcriptLinesWithheldBy` over `recording-document-state.ts`'s
reading of that version, gated on the file's own matter); otherwise it answers the header with
`linesWithheld` and no lines. Every page of lines served writes one `meetings.transcript.read` row
(`transcriptReadAuditStatement`) — identifiers and counts, never a word. **Nothing deletes the segments
yet when the document is purged**, and that is a known gap rather than an oversight: the file manager has
no purge or deletion hook a subsystem can join — a delete is soft and destroys only the working copy, and
`purgeableVersionObjects` is called by nothing until the retention-policy engine is built. Until then the
gate above keeps a trashed or purged document's words off the read; the engine, when built, must delete a
purged transcript version's segments in the same act. A row added that reads the words anywhere else
is a second door past this gate.

**No transcript text reaches a sink, and a scan holds it.** `test/no-transcript-text-escape.test.ts`
(`@repo-wide-fitness`) finds every first-party module that reaches the words — by what it imports or
names — and fails when one hands the words, a speaker's name, the model's prompt or the document's name
to the failure pipeline, a logger, an audit builder, an Error or a problem body. It reads names, so a
value laundered through a variable named for nothing stays a review question; a new sink belongs in its
`SINKS` list.
