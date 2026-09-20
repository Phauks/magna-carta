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
  transition of a burst.
- `room/room-media.ts` — the routing-service session opened on first use, the four acts that reach
  that service (publish, subscribe, layer, close), the tracks the roster remembers because of them,
  and the release that stops the forwarding when somebody is gone.
- `room/room-lifecycle.ts` — arriving (and superseding the socket that held the stay), dropping (the
  per-person grace), ending, and the one alarm three deadlines share: each person's grace, the
  retirement of the ended marker, and the end of a presence throttle's window.
- `room/room-frames.ts` — what one frame means: parse, identify the socket, answer what the roster
  can answer, refuse what the roster refuses, and only then dispatch to the modules above.
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
  — host controls, the lobby, recording — adds a file under `room/` and a line of wiring, not a
  method on `MeetingRoom`. Each module takes `RoomContext` explicitly so it can be driven without the
  runtime.
- **Nothing about a participant may live on the instance.** Class properties do not survive
  hibernation. Everything a frame needs rides on the per-socket attachment; everything the room needs
  is read back out of storage on each call, which is why `RoomContext` is built per call rather than
  held as a field.
- **The roster is read at most once per frame.** In a room of three hundred that read is three
  hundred keys. Every function here that needs it takes the map the caller already paid for rather
  than reading storage again.
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
- **The media never crosses this directory.** Audio, video and screen share go directly between a
  browser and Realtime. Nothing here has a redaction step because there is nothing here to redact —
  and an upstream body is never carried into a refusal, because it can name the application the whole
  fleet's meetings run on.
