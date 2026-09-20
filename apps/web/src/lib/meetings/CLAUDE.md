# The meeting interface — CLAUDE.md

**Purpose.** This directory is the BROWSER side of a meeting: the client that holds one peer
connection and one signaling socket and the state a screen renders from, the screen that renders it,
and the list of meetings a firm has. Media never crosses a Worker — this client publishes its own
microphone, camera and screen to Cloudflare Realtime and pulls everybody else's back, while the
`MeetingRoom` Durable Object brokers the roster and speaks to that service on this browser's behalf.

**Spec:** [`docs/specs/2026-09-18-meetings-design.md`](../../../../../docs/specs/2026-09-18-meetings-design.md)
(_The screen_, _Large rooms_, _Structure for growth_). **The wire:**
[`@magna-carta/meeting-protocol`](../../../../../packages/meeting-protocol/CLAUDE.md). **The server
half:** [`apps/api-worker/src/meetings`](../../../../api-worker/src/meetings/CLAUDE.md).

## The module map

**`client/` — the state machine.** Nothing in it touches `navigator` or `window`; every external
edge is a constructor seam, so the whole machine runs under a test with fakes.

- `meeting-client.svelte.ts` — the runes class: the state a screen renders from, and the wiring that
  turns one module's answer into another's question. It composes; it does not implement.
- `signaling.ts` — the socket: what goes out, what comes in, the keepalive, the `sync` that asks for
  the whole roster again, and the readers that turn a frame into the shapes the rest works in. The
  one handler per room frame lives here, which is what the protocol package's fitness function reads.
- `negotiation.ts` — the one peer connection and the serialized chain every description is applied
  on. Two applied concurrently is an invalid-state error the browser reports from whichever one lost.
- `subscriptions.ts` — what is actually coming in, held against what the plan wants: the pulled-track
  bookkeeping keyed by session AND name, the reconcile pass, the debounce window, and layer changes.
- `subscription-policy.ts` — the pure function that decides what should be coming in and what the
  gallery draws. Facts in, a plan out; a room of three hundred is a unit test rather than a rehearsal.
- `capture.ts` — what this browser captures and how it is offered: the constraints a medium calls
  for, the camera's three simulcast layers, the screen share's single one.
- `media-effects.ts` — the stage between capture and publish. The identity today; the seam is here so
  that a processing stage does not have to be retrofitted into every caller that reaches for
  `localStream`.
- `presence.ts` — the meter on this browser's own microphone, and the transition test that keeps a
  presence frame from being sent twice.
- `audio-level-meter.ts` — the analyser itself, which is a device and therefore a seam.

**`screen/` — what is drawn.** `meeting-tiles.ts` projects the client's state into tile models;
`meeting-grid.svelte`, `meeting-tile.svelte`, `meeting-roster.svelte`, `meeting-controls.svelte` and
`meeting-audio.svelte` draw them. The room screen itself is
`src/routes/(app)/meetings/[id]/+page.svelte`.

**Beside them, and not part of the room:** `meetings-api.ts` (every read and write, mirroring the
contract), `meeting-list.ts` / `meeting-list-section.svelte` / `meetings-screen.svelte` (the Meetings
page), and `meeting-entry-action.svelte` (Start or Join, on a calendar entry).
`meeting-client.svelte.ts` at the top level is a re-export of `client/meeting-client.svelte.ts`, kept
so those modules can take the `MeetingMedium` union without reaching into the room's own directory.

## Local rules

- **The frames come from the protocol package, never from here.** Every frame name, refusal reason,
  cap and version on the wire is `@magna-carta/meeting-protocol`, which the room imports too. This
  client used to re-declare them by hand — a browser bundle cannot import from a Worker — and each
  slice added frames to both ends by prose agreement. That is the drift the package exists to close;
  a frame literal written in this directory is outside it.
- **A concern is a module, and the client class is not where a new one goes.** Host controls, a
  lobby, a recording mark, a connection-quality sample — each is a file under `client/` with a stated
  seam into the class, not another set of fields on it.
- **What is pulled is decided by the pure function, never by the client.** `subscriptionPolicy` takes
  facts and returns a plan; `subscriptions.ts` only makes the plan true. A rule about who is shown or
  what is asked for that is written anywhere else is a rule no test can reach with three hundred
  people in the room.
- **Every external edge is a seam on `MeetingClientSeams`.** The peer connection, the socket,
  capture, the empty stream, the level meter. Adding a browser global anywhere in `client/` is what
  makes the next case untestable.
- **A refusal is not the end of a meeting unless it says so.** Three reasons end it
  (`not-a-participant`, `meeting-ended`, `superseded`); every other one leaves the socket open, the
  roster arriving and the member in the room, with a sentence on the screen.
- **Screen components take models, not the client.** `meeting-tiles.ts` is the one projection from
  the client's state to what is drawn, so a component never reads the state machine directly.
