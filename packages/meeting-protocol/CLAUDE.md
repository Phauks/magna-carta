# @magna-carta/meeting-protocol — CLAUDE.md

**Purpose.** This package is the WIRE between a meeting's two ends: the frame schemas, the builders,
the refusal vocabulary, the protocol version and the wire types a meeting's signaling socket carries.
It is imported by the `MeetingRoom` Durable Object in `apps/api-worker/src/meetings/` and by the
browser client in `apps/web/src/lib/meetings/client/`, and it is the only declaration of any of them.
Pure TypeScript with zod as its one runtime dependency — no database, no platform binding, no
browser API — because a browser bundle has to be able to take all of it.

**Spec:** [`docs/specs/2026-09-18-meetings-design.md`](../../docs/specs/2026-09-18-meetings-design.md)
(_Signaling_, _Structure for growth_). **Domain package:**
[`packages/meetings`](../meetings/CLAUDE.md) — the meeting row, attendance and chat, which this
package deliberately does not depend on.

## Key files / entry points

- `src/frames.ts` (`@magna-carta/meeting-protocol/frames`) — everything on the wire.
  - **Client → room**: the nine frame schemas behind `MeetingClientFrame`, the union's type names as
    a value (`MEETING_CLIENT_FRAME_TYPES`), and `parseMeetingClientFrame`, which is the whole parse
    surface — the byte cap first, then JSON, then the union, and an unknown type told apart from a
    malformed one.
  - **Room → client**: one builder per frame (`welcomeFrame`, `rosterDeltaFrame`, `refusedFrame`, …),
    each stamping the version, and `MEETING_ROOM_FRAME_TYPES`.
  - The vocabulary and the numbers both ends agree on: `MEETING_REFUSAL_REASONS`,
    `MEETING_PROTOCOL_VERSION`, `MAX_MEETING_FRAME_BYTES`, `ROSTER_DELTA_THRESHOLD`,
    `MAX_LAYER_TRACKS`, `TRACK_NAME_SEPARATOR`, the two close codes, and `PING_FRAME`/`PONG_FRAME`.
- `src/types.ts` (`@magna-carta/meeting-protocol/types`) — `RosterParticipant`, `PreferredRid` and
  `MeetingMedium`, the values the frames are made of.
- `test/frames-have-handlers.test.ts` — the repo-wide fitness function: every frame type declared
  here has a handler at the far end and a sender at the near one, named by the side that is missing
  it.

## Local rules

- **A frame is added here first, and in one place.** A new frame type is a schema in the union (or an
  entry in `MEETING_ROOM_FRAME_TYPES` plus a builder), and the fitness function then fails until both
  ends have somewhere to put it. That failure is the point: the slice that adds a frame is told about
  the end it forgot before it merges, rather than by a tile that never arrives.
- **Nothing that is not on the wire belongs here.** No roster storage shape, no policy about what a
  browser pulls, no SFU request body. The test of whether something belongs is whether both ends have
  to agree on it byte for byte; if only one end reads it, it belongs to that end.
- **This package never depends on `@magna-carta/meetings`.** That package reaches a database, and a
  browser bundle cannot take one. `MeetingMedium` is therefore declared in both, as two identical
  string unions that meet at the seam that carries them — see the note in `src/types.ts`.
- **The keepalive pair has a twin in the Worker** (`apps/api-worker/src/progress/job-progress-protocol.ts`)
  and the bytes must stay identical, because the runtime's WebSocket auto-response matches them
  exactly. The equality is asserted in `apps/api-worker/test/meeting-room.test.ts`, which is the only
  place both modules are reachable at once.
- **The version is stated, never negotiated.** `MEETING_PROTOCOL_VERSION` rides on every frame in
  both directions and is bumped only when a shape changes incompatibly.
