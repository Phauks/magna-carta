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
- `media-effects.ts` — the stage between capture and publish, reached through
  `MeetingClientSeams.createMediaEffects`: what to capture with (the microphone's treatment asked for
  by name, as plain booleans and never `exact`), the three-valued read-back of what the track did, the
  blur probe, and `passThroughEffects`, the identity on the stream with that description attached. A
  stage that throws leaves the member published unprocessed, never not at all. The member's choice is
  `meeting-effects-preference.svelte.ts` beside this directory, kept per browser.
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
- `guest-devices.ts` — the device check a guest makes at the door: the seams it reaches the browser
  through, the pickers' device lists, and `withChosenDevices`, which is how the choice reaches the
  room's own capture by wrapping `getUserMedia` on `MeetingClientSeams` rather than by teaching the
  client about a picker.
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
  and a row, never a frame — and `noteMessageFrame` / `noteMessageRedacted` are the doors the room's
  relay lands in. The poll is the BACKSTOP rather than the path once a frame has arrived: it
  stretches from three seconds to fifteen, and it never stops, because the read is what catches a
  browser up on the frames it did not get.
- `reactions.svelte.ts` — a raised hand and a thrown reaction: the two signals that are relayed and
  never stored. The outgoing window both are paced against, the re-send of a settled hand after a
  `rate-limited` refusal, the bubbles and their dwell, the coalesced counts a large room draws
  instead, and the pure sort that puts a host's queue in the order the hands went up. The DWELL is a
  client constant because only the browser reads it, and it reaches the design system's motion
  recipe as `--mc-reaction-dwell` rather than being written down a second time in CSS.
- `recording.svelte.ts` — a recording of the meeting: whether one runs, the announcement that is the
  consent mechanism (a synthesized tone, the words spoken where the browser can, a dismissible banner,
  and the same sentence in an assertive live region), and Record and Stop over the screen's routes
  (`recordThrough`). THE ROOM'S FRAME LIGHTS THE MARK, NEVER THE MEMBER'S PRESS: the `recording` frame
  and the welcome's `recording` field are the only things that light or clear it. EVERY WELCOME
  CARRYING A RUNNING RECORDING IS TOLD, a rejoin into the same one included: the banner is drawn and
  the live region written again, because the room records each welcome as an occasion the person was
  told and the socket that came back may be at another device. The tone and the voice sound once per
  recording on this page — which one was announced aloud survives a lost socket — so a flaky
  connection does not chime every few seconds. The live region is EMPTIED AND REWRITTEN a moment
  later on every announcement, because an assertive region does not re-read text identical to what
  it already holds and the accessibility tree updates only when the browser renders. The sounds are a
  seam (`MeetingClientSeams.createRecordingSounds`, silent by default) with an audio context of its
  own, because the meter's does not exist for a member who published no microphone. THAT CONTEXT IS
  OPENED INSIDE A PRESS, NEVER AT THE CHIME: Safari and iOS leave a context made outside a gesture
  suspended, so the screens call `unlockRecordingSounds()` first thing in Join and Rejoin (before
  anything is awaited) and from any press in the room, and a chime on a context that is not running
  schedules nothing rather than a tone that plays late.
- `polls.svelte.ts` and `questions.svelte.ts` — the other two RECORDS, on chat's terms: routes and
  rows, relayed by the room as copies (`relayPollsTo` / `relayQuestionsTo`). NO READ ON A TIMER WHILE
  THE SOCKET IS HEALTHY: a full read on arrival and on reconnect, a read when a panel opens (forward
  from the last row a read reached, by `since`/`sinceId`, merged by id), and a one-minute backstop
  only while the socket is down — three hundred browsers re-reading every few seconds is the read
  storm the relay exists to avoid, and it spends the firm's rate-limit budget. A poll's counts only
  ever grow, so the doors are merged by keeping the larger; the question queue is sorted here,
  unanswered then upvotes, so it moves on a tally frame without a read. Whether THIS member answered
  or upvoted comes from the read and their own press, never from a frame. A poll waits for an answer
  from everyone but the member who opened it, hosts included.

**`screen/` — what is drawn.** `meeting-reactions.svelte` (the control-bar menu of six),
`recording-mark.svelte` (the static Recording badge drawn in the header of the room and guest pages
while the room says a recording runs, and beside a recorded meeting's row and calendar entry from the
summary's `recordingState`), `recording-notice.svelte` (the one dismissible banner both pages draw
from the recording concern), `meeting-reaction-mark.svelte` (the ONE table mapping a reaction's name to a Lucide glyph, and the
rising mark), `meeting-reaction-counts.svelte` (the strip a large room draws instead of bubbles) and
`meeting-hands-panel.svelte` (the host's ordered queue) are the raise-hand and reactions surfaces.
`meeting-polls-panel.svelte` (the cards, the tally, and a host's New Poll form, Close and who
answered) and `meeting-questions-panel.svelte` (the queue and the composer) are reading
`ActionDialog`s on the lobby panel's precedent, where the design named a sheet.
`meeting-tiles.ts` projects the client's state into tile models and
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
contract, chat's three and the calls for polls and questions included, with the seams those two
records take), `meeting-list.ts` / `meeting-list-section.svelte` / `meetings-screen.svelte` (the Meetings
page), `meeting-attendance.ts` / `meeting-attendance-panel.svelte` (who was in an ended meeting,
members and guests in one record), `meeting-guests-panel.svelte` (the host's Guests panel: who on
the event may be sent a link, and the send, replace and withdraw acts), and
`meeting-entry-action.svelte` (Start or Join, and Guests, on a calendar entry).

**The guest's side, outside the application:** `guest-api.ts` (the guest's own calls on the link's
token or the arrival's grant, the host's four guest calls, the chat seams for a guest, and the one
table of what a refused link says; every call sends `credentials: "omit"` and
`referrerPolicy: "no-referrer"`, because the page's own address carries the link's secret),
`guest-failure.svelte` and `guest-render-boundary.svelte` (the guest page's own crash screen: an
Error ID, a Reload, no route and no link into the application; the root layout picks it for every
address under `/join`), `guest-arrival.svelte` (the name at the door and the device
check) and `guest-meeting.svelte` (the whole of a guest's page: the door, the member's waiting
surface, and the room with the identifiers taken out). The route is `src/routes/join/[token]/`,
outside the `(app)` group.
`meeting-client.svelte.ts` at the top level is a re-export of `client/meeting-client.svelte.ts`, kept
so those modules can take the `MeetingMedium` union without reaching into the room's own directory.

## Local rules

- **A guest's page is structurally unable to reach the application.** It lives outside `(app)`, so
  it inherits no shell, no session bootstrap and no back-navigation registry; every guest call sends
  `credentials: "omit"`, so a member session the same browser holds never rides along; and nothing
  on it links into the application. A component added to it that reads a member route, or a header
  that offers a way back, breaks the one property the whole arrangement rests on.
- **The room a guest sees is the member's, with the identifiers out.** `MeetingClient`, the tiles,
  the controls and `meeting-lobby-wait.svelte` are reused unchanged; the roster takes
  `showIdentifiers={false}`, and the controls take `canEnd={false}` and `hosting={false}`. A guest
  variant of any of those is a second place to keep a sentence right.

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
- **A refusal is not the end of a meeting unless it says so.** Six reasons end it
  (`not-a-participant`, `meeting-ended`, `superseded`, `removed`, `denied`, and `withdrawn`, which a
  guest receives when the firm takes their link back); every other one leaves
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
- **A HAND AND A REACTION ARE REFUSED, NEVER DROPPED, AND THAT IS WHY THE BROWSER PACES ITSELF.** A
  presence frame carrying only `speaking` and `muted` states the whole of what it is about, so the
  room may discard one inside its window and lose nothing a later frame does not restate. A hand and
  a reaction are single acts with nothing behind them — dropped, a raised hand is never relayed and
  the host never learns somebody wants the floor — so the room answers `rate-limited` with the
  socket open instead. This browser's half is `reactions.svelte.ts`: it paces against
  `SIGNAL_INTERVAL_MILLISECONDS`, and where it is refused anyway it sends the SETTLED hand again
  once the window passes. A reaction is not re-sent — it was thrown at a moment that has passed.
- **THE HAND'S INSTANT IS THE ROOM'S WHERE THERE IS ONE, AND THIS BROWSER'S WHERE THERE IS NOT.** A
  roster row carries `handRaisedAt`, so a browser arriving late sorts the queue from the roster
  alone; a `presence` frame carries the boolean without the instant, because it is a small frame
  about a change rather than a restatement of a record. A hand learned that way is stamped where
  this browser learned of it — the same fallback `#lastSpokeAt` keeps, for the same reason — and a
  hand with no stamp at all sorts LAST, because putting it first would hand the floor to whoever the
  room said least about.
- **THE MICROPHONE'S MEDIA SECTION IS REUSED, NEVER ADDED TO.** A host's mute takes the track away at
  the routing service, so coming back is a fresh offer and a fresh `publish` — but on the SAME
  section. A meeting where a host mutes the room every few minutes is a meeting where a member
  returns many times, and a section per return grows the session description without bound, with
  every renegotiation after it carrying the whole accumulated list. The mid is also what every later
  frame addresses the sound by. `#microphoneMid` is what is reused; the old section is already
  closed at the far end by the mute itself, so nothing here asks the room to close it twice.
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
