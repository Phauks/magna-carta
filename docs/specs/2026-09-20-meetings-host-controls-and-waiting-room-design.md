# Meetings — host controls and the waiting room, design

**Status:** accepted for the two slices that follow large rooms, 2026-09-20.
**Parent design:** [`docs/specs/2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — the meeting record, the signaling room, the routes, the screen and the large-room work this builds on. Nothing restated here.
**Ledger:** [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md) — `meetings.host-controls` and `meetings.waiting-room`.
**Owner ruling (2026-09-20):** a firm runs several meetings at once, so every per-meeting surface is one per meeting and never one per firm. The lobby belongs to the room.

## 1. What these two slices are, and why in this order

A meeting today has exactly one host act — End — and it is available to anybody in the firm holding `meetings:host`, whether or not they are in the room and whether or not they opened it. That was right for a twelve-person room started by the person who needed it. It is not right for three hundred: a room that size has somebody running it, and running it means muting a line that is carrying a building site, taking out somebody who should not be there, closing the door once everyone has arrived, and putting one person on every screen. None of those exist.

**Host controls first, the lobby second, and the order is forced rather than chosen:** admitting somebody is a host act, so the lobby has nothing to hang from until "who is a host" has an answer that is a fact on a record rather than a permission key held by half the firm.

The two slices share one idea. **Authority over a meeting is a grant on the meeting, not a capability of a seat.** The permission key says who may be named a host; the grant says who is hosting this room. Everything below follows from that split.

## 2. Who is a host

`meetings:host` is what a firm hands to the people who may convene meetings, and the seed migration put it on Owner, Admin, Attorney and Paralegal. It answers "may this member open a room". It cannot answer "is this member running THIS room", because the answer changes during the meeting: hosting is handed over, co-hosts are named and withdrawn, and the person who opened the room may have been called away an hour ago. A key that is granted once and read everywhere has no way to say any of that.

So the meeting record carries the answer, in a new `meeting_host` table.

**The starter is the host.** `createMeeting` writes the meeting row and a `host` grant for the member who pressed Start, in the same batch. `meeting.created_by_user_id` stays exactly what it is — who opened the room, a fact that never changes — and is deliberately not read as the host: the two are the same person only until the first hand-over, and a record that conflated them would answer "who was running the meeting when she was removed" with the name of somebody who had left.

**Co-hosts are named on the record, in the same table, under `role: 'co-host'.`** A co-host is a fact about one meeting, not a standing rank in the firm, which is why it is a row under a meeting rather than anything in access control. A co-host holds every act below except acting on the host.

**A table rather than a column, and this is the decision worth defending.** A `host_user_id` column on `meeting` would be smaller and would answer the live question. It would answer only the live question: co-hosts are several, so they need rows regardless, and a column overwritten on hand-over erases who was running the room before it. The question a firm actually asks of a meeting record months later is "who was hosting when that happened", which is a question about an interval. So a grant is a row with `granted_at` and `revoked_at` — never deleted, closed — on the same principle that makes attendance a row per stay rather than a flag per person. Handing over is one batch: revoke the outgoing grant, write the incoming one.

**Hosting does not pass on its own when the host leaves.** Two reasons, and the second is the stronger. A host whose tunnel drops for ninety seconds has not stopped hosting, and a rule that reassigned the room on a socket loss would hand a client meeting to whoever happened to be next in the roster while the partner's laptop woke up. And a host assigned by nobody is a host nobody chose: every act below is attributed to a person, and the first act of an auto-promoted host would be attributed to somebody who never asked for the room.

**What replaces it is a claim.** A member holding `meetings:host` may claim hosting of a meeting when no live grant belongs to somebody with an open stay — that is, when the room has nobody running it. It is the same route that hands hosting over, addressed to oneself, and it is refused the moment a host is present. It is audited as a claim rather than as a hand-over, because nobody gave it. This is what keeps a room recoverable when a host's machine dies without making the room reassign itself, and it is also what dissolves the lobby's one deadlock (section 10).

**Ending a meeting becomes a host act.** Today `POST /api/v1/meetings/{meetingId}/end` is gated on the key alone, so any Attorney in the firm may close any meeting they can see the event for, from anywhere, without being in it. That is a hole the key was never meant to cover; it survived because End was the only host act and the starter was the only realistic caller. It now requires the grant like every other act here, and the ordinary case is unchanged because the starter holds one. A key-holder who needs to close an abandoned room claims it first, which leaves a record of exactly that.

## 3. The acts, and which are routes and which are frames

| Act                                                                  | Shape                   | Who                          |
| -------------------------------------------------------------------- | ----------------------- | ---------------------------- |
| Mute one participant                                                 | frame `mute`            | host, co-host                |
| Mute everyone else                                                   | frame `mute-all`        | host, co-host                |
| Ask somebody to unmute                                               | frame `ask-to-unmute`   | host, co-host                |
| Spotlight one participant for the room                               | frame `spotlight`       | host, co-host                |
| Remove a participant                                                 | route, audited          | host, co-host                |
| Lock and unlock the room                                             | route, audited          | host, co-host                |
| Hand hosting over, name or withdraw a co-host, claim a hostless room | route, audited          | host (claim: any key-holder) |
| End the meeting                                                      | route, audited (exists) | host, co-host                |

**The rule that decides the column: an act is a route with an audit row when somebody could later ask who did it.** A member was put out of a meeting that is on a matter's record; arrivals were refused at a door somebody closed; the room changed hands. Each of those is a fact about what happened, it outlives the room, and the only honest answer to "who did that" is a row written through the firm-scoped data-access layer at the moment it happened.

**An act is a frame when it is about this moment and leaves nothing behind.** A mute is undone by the member themselves a second later; a spotlight dies with the room; a request to unmute is a tap on the shoulder. Writing an audit row for each would fill a matter's audit log with the mechanics of a conversation, which is the one thing the meetings subsystem has been careful not to record. It would also put a round trip and the idempotency gate between a host pressing Mute and the microphone going quiet, for an act whose whole value is that it is instant.

A frame is not anonymous for being unaudited. Every directive frame carries the participant handle of the host who sent it, so the person muted sees who muted them and the room sees who put whose face on every screen. What no frame and no audit row carries anywhere is content: these are identifiers and instants, like everything else this subsystem writes.

If a firm later needs muting on the record, the room already has the path — it writes through the firm-scoped data-access layer for the socket-loss sweep — and it is one statement, not a redesign. It is deliberately not built now.

### The acts in detail

**Mute one participant.** The room cannot silence a microphone: the media never crosses it. So a mute is two halves, and both are needed. The room closes that participant's audio track at the routing service, which stops the sound reaching anybody whatever their browser does, and sends them a `muted { by, at }` frame so their screen says what happened and by whom. The close is the existing `tracks/close` path; the routing service's answer carries a session description, which goes to the target as the ordinary `closed` frame their client already applies. The track leaves the roster the way any stopped track does, so nobody re-subscribes to silence.

Un-muting afterwards is the member's own act and it republishes the microphone rather than flipping `track.enabled`, because the track is genuinely gone. That is more client work than a local flag and it is the point: **a mute that only asks the browser nicely is not a mute**, and the room refuses a camera in an audio call on exactly this reasoning.

**Mute everyone else.** The same act over every participant who is neither the caller nor a host or co-host. Hosts are left alone because a host muting the room is clearing the floor in order to speak, and a control that silences the person pressing it is a control that does not work; co-hosts are left alone because they are running the meeting with the host. The room answers the caller immediately and performs the closes with bounded concurrency (`MUTE_ALL_CONCURRENCY = 8`) — three hundred serial calls to the routing service inside one frame handler is exactly the hot-path work golden rule 10 forbids — recording a failure on any one of them through the standard pipeline and carrying on. One roster broadcast at the end, never one per person.

**Ask to unmute — a request, and never a forced unmute.** This is the one act the design refuses to build the obvious version of. A platform that can open a member's microphone from another member's click is a listening device in a law firm. The member may be in a room with a client, on a call they muted themselves for precisely so that the next two minutes were not in the meeting; a microphone opened for them would put a privileged conversation on the wire with nothing in front of them to say it had happened, and the browser's own indicator is not a consent mechanism. So the frame reaches the target as `unmute-requested { by, at }`, their screen offers Unmute and Stay muted, and nothing happens until they choose. The host sees no acknowledgement, because there is nothing to acknowledge: they asked.

**Remove a participant.** The stay closes with `ended_reason = 'removed'`, audited as `meetings.meeting.removed` with the actor, the target's stay and the instant. The room then drops them from the roster, closes their media at the routing service, and refuses their socket with the fatal reason `removed` followed by a 4000 close — the reason first, always, so the browser learns why rather than inferring it from a code. **They cannot rejoin while the meeting runs:** the join path refuses a member who holds a stay on this meeting closed as `removed`. It is the meeting they are barred from and not the event — a new meeting on the same event is a new room, and a host who wants them back starts one.

A co-host may not remove the host, and nobody removes themselves through this control: leaving is how a person leaves.

**Lock the room.** `meeting.locked_at` and `meeting.locked_by_user_id`, the nullable pair shaped exactly like `ended_at`/`ended_by_user_id` and constrained together by a CHECK, because half of that pair is a record nobody can question. A locked room refuses arrivals at the join route with `meeting-locked`; it touches nobody already in it, and unlocking is the same route with `locked: false`. The refusal is a sentence a late arrival reads — "This meeting is locked" — rather than a silent failure, and the meeting summary carries `locked` so the calendar's Join control says so before the click rather than after it.

**Lock beats the lobby.** A locked room does not put arrivals in the lobby; it refuses them. A queue in front of a door that is shut is a queue nobody will ever be admitted from, and a host who locked the room has already answered the question the lobby exists to ask.

**Spotlight one participant for everyone.** A room-level fact held in the room's own storage as `{ participantId, by, at }`, broadcast as part of the `room-state` frame, and cleared when the spotlighted participant leaves or when a host clears it. It ranks **first in the subscription policy, above pins** — which is the whole difference between a spotlight and a pin, and the reason it is a room fact rather than a per-browser one: a pin is one member arranging their own screen and says nothing to anybody, a spotlight is the host deciding what the room is looking at. A member may still pin somebody else on top of their own gallery order; the spotlight simply outranks it, and the spotlit track is asked for at the full simulcast layer whatever the page's tile count would otherwise choose, because everybody is looking at it.

**Hand hosting over, name a co-host, withdraw one, claim a hostless room.** One route, because they are one act with different arguments — writing or closing a grant — and four routes would be four places for the grant invariants to drift. The target of a hand-over or a co-host grant must have an open stay: a running room is not handed to somebody who is not in it. The claim is the exception and names the caller.

## 4. Schema — host controls (per-firm lineage, additive)

```
meeting_host
  id                   text pk            -- meetingHost_ handle
  meeting_id           text not null -> meeting.id
  user_id              text not null -> member.user_id
  role                 text not null      -- 'host' | 'co-host'  (CHECK)
  granted_by_user_id   text null  -> member.user_id   -- null for the starter's own grant and for a claim
  granted_at           text not null      -- instant
  revoked_at           text null          -- instant; null while the grant stands
  revoked_by_user_id   text null  -> member.user_id
  created_at, updated_at
  UNIQUE (meeting_id) WHERE role = 'host' AND revoked_at IS NULL
  UNIQUE (meeting_id, user_id) WHERE revoked_at IS NULL
  INDEX (meeting_id, revoked_at)
  CHECK (revoked_at IS NULL) = (revoked_by_user_id IS NULL)

meeting  (added)
  locked_at            text null          -- instant; null while the door is open
  locked_by_user_id    text null  -> member.user_id
  CHECK (locked_at IS NULL) = (locked_by_user_id IS NULL)

meeting_attendance  (added)
  ended_reason         text null          -- 'left' | 'socket-lost' | 'removed' | 'denied'  (CHECK)
  CHECK (ended_reason IS NULL OR left_at IS NOT NULL)
```

**Why the ceilings live where they do.** The two partial unique indexes are the grant invariants, held by the database rather than by the service: one live host per meeting, one live grant per member per meeting. A hand-over is a read-then-write like every other path here and is blind to the instant it does not span — two members handing the room to two different people at once — so the index is what settles it and the loser's whole batch rolls back, on the precedent of the one-meeting-per-event index.

**Why `ended_reason` is a column and not left in the audit metadata.** The reason already travels on the `meetings.meeting.left` audit row, and that row stays the home for who did it. But the join path has to refuse a removed member, and a refusal that had to walk a matter's audit log to decide would be a read of the wrong record entirely. The column is the queryable half; the audit row is the accountable half; neither restates the other.

**Nothing is backfilled.** Stays closed before this column existed carry null, which means "closed before the record kept the reason" and not "left". Writing `'left'` over them would invent a fact about every socket that was ever lost.

**Identifiers:** `meetingHost` joins `packages/identifiers` (registry and types). **PII registry:** `meeting_host.user_id`, `meeting_host.granted_by_user_id` and `meeting_host.revoked_by_user_id` are `retain-under-matter`, on the same line `meeting.created_by_user_id` already sits on — who was running the meeting is part of what the record says happened. `meeting.locked_by_user_id` likewise.

**Vocabularies in `packages/meetings/src/types.ts`:** `MEETING_HOST_ROLES = ['host', 'co-host']`, and `MEETING_DEPARTURE_REASONS` widens from two values to four (`left`, `socket-lost`, `removed`, `denied`). It stays one vocabulary and one audit event name with a labelled reason, for the reason it was one to begin with: the question a record is read for is when somebody stopped being in the room, and how is the footnote.

## 5. Routes — host controls

All under the chokepoint, `resource: "firm"` like the rest of the family, `idempotency: "required"` on every write, audited.

| method | path                                                               | permission                            | does                                                                                    |
| ------ | ------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/api/v1/meetings/{meetingId}/hosts`                               | `meetings:join`                       | the live grants: `[{ userId, role, grantedAt }]`                                        |
| POST   | `/api/v1/meetings/{meetingId}/hosts`                               | `meetings:host` + grant, or the claim | body `{ userId, role }`; hands hosting over, names a co-host, or claims a hostless room |
| POST   | `/api/v1/meetings/{meetingId}/hosts/{userId}/revoke`               | `meetings:host` + host grant          | withdraws a co-host's grant                                                             |
| POST   | `/api/v1/meetings/{meetingId}/participants/{participantId}/remove` | `meetings:host` + grant               | closes that stay `removed`, refuses their socket, bars re-entry for this meeting        |
| POST   | `/api/v1/meetings/{meetingId}/lock`                                | `meetings:host` + grant               | body `{ locked }`; opens or closes the door                                             |

`participantId` is the stay's own handle (`meetingAttendance`), which is what the roster names and what every frame carries — a member handle would not distinguish two stays and the room has never had one.

The grants read rides `meetings:join` rather than `meetings:host`: everybody in the room needs to know who is running it, and hiding that from the people it governs would be a strange kind of privacy.

`MeetingSummary` gains **`locked`** and (section 9) **`lobby`**. It deliberately does not gain "are you the host": that would put a per-caller subquery on every row of a fifty-row list to answer a question only the room screen asks, and the room screen has the answer on the wire.

**Problem types added:** `meeting-not-host` (403 — "You are not hosting this meeting"), `meeting-locked` (409), `meeting-removed` (409). `meeting-not-host` is a 403 rather than a 409 because it is an authority question and retrying changes nothing; it is its own type rather than the chokepoint's `permission-denied` because the member holds the permission and the remedy is different — somebody has to hand them the room.

**Every host route resolves the grant in one place.** `requireHostGrant(database, meetingId, userId)` in `@magna-carta/meetings`, composed into each write ahead of the act, returning the caller's role so the act can then ask whether a co-host may do this particular thing. One chokepoint for the authority, so a sixth host act cannot be added without it.

## 6. Frames — host controls

Additive in both directions, so `MEETING_PROTOCOL_VERSION` stays 1: nothing already on the wire changes shape, and a browser left open across the deploy goes on reading every frame it knows.

Client to room:

| type            | fields                        | room does                                                                                                            |
| --------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `mute`          | `participantId`               | closes that participant's audio at the routing service, sends them `muted`, updates the roster and the presence flag |
| `mute-all`      | —                             | the same for everybody who is not the caller and not a host or co-host                                               |
| `ask-to-unmute` | `participantId`               | relays `unmute-requested` to that socket. Nothing else                                                               |
| `spotlight`     | `participantId` (null clears) | stores the fact and broadcasts `room-state`                                                                          |

Room to client:

| type               | fields                                                           |
| ------------------ | ---------------------------------------------------------------- |
| `room-state`       | `spotlight { participantId, by, at } \| null`, `locked`, `lobby` |
| `muted`            | `by`, `at` — sent to the muted participant alone                 |
| `unmute-requested` | `by`, `at` — sent to the asked participant alone                 |

`RosterParticipant` gains **`hostRole: 'host' \| 'co-host' \| null`**, so every browser can draw the badge and a host's own screen can decide which menu items a tile offers. `welcome` carries `room-state` inline, for the same reason it carries the whole roster: a socket that has just arrived holds nothing to apply a change to.

**Refusal reasons added:** `not-host` (a host frame from a socket holding no grant; the socket stays open) and `removed` (fatal, followed by a 4000 close). The client's fatal set gains `removed`.

**The room authorizes a host frame from the STORED participant, never from the socket attachment.** The attachment is written once at upgrade and frozen there, which is right for the firm, the meeting and the medium — none of which can change under a socket — and wrong for hosting, which is exactly the thing that changes during a meeting. A co-host whose grant was withdrawn ten minutes ago would go on muting people for as long as their socket stayed open. So the grant lives on the stored participant record, the hosting route tells the room after it commits, and the room updates the records and broadcasts the roster.

**Room methods the routes call, after the record commits** — the existing `participantLeft` / `end` precedent, and in that order for the same reason: nobody is told the room changed by a write that then failed.

- `hostingChanged(grants)` — rewrites the roles on the stored participants and broadcasts the roster change.
- `participantRemoved(attendanceId)` — drops the roster entry, closes the media, refuses that socket `removed` and closes it.
- `roomStateChanged({ locked, lobby })` — broadcasts `room-state`.

## 7. Permissions — the existing key, and why no new one

`meetings:host` covers every act here. A new key — `meetings:moderate`, or one per act — was considered and refused on three grounds.

**It would be a second answer to one question.** The seed migration's own reasoning was that a firm which has decided who may cause a conversation has decided who may convene a meeting. The same reasoning carries: a seat that may end a meeting for everybody in it already holds the most destructive act in the room, and a key that granted muting separately would let a firm produce the incoherent seat that can close the room but not quiet it.

**The new authority is not in the key.** It is in the grant. Before this slice, holding `meetings:host` meant being able to end any meeting in reach; after it, it means being able to open a room, to be named a host of one, and to claim one nobody is running. That is narrower than what the key already carried, so nothing is widened by reusing it, and the one act that did widen — muting, removing, locking — is reachable only through a grant that somebody wrote.

**A key nobody can grant differently is a key that is not doing anything.** Role seeds are per firm and a firm could in principle split them, but there is no coherent firm in which the person who may convene a client meeting may not mute a line that is squealing. Read-only still holds neither key, which is the line communications already sits on.

So: no migration in access control, no change to `packages/access-control/src/registry.ts` beyond the comment beside the two keys, and no new role-permission seed.

## 8. The screen — host controls

**Per-tile menu.** A `DropdownMenu` on each remote tile, shown only to a host or co-host, and repeated in the roster rail's rows — which is where a host finds the person they need in a room of three hundred, because only sixteen of them have a tile. Items: Mute, Ask to unmute, Spotlight for everyone / Stop spotlight, Make co-host / Withdraw co-host, Make host, Remove. Remove and Make host go behind an `ActionDialog` (one is destructive, the other hands the room away and cannot be taken back without the other person's cooperation); the rest are immediate, because a confirmation on Mute would make the control slower than saying the person's name.

**Room menu in the control bar.** One "Host controls" `DropdownMenu` beside Leave rather than a row of new glyphs: Mute everyone, Lock the room / Unlock the room, Stop spotlight, and — in the second slice — Waiting room with its count. A band that grew five controls only three people in the room can use would cost every other member the space.

**A non-host sees none of it.** Absent, not disabled, on the standing ruling in `meeting-controls.svelte`: a disabled control says "this could happen here and does not", and for a member who is not hosting it could not.

**Badges.** The roster row and the tile carry a quiet `Badge` reading Host or Co-host. A member reading the roster to find out who to ask for the floor should not have to open a menu.

**What a muted member sees.** The microphone control reads muted, and a `FailureBand`-style notice states "A host muted you." — not an error, and not silent either: a microphone that goes dead with nothing on screen is read as a broken machine. Un-muting is the ordinary control and republishes the track.

**What an asked member sees.** An inline prompt with Unmute and Stay muted, and no default. It is not a dialog that steals focus mid-sentence, and it never chooses for them.

**What a removed member sees.** The room's ended state, worded for what happened: "You Were Removed From This Meeting", the way back to the event, and no Rejoin — the join would be refused and offering it would be the screen inviting a member to be told no.

**What everybody sees when the door shuts.** The header's meta line gains "Locked" while it is, on the row that already carries the day and the head count.

**The policy function.** `subscriptionPolicy` takes `spotlight: string | null` and its ordering bands become: spotlight, pins, the active screen share, recent speakers, roster order. The spotlit participant takes speaker view's large tile and the first gallery tile, and is asked for at the `f` layer regardless of tile count. Everything else about the function is unchanged, and the three-hundred-participant case remains a unit test.

## 9. The waiting room — one lobby per meeting

A lobby is a per-meeting fact by the owner's ruling, and the reason is arithmetic: a firm holds several meetings at once, so a firm-level lobby would put the people arriving at a partner's deposition in the same queue as the people arriving at a staff briefing, in front of a host who is in neither.

**The setting.** `meeting.lobby` is `'off' | 'on'`, NOT NULL DEFAULT `'off'`, chosen at Start and changeable by a host.

**Off by default**, because today every participant is a firm member arriving at an event they are on, and a lobby on by default would put a colleague in a queue for every ordinary hearing. Guests, when they land, always wait regardless of the setting — the door is what a guest link opens onto — and that is a property of the grant they arrive with rather than of this column.

**Changeable, unlike the medium, and the difference is worth stating** because the parent design was emphatic that a medium is fixed for the life of a room. A medium is what the people in the room agreed to, so widening it is a camera switched on for everybody by somebody else's click. A lobby is about who may come in, which is a standing decision of the host's and has no bearing on what anybody already agreed to. Turning it on mid-meeting is what a host does when the matter turns confidential.

**Turning the lobby off does not admit the people already at the door.** They stay in the list until a host admits them, and the panel goes on showing them. A setting is not a decision about a named person, and somebody may be waiting precisely because the host intends to deny them; flipping a switch must not become an admission nobody made.

**Whoever may run this room does not wait.** A host or co-host of this meeting goes straight in. Holding `meetings:host` is not enough — a paralegal with the key walking past the door of a confidential matter discussion is exactly what a host turns the lobby on to prevent.

**The one deadlock, and its exit.** A lobby-on meeting whose host has gone leaves everybody queued for a host who will never admit them. The claim from section 2 is the exit: a key-holder may claim a hostless room from inside the lobby, and **a grant written for a member whose stay is waiting admits that stay in the same batch** — because a host does not wait in their own lobby. One batch, so there is no instant in which somebody is hosting a room they are not in.

## 10. Schema — the waiting room (additive)

```
meeting  (added)
  lobby                text not null default 'off'   -- 'off' | 'on'  (CHECK)

meeting_attendance  (added)
  waiting_from         text null          -- instant the stay reached the door; null for somebody who never waited
  admitted_at          text null          -- instant a host let them in; null while waiting
  CHECK (admitted_at IS NULL OR waiting_from IS NOT NULL)
  INDEX (meeting_id, waiting_from) WHERE left_at IS NULL AND admitted_at IS NULL
```

**A waiting arrival is a stay from the moment it reaches the door.** The alternative — holding waiters in the room's own storage and writing the attendance row only on admission — was rejected for three reasons: the socket upgrade's ticket is an open stay and a waiter needs a socket, the room's storage is transient signaling state that is deleted when the last socket closes, and the record would keep nothing about who waited and was never let in, which is a thing a firm may need to say.

**`joined_at` therefore means "when this stay began", at the door or in the room, and `admitted_at` is when the person was actually in it.** That is a widening of what the column has meant and it is stated rather than papered over: making `joined_at` nullable is a table rebuild and buys nothing a second column does not, and the attendance read carries all three instants so nothing downstream has to infer anything.

**One predicate, one home.** "In the room" is `left_at IS NULL AND (waiting_from IS NULL OR admitted_at IS NOT NULL)`; "waiting" is `left_at IS NULL AND waiting_from IS NOT NULL AND admitted_at IS NULL`. Both are single exported SQL fragments in `meeting-statements.ts`, composed by the live count, the capacity guard, the roster and the lobby list, so the four cannot drift into disagreeing about who is present.

**The capacity guard moves to admission.** `MAX_MEETING_PARTICIPANTS` counts admitted open stays only, which is what the room actually holds. The door insert therefore cannot be the guarded one, so the **admission** statement carries the count in its own `WHERE` and is `guarded()` — a host admitting five people into two free seats gets three refusals naming the people who did not get in, not a room of three hundred and three. The door gets its own smaller ceiling, `MAX_MEETING_LOBBY = 100`, guarded the same way and refused as `meeting-lobby-full`: a room's queue is not somewhere a firm should be able to accumulate ten thousand rows, and the guest door lands on this path next.

**Barred entry is one rule with two labels.** A stay closed `removed` or `denied` bars that member from this meeting while it runs. Denial that did not bar would be a button that does nothing — the member presses Join again and is back at the front of the queue — so both close the door, and only the sentence differs.

## 11. Routes — the waiting room

| method | path                                            | permission              | does                                                                    |
| ------ | ----------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| POST   | `/api/v1/meetings/{meetingId}/lobby`            | `meetings:host` + grant | body `{ lobby }`; opens or closes the lobby                             |
| GET    | `/api/v1/meetings/{meetingId}/lobby`            | `meetings:host` + grant | who is waiting: `[{ participantId, userId, displayName, waitingFrom }]` |
| POST   | `/api/v1/meetings/{meetingId}/lobby/admissions` | `meetings:host` + grant | body `{ participantIds }`; lets them in                                 |
| POST   | `/api/v1/meetings/{meetingId}/lobby/denials`    | `meetings:host` + grant | body `{ participantIds }`; closes each stay `denied`                    |

**`POST /api/v1/meetings` takes `lobby`** beside `medium`, read only when the request opens the room — one meeting per event, so the first Start decides and a second one asking differently gets the room that exists.

**`POST .../join` answers `{ waiting, participantId, displayName, iceServers }`.** `waiting: true` means the stay is at the door. It carries the relay credentials either way: they last an hour, which covers any wait anybody will sit through, and minting one for somebody who is later denied costs nothing that matters — a mint is not the billed unit, relay traffic is, and a denied member relays nothing. The alternative, minting at admission, would need a second round trip at the exact moment a member is being let into a meeting that has started without them.

**There is no server-side "admit everyone".** Admit all sends the identifiers the host's panel was showing. A server-side "all" would admit whoever arrived in the millisecond after the host looked at the list, which is precisely the person the host did not decide about — and in a lobby that exists because somebody might arrive who should not, that is the whole failure. The response reports one outcome per identifier (`admitted`, `not-waiting`, `room-full`), so a batch that half-lands is legible rather than a single refusal for five people.

**Problem types added:** `meeting-lobby-full` (409), `meeting-not-admitted` (409 — "A host did not admit you to this meeting"). `meeting-locked` and `meeting-removed` are already on the family from slice one.

## 12. Frames — the lobby, and what a waiting socket may see

The socket upgrade admits a waiting stay. The attachment gains `waiting: boolean`, server-derived off the row the caller was just authorized against, like the medium.

**A waiting socket is never sent a `welcome`.** There is nothing it is welcome to yet, and a welcome with an empty roster is a shape every future reader has to remember to keep empty. It receives `lobby` instead.

**The structural guarantee is the storage prefix.** A waiting participant is stored under `waiting:<attendanceId>`, never `participant:<attendanceId>`, so `storedParticipants()` — the one read every roster, delta, subscription check and broadcast is built from — cannot include them. A waiter is not omitted from the roster by a filter somebody has to remember; they are not in the set the roster is made of.

Room to a waiting socket:

| type       | fields                                                             |
| ---------- | ------------------------------------------------------------------ |
| `lobby`    | `position` (one-based), `waiting` (how many are at the door), `at` |
| `admitted` | `at` — then the ordinary `welcome` follows on the same socket      |
| `refused`  | `denied` (fatal, then a 4000 close)                                |
| `ended`    | the meeting ended while they waited                                |

A waiting socket may send `ping` and `leave` (giving up) and nothing else. Every other frame is refused `not-admitted` with the socket kept open — checked before the routing client is even resolved, so a waiter's frame never costs a session at the routing service.

Room to the **hosts**:

| type      | fields                                                                |
| --------- | --------------------------------------------------------------------- |
| `waiting` | `participants: [{ participantId, userId, displayName, waitingFrom }]` |

Sent whole rather than as a difference, and only to sockets holding a grant. A lobby is bounded at a hundred and is usually one or two people, so the difference would cost more bookkeeping than it saves; `welcome` carries the current list inline for a host, and an empty array for everybody else.

**Admission on the wire:** the route commits, then calls `participantsAdmitted(ids)` on the room. For each, the room moves the record from `waiting:` to `participant:`, sends `admitted` and then `welcome` on their socket, announces the arrival to the room as an ordinary roster join, and sends the hosts a fresh `waiting`. The admitted client builds its peer connection from the credentials its join already answered with, and publishes. `admitted` and `welcome` are two frames with one job each, so the client's welcome handler is the same handler it has always been.

**Denial on the wire:** `participantsDenied(ids)` — `refused: denied`, a 4000 close, the `waiting:` record deleted, the hosts told. Nothing is announced to the room: the people in it never knew somebody was at the door.

**Refusal reasons added:** `denied` (fatal) and `not-admitted` (socket kept open). The client's fatal set gains `denied`.

## 13. The screen — the waiting room

**For the person waiting.** The room route in a `waiting` state: the meeting's title, day and time, one line saying they are waiting to be let in, their place in the queue where it is past first, and Leave. No tiles, no roster, no controls, and no camera captured — a browser that lit the camera indicator for somebody standing at a door would be taking a picture nobody asked for. If the host turns them away, the screen says so in the same register the removed screen uses, with the way back to the event and no Rejoin.

**For the host.** A lobby panel in a `Sheet`, opened from the Host controls menu, with a count badge on the control-bar button so a host running a meeting learns somebody has arrived without a panel open. Rows carry the avatar, the name, how long they have waited, and Admit and Deny; the header carries Admit all and Deny all, both of which send the identifiers on screen. A `Sheet` rather than a section of the roster rail because the rail is hidden below the large breakpoint and a host on a narrow screen must still be able to open the door.

**The first arrival raises a toast**, once, naming nobody — "Somebody is waiting to be let in" — because a badge on a control a host is not looking at is a person left standing outside for ten minutes.

**At Start.** The calendar's entry action gains the lobby choice beside Start meeting and Start call, as a `Switch` reading "Hold arrivals in a lobby", defaulted off. On a locked meeting the Join control reads Locked and does not offer a way in.

## 14. What these slices do not do

- **Guests.** The lobby is their door and they always wait, but the signed one-time link is its own slice and nothing here mints one.
- **Breakout rooms.** A host splitting the room is a second room under one meeting and is not touched.
- **A waiting-room message.** Zoom lets a host write a line the lobby shows. It is content, which is the first thing this subsystem has had to store, and it goes with in-meeting chat rather than ahead of it.
- **Muting on the record.** Stated in section 3, with the path if a firm ever needs it.
- **Removing somebody from every future meeting on an event.** A removal is from one room. Barring a person from an event is a calendar question.

## 15. Testing

**`packages/meetings/test/`** (`node:sqlite`, on the service-test precedent):

- The starter holds a `host` grant the moment the meeting exists; `created_by_user_id` and the grant are read as two different facts.
- Hand-over is one batch: the outgoing grant closes and the incoming one opens at one instant, and the live-host index holds when two hand-overs race.
- A co-host may not remove the host, revoke a grant, or hand the room over.
- A claim is refused while a host has an open stay, accepted when none does, and audited as a claim.
- A claim by a waiting member admits their stay in the same batch.
- Removing closes the stay with `ended_reason = 'removed'`; joining again is refused; a new meeting on the same event admits them.
- Locking refuses a join with `meeting-locked` and touches nobody already in the room.
- The lobby: an arrival with `lobby: 'on'` inserts `waiting_from` and no `admitted_at`; the live count and the capacity guard both ignore it; admission sets `admitted_at` and takes the seat; the admission guard refuses past the ceiling and names who did not get in; denial closes the stay `denied` and bars re-entry.
- Turning the lobby off leaves the people at the door where they are.
- `MAX_MEETING_LOBBY` refuses the hundred-and-first arrival with `meeting-lobby-full`.
- Every audit row written here carries identifiers and instants and nothing else — the existing metadata assertion, extended to the new events.

**`apps/api-worker/test/meetings-routes.test.ts`:**

- Every host route answers 403 `meeting-not-host` to a member holding `meetings:host` and no grant, and 200 to the host.
- End answers 403 to a key-holder who is not hosting — the behaviour change, asserted deliberately.
- The grants read is reachable on `meetings:join`.
- Admissions and denials report one outcome per identifier, including a mixed batch.
- A walled matter's meeting is 404 on every one of the new routes, which is the family's own rule.

**`apps/api-worker/test/meeting-room.test.ts`** (against the fake routing client):

- `mute` closes the target's audio at the routing service, sends them `muted`, and drops the track from the roster; a `mute` from a socket with no grant is `not-host` and the socket stays open.
- `mute-all` leaves the caller and every host and co-host publishing.
- `ask-to-unmute` reaches the target and changes nothing else — the negative assertion is the point.
- `spotlight` rides on `room-state`, survives a `sync`, and clears when the spotlit participant leaves.
- A grant withdrawn mid-meeting stops that socket's host frames on the next frame, without a reconnect — the stored-role rule from section 6.
- A waiting socket receives `lobby` and never a `welcome`; every signaling frame from it is `not-admitted`; it is absent from every other socket's roster and from every delta.
- Admission sends `admitted` then `welcome` on that socket and a roster join to the room; denial closes the socket 4000 after `refused: denied`.
- Removal refuses the socket `removed` and closes it, and the media is released.

**`apps/web/test/`:**

- `subscription-policy.test.ts`: spotlight outranks a pin, takes speaker view's large tile, is asked for at `f` on a full gallery page, and a cleared spotlight restores the previous order.
- The client: `muted` disables the local track and shows the notice; unmuting republishes rather than flipping a flag; `unmute-requested` changes nothing until the member chooses; `removed` and `denied` are fatal and offer no Rejoin.
- The waiting state: a `waiting: true` join opens the socket and captures no media; `admitted` builds the peer connection from the credentials already in hand and publishes; `lobby` frames move the position.
- The room page: a non-host renders no host menu and no Host controls button; a host renders both; the lobby badge counts what the `waiting` frame carries.
- The controls harness covers the menu's items against a host, a co-host and a plain member.

**Load profile:** the three-hundred-participant fixture gains a spotlight and a lobby of twenty, so the policy function and the roster broadcast are measured with both.

## 16. The files each slice touches

Two agents can build each slice in parallel as long as the split below holds: **the backend agent owns everything under `packages/` and `apps/api-worker/`, including the emitted contract and the generated client; the web agent owns everything under `apps/web/`.** No file appears on both lists. The contract is the handoff — the backend agent emits and regenerates first, the web agent builds against it.

### Slice one — host controls (first)

Backend:

- `packages/database/src/per-firm-schema.ts` — `meeting_host`; `meeting.locked_at` / `locked_by_user_id`; `meeting_attendance.ended_reason`
- `packages/database/drizzle/per-firm/<timestamp>_host-controls.sql` and the snapshot under `packages/database/drizzle/per-firm/meta/`
- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts` — `meetingHost`
- `packages/data-access/src/pii-registry.ts` — the four new member columns
- `packages/meetings/src/types.ts` — `MEETING_HOST_ROLES`, the widened `MEETING_DEPARTURE_REASONS`, the row and summary shapes
- `packages/meetings/src/validation.ts` — `meeting-not-host`, `meeting-locked`, `meeting-removed`
- `packages/meetings/src/meeting-statements.ts` — the grant reads and writes, the lock statement, the barred-entry predicate
- `packages/meetings/src/meeting-service.ts` — the starter's grant on create, `grantHosting`, `revokeHosting`, `claimHosting`, `removeParticipant`, `setLocked`, `requireHostGrant`; `endMeeting` gains the grant check
- `packages/meetings/CLAUDE.md` — the grant rule and the route/frame split
- `packages/meetings/test/meeting-service.test.ts` (and a new `host-grants.test.ts`)
- `packages/meeting-protocol/src/frames.ts` — the four client frames, `room-state`, `muted`, `unmute-requested`, `hostRole` on the roster, the two refusal reasons
- `apps/api-worker/src/meetings/meeting-room.ts` — the host-frame handling, the stored role, `hostingChanged`, `participantRemoved`, `roomStateChanged`, the spotlight record
- `apps/api-worker/src/routes/meetings.ts` — the five routes, `locked` on the summary, the grant check on end
- `apps/api-worker/openapi/openapi.json` (emitted) and `packages/api-client` (generated)
- `apps/api-worker/test/meetings-routes.test.ts`, `apps/api-worker/test/meeting-room.test.ts`
- `roadmap.d/meetings.md`, `status.d/meetings.md`, `STATUS.md`, `STATUS.json`, `docs/now.md`, `changelog.d/<slug>.md`

Web:

- `apps/web/src/lib/meetings/meeting-client.svelte.ts` — the host acts as frames, `muted` / `unmute-requested` / `room-state` handling, the audio republish, the fatal `removed`
- `apps/web/src/lib/meetings/client/subscription-policy.ts` — the spotlight band and its layer
- `apps/web/src/lib/meetings/meeting-host-menu.svelte` (new) — the per-tile and per-row menu
- `apps/web/src/lib/meetings/screen/meeting-controls.svelte` — the Host controls menu
- `apps/web/src/lib/meetings/screen/meeting-tile.svelte`, `meeting-roster.svelte` — the menu and the badges
- `apps/web/src/lib/meetings/meetings-api.ts` — the five writes
- `apps/web/src/routes/(app)/meetings/[id]/+page.svelte` — the hosting read, the removed state, the locked word
- `apps/web/src/lib/meetings/meeting-entry-action.svelte` — Locked on the Join control
- `apps/web/test/meeting-client.test.ts`, `meeting-room-page.test.ts`, `meeting-controls-harness.svelte`, a new `subscription-policy` case, a new `meeting-host-menu.test.ts`
- `docs/user/features/meetings.md` — running a meeting

### Slice two — the waiting room (after)

Backend:

- `packages/database/src/per-firm-schema.ts` — `meeting.lobby`; `meeting_attendance.waiting_from` / `admitted_at` and the partial index
- `packages/database/drizzle/per-firm/<timestamp>_waiting-room.sql` and the snapshot
- `packages/meetings/src/types.ts` — `MEETING_LOBBY_MODES`, `MAX_MEETING_LOBBY`, the widened summary
- `packages/meetings/src/validation.ts` — `meeting-lobby-full`, `meeting-not-admitted`
- `packages/meetings/src/meeting-statements.ts` — the two presence predicates, the lobby list, the guarded admission
- `packages/meetings/src/meeting-service.ts` — `joinMeeting` takes the lobby branch, `admitParticipants`, `denyParticipants`, `setLobby`; the claim-admits rule
- `packages/meetings/CLAUDE.md` — the door, the predicates, the guard that moved
- `packages/meetings/test/lobby.test.ts` (new)
- `packages/meeting-protocol/src/frames.ts` — `lobby`, `admitted`, `waiting`, the two refusal reasons
- `apps/api-worker/src/meetings/meeting-room.ts` — the lobby state, the `waiting:` prefix, `participantsAdmitted`, `participantsDenied`
- `apps/api-worker/src/routes/meetings.ts` — the four lobby routes, `lobby` on Start and on the summary, `waiting` on the join answer, `waiting` on the socket attachment
- `apps/api-worker/openapi/openapi.json` (emitted) and `packages/api-client` (generated)
- `apps/api-worker/test/meetings-routes.test.ts`, `apps/api-worker/test/meeting-room.test.ts`
- `roadmap.d/meetings.md`, `status.d/meetings.md`, `STATUS.md`, `STATUS.json`, `docs/now.md`, `changelog.d/<slug>.md`

Web:

- `apps/web/src/lib/meetings/meeting-client.svelte.ts` — the `waiting` state, the `lobby` and `admitted` frames, the deferred peer connection
- `apps/web/src/lib/meetings/meeting-lobby-panel.svelte` (new) — the host's sheet
- `apps/web/src/lib/meetings/meeting-lobby-wait.svelte` (new) — the waiting screen
- `apps/web/src/lib/meetings/screen/meeting-controls.svelte` — the Waiting room item and its badge
- `apps/web/src/lib/meetings/meetings-api.ts` — the four lobby writes
- `apps/web/src/routes/(app)/meetings/[id]/+page.svelte` — the waiting branch and the denied state
- `apps/web/src/lib/meetings/meeting-entry-action.svelte` — the lobby switch at Start
- `apps/web/test/meeting-client.test.ts`, `meeting-room-page.test.ts`, a new `meeting-lobby.test.ts`
- `docs/user/features/meetings.md` — the waiting room

## Amendments taken during slice one — host controls

The server half landed 2026-09-20 with the design's own assertions unchanged. What differs from the
sketch above, and why:

- **The domain package gained a trio rather than four more exports on two files.** The hosting
  concern is `packages/meetings/src/hosting-types.ts`, `hosting-statements.ts` and
  `hosting-service.ts`, on the structural slice's own rule (a types/statements/service trio per
  concern). `MEETING_HOST_ROLES` therefore lives in `hosting-types.ts` rather than in `types.ts`;
  the widened `MEETING_DEPARTURE_REASONS` and `MeetingSummary.locked` stay in `types.ts`, because
  they belong to attendance and to the meeting rather than to hosting.
- **The routes are their own file**, `apps/api-worker/src/routes/meeting-hosting.ts`, and the room's
  half is its own concern module, `apps/api-worker/src/meetings/room/room-hosting.ts` — one route
  file per resource, and a concern is a module rather than a method on `MeetingRoom`. The
  Durable Object gained three thin RPC methods (`hostingChanged`, `participantRemoved`,
  `roomStateChanged`) and nothing else.
- **`meetingErrorResponse` moved out of `routes/meetings.ts`'s private scope and is shared.** Three
  route files now map one refusal vocabulary, and "one refusal for every way a room is out of reach"
  only holds if every door answers the same way; `routes/meeting-chat.ts` had a second copy and now
  imports the first.
- **`room-state` carries `spotlight` and `locked` and not `lobby`.** The lobby is the next slice and
  the field is additive when it lands. `welcome` carries the whole `roomState` inline, as designed.
- **`MUTE_ALL_CONCURRENCY` lives in the room, not in the protocol package.** It is not on the wire,
  and that package takes nothing that only one end reads.
- **Removal writes two audit rows, not one.** `meetings.meeting.left` with `reason: 'removed'`, so
  "when did each person stop being in the room" stays one read over one event name — the whole
  reason that vocabulary exists — and `meetings.meeting.removed` beside it with the HOST as its
  actor, because the departure row's actor is the member whose presence it records and it has
  nowhere to put somebody else. The removal also closes the target's own grant, so a removed co-host
  cannot claim the room back from outside it.
- **A claim counts the OTHER grant-holders present, not every grant-holder.** A co-host sitting alone
  in a room whose host went offline holds a live grant, so counting every one of them would refuse
  them the single act their co-host grant does not carry and leave the room permanently hostless —
  which is the state the claim exists to end. The claim closes the abandoned HOST grant and the
  claimer's own, both forced by an index rather than chosen, and leaves an absent co-host's alone.
- **The socket upgrade seeds the room's stored `hostRole` and `locked` from the meeting record.** The
  attachment is still never the authority — every host frame is decided from the stored participant
  record, which the hosting routes rewrite after they commit — but the route has just read the
  grants to authorize the upgrade, so seeding from that read saves the room a round trip it would
  otherwise make per socket.
- **A locked room refuses at the join path AFTER the open-stay read.** A member already in the
  meeting when the door shut is not turned out of it by their own browser reconnecting.
- **"A new meeting on the same event admits them" is a statement about a new MEETING, and in
  practice a new event.** One meeting per event is a partial unique index over the event column with
  no status in it, so an event has at most one meeting for the life of the record — including after
  it ends. The bar a removal writes is per meeting and reaches nothing else, which is what the test
  asserts.
- **`GET /hosts` is recorded in the unpaged-list baseline rather than paged.** Its answer is the LIVE
  grants — one host and the co-hosts named in the room, written one deliberate act at a time — and
  it is read whole because it is the badge every browser draws.

## Amendments taken during slice two — the waiting room

The server half landed 2026-09-20 with the design's own assertions unchanged. What differs from the
sketch above, and why:

- **The domain package gained a trio rather than four more exports on two files**, exactly as the
  hosting concern did: `packages/meetings/src/lobby-types.ts`, `lobby-statements.ts` and
  `lobby-service.ts`. `MEETING_LOBBY_MODES`, `MAX_MEETING_LOBBY` and the outcome vocabularies
  therefore live in `lobby-types.ts` rather than in `types.ts`. What stayed next door is what the
  lobby did not invent: the two presence predicates (`IN_THE_ROOM_PREDICATE`, `WAITING_PREDICATE`),
  because the live count and the roster compose them too, and the attendance column list, which the
  lobby's arrival made worth naming once — a row typed `MeetingAttendanceRow` whose `admitted_at` is
  undefined reads as a waiter who is actually in the room.
- **The routes are their own file**, `apps/api-worker/src/routes/meeting-lobby.ts`, and the room's
  half is its own concern module, `apps/api-worker/src/meetings/room/room-lobby.ts` — one route file
  per resource, and a concern is a module rather than a method on `MeetingRoom`. The Durable Object
  gained three thin RPC methods (`participantsAdmitted`, `participantsDenied`, `lobbyChanged`) and
  the one branch at the upgrade that sends a waiting stay to `admitToLobby` instead of
  `admitParticipant`.
- **`MAX_MEETING_LOBBY` is NOT exported from the protocol package.** It bounds the `waiting` frame's
  array, and a browser draws whatever that array carries and never divides by the ceiling — so it is
  a number only one end reads, which is the rule that kept `MUTE_ALL_CONCURRENCY` out of that package
  in slice one. What the wire did gain is the shape: `WaitingParticipant` and `MeetingLobbyMode` in
  `packages/meeting-protocol/src/types.ts`, the latter as the third of the twin string unions the
  medium and the host role already have.
- **The GET lobby route rides `meetings:host`, not `meetings:join`** — the one read in this family
  that the people inside the room may not make. Section 11 gives every lobby route the grant and the
  key together, and the reason is worth stating where the grants read's opposite reasoning already
  is: who is running the meeting is something everybody it governs needs to know, and who is at the
  DOOR is a list of people a host has not yet decided about. In a lobby that exists because somebody
  might arrive who should not, telling the room who is outside it is the leak the door was shut to
  prevent. It is recorded in the unpaged-list baseline with `MAX_MEETING_LOBBY` as what bounds it.
- **`welcome` gained the lobby list, empty for everybody who is not running the meeting.** Section 12
  says a host's welcome carries it inline; the field is on every welcome rather than only a host's,
  because a frame whose shape depended on the recipient is a shape both ends have to branch on.
- **The claim-admits rule is on the GRANT rather than on the claim.** Section 9 states it of "a grant
  written for a member whose stay is waiting", so `grantHosting` carries it as well as
  `claimHosting`: a co-host named while still at the door is let in on the same terms. It is one
  shared helper (`admitWaitingStay`), and it uses `admitWaitingAttendanceStatement` — the admission
  with NO capacity count in it. That is the one place the room's ceiling is deliberately not held:
  refusing the claimer for a full room would restore exactly the deadlock the claim exists to end,
  and would do it in the meeting most likely to be full.
- **A batch that half-lands is decided by the service's own count, not by the guards.** Section 10
  asks for `guarded()` on the admission and section 11 for one outcome per identifier, and the two
  together only work the way the join path already works: the read produces the REASON (`room-full`,
  named per person, seats spent down the list in the order the host sent it) and the guard produces
  the LIMIT. A guard that fires rolls the whole batch back and answers 409, which is honest — the
  room filled or a stay closed inside the window, and the host re-reads the lobby.
- **Both admissions and denials are idempotent through the gate on their decisions**, so a retry is
  told what the first call was told rather than re-deciding against a lobby that has moved. The
  hosting routes' own gate now carries `admittedAttendanceId` for the same reason: a retried claim
  has to move the same person into the room.
- **A waiter's dropped socket takes the roster's own grace.** `StoredWaiting` carries `socketLostAt`
  and the alarm sweeps the door beside the roster, closing the stay through the same
  `closeAttendanceAfterSocketLoss` path. Not in the design, and not optional: a waiter's stay is a
  stay, so a browser closed at a door would otherwise leave an open row in the firm's record forever
  — which is the exact failure the roster's grace sweep exists to fix.
- **`leaveMeeting` no longer refuses a room that is not live.** A lobby-on meeting stays `scheduled`
  while people wait in it — a waiter has not walked into the room, so nothing makes it live — and
  somebody giving up at the door has to be able to close their own stay. The `meeting-not-live`
  refusal now applies only where the caller has no stay at all, which is what it was always about.
- **`countOtherHostsPresent` counts grant-holders who are IN THE ROOM**, not merely holding an open
  stay. A grant-holder waiting at the door cannot admit anybody, including themselves, so counting
  them would refuse the claim that is the lobby's one way out of a hostless room.
- **The browser half of the frames fitness function is red until the web slice lands.**
  `packages/meeting-protocol/test/frames-have-handlers.test.ts` fails for `lobby`, `admitted` and
  `waiting` on the browser side, and its dispatch-equality check fails against
  `apps/web/src/lib/meetings/client/signaling.ts`. That failure is the point of the function: it
  names the end that has not been built yet, at the moment the frame is added.

## Amendments from the adversarial review (2026-09-21)

Six corrections, each a defect the design's own reasoning implied and the build did not carry.

**A hand-over leaves the outgoing host a co-host.** Section 3 treats hand-over as closing one grant
and opening another, which is what was built — and the effect was that a host handing the room to a
colleague mid-meeting was dropped to an ordinary member, losing the mute, the spotlight and the door
with nothing on any screen to say it had happened. Handing the room over is not leaving it. The
outgoing host's co-host grant is now written in the SAME batch as the revocation, so there is no
instant in which they hold nothing. `revokeHostGrantStatement` takes an optional `role` for a
consequence of that: a batch that closes one grant and opens another for one member is the only place
"whatever this member holds" stops being one row, so a second hand-over racing it would otherwise
close the co-host grant it had never read, pass its own guard on a row it did not mean, and fail one
statement later on the live-host index — a raw constraint error where the guard was meant to catch
it.

**A co-host may resign.** The design gave a co-host no way to stop being one: a grant only the host
could close meant somebody named for one agenda item carried the authority for the rest of the
meeting. `revokeHosting` naming the CALLER is now a resignation, on the same route, with its own
audit event (`meetings.meeting.hostingResigned`) because both rows carry the caller as the actor. The
one refusal is the sole grant-holder — a host resigning out of a room where nobody else holds
anything would leave a running meeting with nobody running it, which is a state to hand over out of
rather than walk out of.

**`countOtherHostsPresent` counts a HOST grant, not any grant.** The slice-one amendment above
narrowed it to grant-holders in the room and stopped there, which left the worse half: two co-hosts
present with the host gone each saw the other's live grant, neither could claim, and the meeting was
permanently without a host — exactly the state the claim exists to end. A co-host is running the
meeting WITH somebody; they are not the somebody.

**The door is enforced in the statement.** The join path read the lock and the lobby a round trip
before its insert, so a host shutting the door in that instant had the arrival land in a locked room,
and a host turning the LOBBY on in the same instant put somebody straight into the discussion the
door was opened to keep them out of. Both are now predicates on `insertAttendanceUnderCapStatement`
and, inverted, on the waiting insert, so a lost race rolls the whole batch back. That window is not
theoretical: it is exactly the moment the control is being used, because a host shuts a door because
of who is about to arrive.

**Removing somebody who was at the door clears the `waiting:` key.** `participantRemoved` released
the `participant:` record and a waiting stay has never had one, so the record said the member was out
of the meeting while the host's own lobby panel went on offering to admit them and the key went on
arming the door's grace deadline. The room now drops the door record in the same act and tells the
hosts.

**A lock or lobby write that changed nothing does not disturb the room.** Both services already
answered `changed: false` for a no-op; the routes ignored it and called the room anyway, spending a
room-state broadcast on every socket to restate what each of them already drew — and reporting an
event that did not happen.

**Two decisions recorded rather than changed.** A LOCKED ROOM DOES NOT REFUSE AN ADMISSION: the lock
is what the room answers an arrival with, and an admission is a host deciding about a named person,
so refusing it would mean a host who shut the door could no longer let in the colleague they shut it
for. And the operator's inspect payload keeps `userId` beside the stay: a report of "my tile went
black" arrives as a person, often as the second of that person's two stays, and the member handle is
what joins it to the room that was serving them. Both are minted identifiers; neither says who
anybody is.

## Amendments from the security review (2026-09-21)

Four corrections, and two questions for the owner that are deliberately not answered here.

**Every frame answers to a per-socket budget.** The room throttled a sync, a layer change, a hand
and a reaction, and nothing else — so a publish, a subscribe, a renegotiation, a close and the
speaking half of a presence frame could each arrive as fast as a browser could write to a socket,
and each of the first four is a billed call to the routing service while presence writes the
participant record. A token bucket now rides the socket's own attachment, twenty frames a second
with a burst of forty (`FRAME_BUDGET_PER_SECOND` / `FRAME_BUDGET_BURST` in
`@magna-carta/meeting-protocol`, on the wire because a client has to know the pace it is being held
to), spent before the frame is parsed and answered `rate-limited` with the socket kept open. Host
frames fold into the same bucket. Beneath it, the four acts that reach the routing service carry
their own per-participant windows on the existing `syncAt`/`layerAt` pattern, and a request to
unmute carries one kept on the member being ASKED rather than on the host asking — two hosts taking
turns would otherwise each stay inside a budget of their own. The refusal telemetry is sampled the
way the storage budget is: a flood recorded event-per-frame costs more than the flood. The load
harness sends well inside the budget and its pace is unchanged.

**A claim requires the claimer to be in the meeting.** `claimHosting` asked only whether any OTHER
grant-holder had an open stay, so a member holding `meetings:host` who had never joined could seize a
live meeting sixty seconds after the host's tunnel dropped, from outside it. Nobody hands this grant
over, so being in the room — or at its door, which the claim admits in the same batch, as before — is
the whole of what makes taking it an act of the meeting rather than of the permission key. Refused
`meeting-not-joined`.

**A reconnect does not undo a revocation.** The socket route reads the live grants to authorize the
upgrade and seeds the stored participant with what it read; `admitParticipant` wrote that seed even
over a record that already existed, so a withdrawal landing between the read and the admit was
undone for as long as the new socket stayed open. An existing record now keeps its own `hostRole`,
and `hostingChanged` is the only writer of truth after the first welcome. The welcome's lobby list
follows the same answer.

**The operator's read into a live meeting is audited.** `routes/meeting-inspect.ts` was
`audited: false`. Nothing else in this platform lets one person see into another firm's live
conversation, so the row is written — to the control plane's own `auth_audit`, beside the other
platform-operator acts, because the caller belongs to no firm — before the room is read, and carries
the operator, the firm and the meeting and nothing else.

### Open — for the owner

**The signaling socket outlives the session and the permission that opened it.** Authority is read
once at the upgrade: the session, `meetings:join`, the stay, the firm. After that the socket is
authorized by its attachment and by the stored participant record for as long as it stays open,
which in a long meeting is hours. A member signed out elsewhere, a session revoked, a member
suspended, or `meetings:join` withdrawn from their role changes nothing until they reconnect. The
hosting half of this is already handled — a withdrawn grant takes effect on the next frame, because
the routes rewrite the record — and the rest is not. What is wanted is a decision on shape: a
bounded socket lifetime with a re-authorizing reconnect, a revalidation on a cadence or at the
room's own alarm, or a signal from the session store into the rooms holding that member's sockets.
Each costs something different, and the first is the only one with no new moving part.

**The chat transcript is readable by anybody who can see the matter event.** Posting a message
requires an open stay — being in the room is the whole permission to speak — but READING the
transcript is the meeting's own visibility rule, which is the event's, which is the matter's. So a
member of the matter team who was never in the meeting can read everything said in it afterwards,
and so can somebody added to the matter next month. That may be exactly right: a meeting on a matter
is the firm's record of the matter, the same way a filed email is, and a narrower rule would make
the transcript less useful than the thing it documents. It may also surprise the people typing,
whose screen shows a conversation with the people in the room. The question is whether the read
should be narrowed to the people who were in the meeting (with the matter team as a second, wider
tier), and if so whether a message sent before somebody arrived is theirs to read.
