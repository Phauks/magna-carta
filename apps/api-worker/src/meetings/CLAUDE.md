# The meeting room — CLAUDE.md

**Purpose.** This directory is the SERVER side of a live meeting: the `MeetingRoom` Durable Object
that brokers each browser's session with Cloudflare Realtime and keeps the roster, and the client for
the two Realtime services it speaks to. It holds no business logic and writes no record of its own —
the meeting row, attendance and chat are `@magna-carta/meetings` behind
`apps/api-worker/src/routes/meetings.ts`; what is here is signaling, and it is deleted when the
meeting ends.

**Spec:** [`docs/specs/2026-09-18-meetings-design.md`](../../../../docs/specs/2026-09-18-meetings-design.md)
(_Signaling_, _Large rooms_, _Structure for growth_). **The wire:**
[`@magna-carta/meeting-protocol`](../../../../packages/meeting-protocol/CLAUDE.md). **The browser
half:** [`apps/web/src/lib/meetings`](../../../web/src/lib/meetings/CLAUDE.md).

## The module map

- `meeting-room.ts` — the Durable Object, and an ORCHESTRATOR only: it accepts the upgrade, builds
  the `RoomContext` every module takes, and hands each event to the module that owns it. It also
  holds the door the routes knock on — `meetingSocketRequest`, `meetingSocketRequestUrl` and the
  socket attachment shape — because that is the surface `routes/meetings.ts` imports.
- `room/room-state.ts` — the two places a fact may live in a hibernating room: the object's storage
  (`StoredParticipant`, `StoredRoom`, the ended marker, the keys, the reads and writes) and the
  per-socket attachment (`attachmentOf`, `socketsFor`, `broadcast`, `refuseAndClose`). `RoomContext`
  and `recordRoomFailure` are here because every other module takes the first and calls the second.
- `room/room-roster.ts` — who is in the room as everybody else sees it: the projection to a roster
  entry, the whole-list-or-difference decision at `ROSTER_DELTA_THRESHOLD`, and the check that a
  subscription names only tracks this room is carrying.
- `room/room-presence.ts` — who is talking, relayed; the throttle that makes relaying it affordable
  in a room of three hundred, and the deferred flush that keeps the throttle from losing the last
  transition of a burst. It also owns THE HAND — the stamp the room writes, the relay that travels
  on a roster change, and the lowering a host asks for (authorized next door, in `room-hosting.ts`).
- `room/room-reactions.ts` — something thrown on a tile: the relay that names the reactor in a small
  room and the per-second bucket that counts the whole of a large one, and the ONE window a hand and
  a reaction share — the only throttle here that refuses rather than drops.
- `room/room-chat.ts` — the relay of a message the chat ROUTE has already committed, and the
  redaction of one. Two broadcasts and no storage key: the transcript is the firm's own record.
- `room/room-media.ts` — the routing-service session opened on first use, the four acts that reach
  that service (publish, subscribe, layer, close), the tracks the roster remembers because of them,
  and the release that stops the forwarding when somebody is gone.
- `room/room-lifecycle.ts` — arriving (and superseding the socket that held the stay), dropping (the
  per-person grace), ending, and the one alarm three deadlines share: each person's grace, the
  retirement of the ended marker, and the end of a presence throttle's window.
- `room/room-frames.ts` — what one frame means: parse, identify the socket, answer what the roster
  can answer, refuse what the roster refuses, and only then dispatch to the modules above.
- `room/room-lobby.ts` — the door: a socket that has a stay and is not yet in the room. The
  `waiting:` keyspace, the lobby state a waiter is sent in place of a welcome, the list only the
  hosts receive, the two decisions the routes call back with, and the door's own share of the grace
  sweep.
- `room/room-hosting.ts` — running the room from inside it: the four acts a host performs as a frame
  (mute one, mute everybody else, ask to unmute, spotlight), and the three the hosting routes call
  back into the room after their own writes commit (`hostingChanged`, `participantRemoved`,
  `roomStateChanged`).
- `room/room-diagnostics.ts` — the room's one emitter: the `meetings.room.*` event family through the
  standard telemetry pipeline, the refusal that is sent and recorded in one act, the browser's own
  connection report (its window, and the last sample kept on the participant), and the sampled
  storage budget a frame is measured against. Nothing here may throw into a caller.
- `room/room-inspect.ts` — what one room is holding, for a platform operator: the roster with each
  person's role, presence, counts and last connection report, the door, the sockets, the alarm and
  which of its deadlines are pending, the storage size, the routing sessions, the ended marker. One
  pass over storage, and it changes nothing.
- `sfu/sfu-client.ts` — the client for Cloudflare Realtime's selective forwarding unit, and the test
  seam a meeting-room test installs a fake through.
- `sfu/turn-credentials.ts` — minting relay credentials from Realtime's TURN service, shared with
  `routes/tools-turn-credentials.ts`.
- `sfu/realtime-failure.ts` — one failure through the standard pipeline, answering with the Error ID
  the member is shown.

## Local rules

- **The frames come from the protocol package, never from here.** Every schema, builder, refusal
  reason and constant on the wire is `@magna-carta/meeting-protocol/frames`, which the browser
  imports too. A frame shape declared in this directory is a second declaration of a contract that
  has one, and the fitness function in that package will not see it.
- **A concern is a module, and the Durable Object class is not where a new one goes.** The next slice
  — recording, breakout rooms — adds a file under `room/` and a line of wiring, not a
  method on `MeetingRoom`. Each module takes `RoomContext` explicitly so it can be driven without the
  runtime.
- **Nothing about a participant may live on the instance.** Class properties do not survive
  hibernation. Everything a frame needs rides on the per-socket attachment; everything the room needs
  is read back out of storage on each call, which is why `RoomContext` is built per call rather than
  held as a field.
- **The roster is read at most once per frame.** In a room of three hundred that read is three
  hundred keys. Every function here that needs it takes the map the caller already paid for rather
  than reading storage again.
- **What restates itself is DROPPED; what does not is REFUSED.** The presence throttle discards a
  transition inside its window and keeps the stored booleans current, which is safe because a
  presence frame carries the whole of what it is about — an unsent one loses nothing a later one
  restates, and a `sync` is a request the asker repeats. A raised hand and a reaction have no later
  frame to carry them: a hand may be the last thing somebody does for ten minutes, and a reaction is
  a single act. So both answer to `SIGNAL_INTERVAL_MILLISECONDS` and the frame inside the window is
  refused `rate-limited` with the socket kept open. That reason is on the wire, and the interval is
  too, because a client that paced itself differently would be refused for behaving correctly.
- **EVERY frame spends from the socket's own budget first, and the budget is on the wire.** The
  per-frame rules below bound one kind of frame against one cost; none of them bounds a browser that
  sends something ELSE as fast as it can write. So `dispatchClientFrame` takes a token from a bucket
  carried on the socket's attachment (`FRAME_BUDGET_PER_SECOND` / `FRAME_BUDGET_BURST` in the
  protocol package, because a client that paced itself differently would be refused for behaving
  correctly) BEFORE the frame is parsed — a frame the room will not read must not buy it a parse of
  up to the frame ceiling — and answers `rate-limited` with the socket kept open. It rides the
  attachment rather than the participant record on purpose: the budget is about one connection, and
  a bound that cost a storage read and a storage write per frame would cost what it is bounding. Its
  refusals are SAMPLED into telemetry (`FRAME_BUDGET_REFUSAL_SAMPLE_EVERY`) for the reason the
  storage budget is — a flood recorded frame-by-frame costs more than the flood — while every
  refused frame is answered on the wire, because a browser that is told nothing cannot slow down.
- **An act that costs the ACCOUNT carries a window of its own, claimed past every refusal and ahead
  of the session.** `publish`, `subscribe`, `renegotiate` and `close` are each a billed call to the
  routing service, and nothing on the frames bounds how often one may be sent — the track ceiling
  bounds what a participant may HOLD. Each carries its instant on the participant record beside
  `syncAt` and `layerAt`, and each is REFUSED rather than dropped inside its window, because the
  browser is waiting on an answer to it: a dropped publish is a camera that never appears. A request
  to unmute carries the same shape with the window kept on the member being ASKED, since two hosts
  taking turns would each stay inside a budget of their own while one person's screen filled up.
- **A frame that costs the ROOM is throttled per participant; a frame that costs the sender is not.**
  A `sync` is a read of every key the room holds and a `layer` is a call to the routing service, and
  a browser can send either as fast as it can write to a socket — so each carries its own instant on
  the participant record and a frame inside the window is dropped. Presence is the one that is
  DEFERRED rather than dropped, because it is a fact about somebody that stays wrong until it is
  sent; a sync is a request the asker repeats, and a layer change is superseded by the next one.
  Nothing is refused on the wire for being too fast: a refusal reason is a vocabulary every browser
  has to learn to treat as non-fatal.
- **A socket is in the room when it has been welcomed, and not when it has been accepted.** The
  runtime has to own a socket before the roster can be written, so between the two it is already in
  `getWebSockets()` — and a difference broadcast at it is a gap the browser can only close by asking
  for the whole list. `admitParticipant` raises `welcomed` on the attachment the instant the welcome
  is on the wire, and `broadcast` skips everything else.
- **Ask who is connected once a pass, never once a participant.** Reading a socket's attachment
  deserializes it, so a walk per participant is quadratic in the room; `connectedAttendanceIds`
  resolves the whole answer in one pass and every caller that needs it for more than one person
  takes the set.
- **A frame the room will not act on costs the routing service nothing.** The refusals answerable
  from the roster are decided before a session is resolved and before anything is forwarded — the
  service has no notion of a meeting and would honour a subscription to any session in the fleet.
- **A host frame is authorized from the STORED participant record, and a RECONNECT does not reseed
  it.** The attachment is written once at upgrade and frozen there, which is right for the
  firm, the meeting and the medium — none of which can change under a socket — and wrong for
  hosting, which is exactly the thing that changes during a meeting. A co-host whose grant was
  withdrawn ten minutes ago would go on muting people for as long as their socket stayed open. So
  the hosting routes tell the room after they commit, the room rewrites the roles on the stored
  records and broadcasts the roster, and the next frame off that socket is decided on what is true
  now. The upgrade still SEEDS the field for a stay the room has never seen, because the route has
  just read the grants to authorize the socket at all; seeding is not authorizing. It does NOT seed
  over a record that already exists: the route reads the grants a moment before the upgrade, so a
  withdrawal landing in between would be undone by the reconnect for as long as that socket stayed
  open. `hostingChanged` is the only writer of truth here after the first welcome, and the welcome's
  own lobby list is decided from the same answer.
- **An act that somebody could later ask about is a route, not a frame.** Removing a participant,
  shutting the door and changing who is hosting are `routes/meeting-hosting.ts` with audit rows
  through the firm-scoped data-access layer. A mute, a request to unmute and a spotlight are frames:
  each is about this moment, a mute is undone by the member a second later, and an audit row for
  each would fill a matter's log with the mechanics of a conversation — which is the one thing this
  subsystem has been careful not to record. A frame is still not anonymous: every directive carries
  the handle of the host who sent it.
- **A mute is two halves, and neither is optional.** The room closes the target's audio at the
  routing service — so the sound stops reaching anybody whatever their browser does — and sends them
  `muted` so their screen says what happened and by whom. A mute that only asked the browser nicely
  would be a mute the browser could decline, and un-muting afterwards republishes the microphone
  because the track is genuinely gone. Muting the whole room spends ONE roster broadcast and a
  bounded concurrency lane, never one broadcast and one upstream round trip per person in series.
- **A WAITER IS NOT FILTERED OUT OF THE ROSTER; THEY ARE NOT IN THE SET IT IS MADE OF.** A waiting
  participant is stored under `waiting:<attendanceId>` and never under `participant:`, so
  `storedParticipants()` — the one read every roster, delta, subscription check and broadcast is
  built from — cannot include them. A filter would have to be re-applied by every future reader and
  would be wrong the first time one forgot. The second half of the same guarantee is `broadcast`,
  which skips any socket that has not been welcomed: a waiting socket never is, so a roster frame
  cannot reach it even by accident — and `endMeeting` therefore has to tell the door separately,
  because "the meeting is over" is the one piece of news a waiter shares with the room.
- **A waiting socket may send `ping` and `leave` and nothing else**, and the refusal is decided in
  `room-frames.ts` before the throttles, before the roster is read and before a routing session is
  resolved. The service has no notion of a meeting and would honour a subscription to any session in
  the fleet, which is exactly what somebody standing outside a confidential matter discussion must
  not be able to reach. The socket stays open: they are at the door, and the door may open.
- **The media never crosses this directory.** Audio, video and screen share go directly between a
  browser and Realtime. Nothing here has a redaction step because there is nothing here to redact —
  and an upstream body is never carried into a refusal, because it can name the application the whole
  fleet's meetings run on.
- **A direct reply to one socket goes through `trySend`, never `socket.send`.** `send` on a closed
  socket THROWS, and a throw out of `webSocketMessage` does not fail one frame — the runtime resets
  the object, which drops every socket in the meeting. So one member's browser closing between the
  room deciding to answer them and the answer going out would end the meeting for everybody. The
  room-wide broadcast has swallowed that since it was written; the direct replies had not, and the
  load harness is what surfaced it. One home: `room-state.ts`.
- **Every act the room takes records ONE event, and the counts are part of the act.** The family is
  `meetings.room.*` in `@magna-carta/telemetry`'s catalog, which is where what may be recorded is
  decided — there is no declared field for a display name, a track name or a session description, so
  a call site cannot add one without adding it to the catalog first. Two things are deliberately not
  recorded per occurrence, because they are the frames a room of three hundred sends most: presence
  is recorded once per coalesced flush with the count it covered, and what a frame spends in storage
  is SAMPLED (`STORAGE_BUDGET_SAMPLE_EVERY`). A record that costs what the thing it measures costs is
  not a record.
- **A branch about FAN-OUT is decided over the sockets; a branch about the ROSTER is decided over
  the roster.** The roster difference reads `storedParticipants()` because it is about who is in the
  meeting. The reactions branch does not: it is choosing between one frame per reactor and one frame
  for the room, which is a question about the sockets a frame would actually reach — and a roster
  read there would spend three hundred keys on every reaction in exactly the room the coalescing
  exists for. `welcomedSocketCount` is that measure, and the load harness reports `lists/reaction` at
  zero because of it.
- **A room-level fact the ALARM waits on is reconciled in `armAlarm`, not only armed for.**
  `armAlarmFor` brings the alarm forward for a deadline the caller already knows, which is what keeps
  a sub-second window off the full reconciliation. But every wake ends by re-arming from the
  reconciliation alone, so a deadline missing from it is a deadline that survives exactly until the
  next wake for something else. The reaction bucket is in both places for that reason, and its cost
  there is one `get` rather than a pass over anything.
- **An operator's read is the platform-operator guard, never a firm permission — and it is
  AUDITED.** A capability that let a member read the room's internals would be a capability to read
  a colleague's connection quality and their place in the meeting.
  `routes/meeting-inspect.ts` runs in the same lane `routes/platform-status.ts` does, and names the
  firm in the query because there is no session firm to read — the one meeting route that does, and
  only because its caller belongs to no firm. Because nothing else in this platform lets one person
  see into another firm's live conversation, the read writes an `auth_audit` row — on the control
  plane, where the other platform-operator acts are recorded, since the firm being read could
  neither explain nor attribute a row of its own — before the room is read, carrying the operator,
  the firm and the meeting and nothing the answer itself contains.

## The load harness — the room's fan-out cost as a number

Every rule this directory is built around is a claim about what happens at three hundred: the roster
is read at most once per frame, a join above `ROSTER_DELTA_THRESHOLD` costs each other socket one
frame, a burst of presence costs one wake rather than one frame per transition. The driver is
`test/support/meeting-room-load.ts` and it drives real socket pairs against the real object in the
test pool — everybody arrives, everybody publishes, everybody talks at once, the gallery turns a
page, a tenth of the room reconnects, the host ends it.

- **The fast variant (forty clients) runs in the ordinary suite**, `test/meeting-room-load.test.ts`,
  as an assertion on the two bounds: frames per join per socket at or above the delta threshold, and
  storage lists per frame.
- **The full variant is run by hand**, and it is the same driver:

  ```
  VITE_MEETING_ROOM_LOAD_PARTICIPANTS=300 \
    pnpm --filter @magna-carta/api-worker exec vp test run test/meeting-room-load.test.ts \
    --reporter=verbose
  ```

  The `VITE_` prefix is load-bearing: the test file is evaluated inside workerd, which has none of
  the host's environment, and Vite's env pass is what carries a prefixed variable across. The
  verbose reporter is what shows the printed line — the default one hides a passing test's output.

**The counts are the result and the wall time is not.** This runs against Miniflare on whatever
machine is free, so a duration is a fact about the machine where frames per socket and lists per
frame are facts about the room. Print the line into a pull request when a change touches the
broadcast, the throttles or the alarm.
