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
- `src/types.ts` (`@magna-carta/meeting-protocol/types`) — `RosterParticipant`,
  `WaitingParticipant`, `MeetingRoomState`, `MeetingSpotlight`, `PreferredRid`, `MeetingMedium`,
  `MeetingHostRole`, `MeetingLobbyMode`, `MEETING_REACTIONS`, `MeetingChatMessage`, and the poll and
  question snapshots (`MeetingPollSnapshot`, `MeetingQuestionSnapshot`) the values the frames are
  made of. The string unions among them are twins of the domain's own — see the note in
  the file.
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
  to agree on it byte for byte; if only one end reads it, it belongs to that end. Two numbers have
  been kept out on that test and are worth naming, because both look like they belong:
  `MUTE_ALL_CONCURRENCY` (a lane width inside the room) and `MAX_MEETING_LOBBY` (the door's ceiling,
  in `@magna-carta/meetings/lobby-types`) — a browser draws whatever the `waiting` frame carries and
  never divides by the ceiling.
- **A frame that reaches only some sockets says so here, because both ends have to agree on it.**
  `lobby` and `admitted` go to a socket that is WAITING and to nobody else; `waiting` goes to the
  sockets holding a grant and to nobody else; `muted` and `unmute-requested` go to the one person
  they are about. The room enforces it — this package cannot — but a reader of the builder has to
  know, or the browser ends up handling a frame it will never receive and not handling one it will.
- **This package never depends on `@magna-carta/meetings`.** That package reaches a database, and a
  browser bundle cannot take one. `MeetingMedium`, `MeetingHostRole` and `MeetingLobbyMode` are
  therefore declared in both, as identical string unions that meet at the seam that carries them —
  structurally the same type, so a mismatch is a type error at that seam rather than a silent
  divergence. See the note in `src/types.ts`.
- **The keepalive pair has a twin in the Worker** (`apps/api-worker/src/progress/job-progress-protocol.ts`)
  and the bytes must stay identical, because the runtime's WebSocket auto-response matches them
  exactly. The equality is asserted in `apps/api-worker/test/meeting-room.test.ts`, which is the only
  place both modules are reachable at once.
- **A REACTION IS NAMED BY ITS MEANING AND DRAWN BY A GLYPH, and the two lists are separate on
  purpose.** `MEETING_REACTIONS` is the whole vocabulary and a `reaction` naming anything else does
  not parse — closed rather than open, because a free string or an emoji code point would put
  arbitrary text on a tile in a firm's meeting, and because this product draws no emoji anywhere.
  What is on the wire is never the ICON's name: an icon package renames its glyphs between releases,
  so a name taken from one would make upgrading the drawing a change to this protocol. The mapping
  lives in one table in the browser's reactions module. A seventh reaction is a protocol change and a
  deliberate act.
- **A throttle that DROPS needs no vocabulary; one that REFUSES needs both ends.** Every other
  throttle in this room discards a frame inside its window and says nothing, which is safe because
  those frames restate themselves. A hand and a reaction do not — a hand may be the last thing
  somebody does for ten minutes, and a reaction is a single act with no later frame to carry it — so
  they are refused `rate-limited` instead, socket open. That puts two things HERE that a dropping
  throttle keeps to itself: the reason, which the client has to learn to treat as non-fatal, and
  `SIGNAL_INTERVAL_MILLISECONDS`, because a client that paced itself by a different number would be
  refused for behaving correctly. The room's own coalescing window is deliberately NOT here, by this
  package's own test: a browser draws whatever arrives and divides by nothing.
- **A copy of a committed row travels in the read's own shape, and has no client frame.** `message`,
  `poll-opened`, `question-asked` and `question-updated` carry the record exactly as the route's read
  returns it, less any field that is about one reader (`answeredByCaller`, `upvotedByCaller`), so a
  browser applies the frame and the read with one code path. Every act behind them is a ROUTE, so the
  browser sends nothing new on the socket for any of them. The two tallies (`poll-tally`,
  `question-tally`) are coalesced by the room to a frame a second and carry the latest count, not a
  difference.
- **A caption is a display, and its frame says so.** `caption` carries the words, who said them (the
  stay, the roster's name, and the member's identifier on a member's socket only) and a `segmentId`
  that every interim of one stretch of speech shares and its final settles — opaque, so a browser keys a
  line by it and never orders by it. The room stores none and sends each once; a browser that misses
  one draws the next. Whether captions are on is the room state's `captions`, ABSENT while off, and the
  host's switch is the `captions` client frame, refused `captions-unavailable` where the firm or the
  deployment does not allow them. The pace of captions (coalesced interims, the room-wide budget) is the
  server's alone and deliberately not here: a browser draws whatever arrives.
- **A frame whose browser half lands in a later change is LISTED, never silently half-wired.**
  `AWAITING_THE_BROWSER` in `test/frames-have-handlers.test.ts` names `captions` and `caption` while the
  caption strip is unbuilt; the room-side and builder checks still read them, and the register fails
  the moment the browser names one — so the entry comes off in the change that wires it.
- **The encrypted meeting's group frames carry bytes the room cannot read.** `mls-key-package`,
  `mls-commit` and `mls-proposal` go both ways and `mls-welcome` comes from the room; the bytes are
  base64 of MLS messages from `crates/mls-core`, and the only plain facts are the ones the room routes
  by (the epoch, and the stays a commit adds and removes). They reach the sockets of stays in the group
  and nobody else. `stale-epoch` and `not-in-group` are their two refusals, both non-fatal. A welcome
  at the room's ceiling of three hundred is about 80 KB of base64, which is why
  `MAX_MEETING_FRAME_BYTES` is a quarter of a megabyte.
- **A chosen name is a frame, and the original rides beside it.** `rename` carries a trimmed name
  (1 to `MAX_MEETING_DISPLAY_NAME_LENGTH`, no control characters) or null for the name the person
  came in with; the room keeps it on the participant record (so it survives a reconnect and dies with
  the room), paces it on the hand's window, and every roster row carries `accountName` while a chosen
  name is in use. The meeting's record of who attended never sees a chosen name.
- **The version is stated, never negotiated.** `MEETING_PROTOCOL_VERSION` rides on every frame in
  both directions and is bumped only when a shape changes incompatibly.
