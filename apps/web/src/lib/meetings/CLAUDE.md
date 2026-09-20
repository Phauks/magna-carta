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
- `meeting-clock.svelte.ts` — the ticking `now` the policy ages recent speakers against. It exists
  because the five-minute window is the one input to the plan that nothing in the room changes: read
  off the system clock as the plan is worked out, it only closes when something else happens, so a
  room that has gone quiet never lets its last speaker go.
- `capture.ts` — what this browser captures and how it is offered: the constraints a medium calls
  for, the camera's three simulcast layers, the screen share's single one.
- `media-effects.ts` — the stage between capture and publish. The identity today; the seam is here so
  that a processing stage does not have to be retrofitted into every caller that reaches for
  `localStream`.
- `host-controls.ts` — running the meeting from inside it: the four directives a host sends, the
  reader for what the room says about itself, and the two sentences a member reads when a host acts on
  them. A concern is a module, so none of it is a set of fields on the client.
- `lobby.ts` — the door: where somebody waiting stands, who is at it for a host, and the two answers
  a room gives a socket that is not through it yet (`denied`, which is fatal, and `not-admitted`,
  which is a notice). It is also the one home for what a lobby mode string off the wire means, which
  `host-controls.ts` reads rather than answering a second time.
- `presence.ts` — the meter on this browser's own microphone, and the transition test that keeps a
  presence frame from being sent twice.
- `audio-level-meter.ts` — the analyser itself, which is a device and therefore a seam.
- `connection-quality.ts` — the pure reading of one `RTCStatsReport` against the one before it, and
  the thresholds a mark is judged by. Counters in, rates over the interval out; nothing in it
  touches a browser, so the numbers that decide whether a member is told their meeting is poor are
  argued with in a unit test rather than by sitting in a bad meeting.
- `diagnostics.svelte.ts` — the sampling, the two short rings (five minutes of samples, the last
  sixty wire events), the redacted snapshot every surface reads, and the `diagnostic-report` frame
  that puts the NUMBERS on the wire once per the room's own window. It is also the
  `DiagnosticsSink` signaling and subscriptions emit through — a seam with a no-op default, so
  neither of them knows diagnostics exist.
- `chat.svelte.ts` — what is being said in writing: the transcript, the poll that follows it from
  its own cursor, saying something, taking something back, and the count of what arrived while the
  panel was closed. It is the one thing in this directory that is a RECORD — a message is a route
  and a row, never a frame — and `noteMessageFrame` is the door the room's later relay lands in.

**`screen/` — what is drawn.** `meeting-tiles.ts` projects the client's state into tile models and
`meeting-connection.ts` projects its diagnostics into the connection surface's models;
`meeting-grid.svelte`, `meeting-tile.svelte`, `meeting-roster.svelte`, `meeting-controls.svelte`,
`meeting-quality-mark.svelte`, `meeting-connection-panel.svelte`, `meeting-chat-panel.svelte` and
`meeting-audio.svelte` draw them, and `meeting-host-labels.ts` is the one home for what a role and a spotlight are CALLED, because
four surfaces drawing the same badge is four spellings of "Co-host". The room screen itself is
`src/routes/(app)/meetings/[id]/+page.svelte`.

**Beside them, running the meeting:** `meeting-host-menu.svelte` (the per-tile and per-row menu, one
component for both places), `meeting-hosts-panel.svelte` (who holds a grant, and the claim),
`meeting-lobby-panel.svelte` (who is at the door, and the host's two answers for each of them) and
`meeting-lobby-wait.svelte` (what somebody standing at that door sees, which is not the room with
things missing). All of them take models and handlers rather than the client, like every other
screen component here.

**Beside them, and not part of the room:** `meetings-api.ts` (every read and write, mirroring the
contract, chat's three included), `meeting-list.ts` / `meeting-list-section.svelte` / `meetings-screen.svelte` (the Meetings
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
- **NOTHING IS CAPTURED AT THE DOOR.** A join answered `waiting: true` opens the socket and refuses
  the publish — in `publish()` itself, not in a branch a screen remembers to write — because a
  browser that lit the camera indicator for somebody standing outside a room would be taking a
  picture nobody asked for. The `admitted` frame is what owes the capture, and the `welcome` that
  follows it is what spends it, so an admitted member publishes exactly as they would have on an
  ordinary join.
- **Who is at the door comes off the WIRE, and a read may only fill a gap in it.** The room re-sends
  the whole list to every socket holding a grant as the queue moves, so `noteWhoIsWaiting` refuses
  to write over a list a frame has already stated. The one thing the frames cannot cover is a grant
  written AFTER the last arrival — a member named co-host at the twentieth minute is told the roster
  changed and nothing about the people already outside — and that is the only gap the read fills.
- **A refusal is not the end of a meeting unless it says so.** Five reasons end it
  (`not-a-participant`, `meeting-ended`, `superseded`, `removed`, `denied`); every other one leaves
  the socket open, the roster arriving and the member in the room, with a sentence on the screen.
  `not-host` and `not-admitted` are the two that are neither: nothing is wrong with this browser and
  nothing was refused about the meeting, so each is a notice rather than the band that reports a
  frame the room could not read.
- **A HOST'S MUTE TAKES THE TRACK AWAY; THIS MEMBER'S OWN MUTE DOES NOT.** The room closes the audio
  at the routing service, which is what makes it a mute rather than a request the browser could
  decline by ignoring it — so coming back is a fresh media section, a fresh offer and a fresh
  `publish`, and `#microphoneClosedUpstream` is what tells the two apart. A client that flipped
  `enabled` back would show itself as sending with nobody able to hear it for the rest of the
  meeting, and nothing anywhere would say so.
- **Who is running the meeting is read off the ROSTER, never held as a fact of its own.** The hosting
  routes rewrite the room's stored records and the room broadcasts, so a grant withdrawn mid-meeting
  takes the menus with it on the next roster rather than on a reload.
- **Screen components take models, not the client.** `meeting-tiles.ts` is the one projection from
  the client's state to what is drawn, so a component never reads the state machine directly.
- **Who is talking is held BESIDE the roster, never in it.** A roster row is a person's name, handle
  and track list and changes when somebody joins or leaves; `speaking` and `muted` change every time
  anybody starts or stops talking, which in a discussion is many times a second. Folded in, one
  presence frame replaced all three hundred rows and re-rendered every surface reading them. The
  client keeps them in their own map and `presenceOf` is how a surface asks — a mark drawn straight
  off a roster row is only ever as current as the last roster.
- **A MUTE MARK COMES FROM THE ROSTER, NEVER FROM A STREAM.** A browser pulls more microphones than
  it draws tiles and ranks the two differently, so a stream with no audio track in it is the
  ordinary state of somebody whose camera is on this page and whose voice is not among the ones
  being pulled. Reading that absence as "Muted" tells the room somebody is silent who is talking.
- **What the connection is doing NEVER BECOMES THE MEETING'S RECORD.** The samples and the wire
  events live in this tab and go when the meeting does. What leaves is the `diagnostic-report`
  frame, and it is numbers, counts and one enum — no session description, no display name, no track
  name, nothing a person typed — which the room aggregates through telemetry and keeps as the last
  sample on the participant record, where it dies with the room. A meeting's record is who was in
  the room and for how long, plus what was said in chat; how somebody's connection behaved is not a
  fact about the meeting and must never become one. The snapshot `report()` builds for the screen
  carries participant handles only, under the same rule.
- **A layer is settled by `layered`, never by having sent the frame.** The room drops a `layer`
  frame that follows too closely on the last one, so what the plan WANTS and what the unit is known
  to be sending are two maps, and every pass re-asks for whatever is still outstanding. The same
  shape holds the `sync` latch: an ask nothing answered lets go on its own, or it swallows every
  later gap in the meeting.
- **A roster or delta row is authoritative the moment it arrives.** The presence map is held beside
  the roster (above), and that is about not REBUILDING the roster — not about ignoring what it says.
  The room composes a row out of the presence it holds as it sends it and resets that on a rejoin,
  so a row naming somebody is the freshest thing there is about them. Only the rows a frame actually
  carried, though: a delta's merged list is mostly rows from earlier frames.
- **Nothing the room says about its contents is read before `welcome`.** A `presence` or a delta
  landing in that gap names somebody an empty roster does not hold, which is the shape of a frame
  gone missing — so the client asks for the whole list again, and every browser joining at the top
  of the hour does it at once. Only the frames about the socket itself (the hello, a refusal, the
  meeting ending) mean anything before it — plus the door's two, `lobby` and `admitted`, which are
  about the socket rather than the room and which a waiting socket receives INSTEAD of a hello. Held
  behind the welcome, those two would be held forever and the screen would sit blank behind a door
  that was open.
