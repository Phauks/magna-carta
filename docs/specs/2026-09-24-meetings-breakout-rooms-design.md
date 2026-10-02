# Breakout rooms — a room of its own under the same meeting

**Status:** Design, 2026-09-24. Not started; sequenced after the guest slice lands, because both touch the stay-closing paths, the socket routes and the room's lifecycle module.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — the meeting record, the signaling room, the large-room rules (_Large rooms_), the structure every slice now builds to (_Structure for growth_), diagnosability and the per-socket frame budget. Everything it settles stands.
**Beside:** [`2026-09-20-meetings-host-controls-and-waiting-room-design.md`](2026-09-20-meetings-host-controls-and-waiting-room-design.md) — the host grant, the route-or-frame rule, the lobby. [`2026-09-20-meetings-external-guests-design.md`](2026-09-20-meetings-external-guests-design.md) — the second stay table and the per-viewer redaction. [`2026-09-20-meetings-recording-and-transcription-design.md`](2026-09-20-meetings-recording-and-transcription-design.md) — the recorder, which this design does not touch and places two requirements on (section 10).
**White paper:** _Communications layer_.
**Ledger:** the `meetings.breakout-rooms` node in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md) — "A host splits the room into smaller rooms and brings them back; each is a room of its own under the same meeting."

## 1. What this settles

A meeting today is one room: one `MeetingRoom` Durable Object keyed `${firmId}:${meetingId}`, one roster, one conversation. A settlement conference is not that. The mediator sends each side to its own room, visits them in turn, and brings everybody back to state terms; a training session splits into groups of five and reconvenes. This slice gives a host that: open a set of breakout rooms, put people in them, visit them, answer a request for help, and bring everybody back on a countdown — with the record saying who was in which room and when.

Ten decisions carry the design, and the rest follows from them.

1. **A breakout is a separate `MeetingRoom` Durable Object**, keyed `${firmId}:${meetingId}:${breakoutId}`, running the same class and every module under `room/` unchanged. Not a partition of the meeting's one object. Section 2 weighs it.
2. **The main room coordinates, and it is the only caller of a breakout room.** Every route still knocks on one door — the meeting's own room — and the main room holds the round, a copy of who is where, the timers and the help list, and forwards to the breakout that holds a person. The one exception is the socket upgrade, which the record addresses directly.
3. **A move keeps the browser's peer connection and its routing session, and closes every track across the boundary at the routing service, in both directions.** The mover stops hearing the room they left and the room they left stops hearing them, whatever any browser does; the browser then republishes into the same session in the new room. No new session, no new ICE or DTLS handshake, no second camera prompt. A move that only asks the browser nicely is not a move — the host-controls rule for a mute, applied to a door.
4. **Placement is on the record, as a table**, `meeting_breakout_placement`, a row per stay per room per interval — never a column overwritten on every move. Moving somebody is a route with an audit row; the rooms are told after the commit.
5. **Assignment is always an explicit list from a host.** "Automatic" is a proposal the host's own browser computes and the host commits; there is no server-side "everybody". Self-select is a round setting for firm members only. **A guest never moves themselves** — the same rule that makes a guest always wait at the door.
6. **No hosting of its own inside a breakout.** The meeting's host and co-hosts are hosts in whatever room they stand in, because the grant follows the person; nobody else is. No per-room lead.
7. **The round's clock is stored instants and one alarm in the main room.** A timer is advisory unless the host chose "close automatically" when opening; closing is a countdown the main room executes with the authority recorded at the press.
8. **One transcript per meeting, with a breakout handle on each line.** Which room a line was said in is decided by the poster's placement on the record, never by the browser.
9. **The door is the main room's.** The lobby and the lock stay meeting facts at the main room's door; a breakout has no door, because nobody arrives in one except by being placed.
10. **Recording is deferred, and says what it needs** (section 10).

## 2. The room model — a separate object, not a partition

### The two candidates

**A partition inside the one object.** Every breakout lives in `${firmId}:${meetingId}`, its participants stored under a per-breakout prefix (`participant:<breakoutId>:<attendanceId>`), every broadcast filtered to the sockets of one breakout, every room-level key (the spotlight, the reaction bucket, the help flag) multiplied by the breakout id.

**A separate object per breakout.** The same `MeetingRoom` class, addressed by `${firmId}:${meetingId}:${breakoutId}`. It holds its own roster, its own spotlight, its own reaction bucket, its own alarm — exactly what a room holds today, because it is a room.

### Weighed

| Question                        | Partition in one object                                                                                                                                                                                                                                                                                                 | Separate object per breakout                                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fan-out cost**                | Every broadcast walks every socket in the meeting and deserializes each attachment to find the six in one breakout. `broadcast`, `broadcastPerViewer` and `socketsFor` in `room/room-state.ts` are all walks over `getWebSockets()`; at three hundred sockets and fifty rooms that is three hundred reads to reach six. | A breakout's broadcast walks its own six sockets. The walk is the size of the room, which is the property the large-room work spent a slice buying.                                                                       |
| **The one-list-per-frame rule** | Holds only if every read in every module is re-scoped to a per-breakout prefix. `storedParticipants()` is the one read every roster, subscription check and broadcast is built from; a partition either lists all three hundred keys to serve a room of six, or threads a breakout id through every caller.             | Holds unchanged. `storedParticipants()` of a breakout is that breakout's roster, and no module learns the word "breakout" to keep it so.                                                                                  |
| **The 300 cap**                 | One object carries every frame of every room on one thread. `sessionFor` in `room/room-media.ts` holds `blockConcurrencyWhile` across a network call to the routing service, so one breakout's first publish stalls every other room's frames behind it.                                                                | The cap stays a fact about stays on the record (`inTheRoomCount`), untouched: a move opens no stay. The load is spread across up to fifty objects, and one room's routing call stalls only that room.                     |
| **Hibernation**                 | Any frame in any room wakes the one object, and its one alarm reconciles every room's graces, presence flushes and reaction buckets.                                                                                                                                                                                    | A quiet breakout hibernates on its own; a main room holding only the host between rounds hibernates too. Each alarm reconciles one room's deadlines.                                                                      |
| **The routing session model**   | A move is a key rename inside one object — atomic, which is the partition's one real advantage.                                                                                                                                                                                                                         | A move is a hand-off between two objects (section 3). The session itself is not bound to any object: it belongs to the fleet's one Realtime application, so either object can act on it once it is told the session id.   |
| **Isolation between rooms**     | The roster check in `namesOnlyRosterTracks` would have to be told which breakout to check against; a caller that forgets passes a subscription to another room's tracks.                                                                                                                                                | Structural. A breakout's roster is the whole of what may be asked for in it, so a browser in room 3 cannot name a session in room 4 — the room has never heard of it. The waiting room's `waiting:` prefix, one level up. |
| **Reuse**                       | The spotlight, the reaction bucket, the presence throttle, the lobby and the diagnostics each hold one room-level key; every one of them becomes a per-breakout key, and every module changes.                                                                                                                          | Every module under `room/` runs as it is. The slice adds two modules and a handful of forwarding lines.                                                                                                                   |

**Chosen: a separate object per breakout.** The partition's atomic move is real and is bought back in section 3 with an ordering and a convergence argument. What the partition costs is not bought back by anything: a broadcast that walks the whole meeting, a routing call that stalls every room, and a guarantee — which room a browser may subscribe in — that would rest on every caller remembering a prefix instead of on the set the roster is made of.

### The key, and who may compose it

`${firmId}:${meetingId}:${breakoutId}`. The main room keeps its existing key, so no room already open is re-addressed. The firm is always the session's (or, for a guest, the credential's), the meeting is the one the caller was authorized against, and the breakout handle is always read from the firm's own record — the open placement of the stay being upgraded, or the round the main room was handed by a route. No browser ever names a breakout in a request that addresses a room. One helper composes both keys, `apps/api-worker/src/meetings/room-address.ts`, and `meetingRoomFor` in `routes/meetings.ts` delegates to it, so there is one answer to which object a firm reaches.

### Who calls whom

- **Routes call the main room, always.** Opening, placing, choosing, closing, and every existing callback (`participantLeft`, `participantRemoved`, `guestCredentialReplaced`, `hostingChanged`, `roomStateChanged`, `lobbyChanged`, `messageSent`, `messageRedacted`, `end`) keep their call sites. The main room forwards to the breakout that holds the stay, or to every open breakout for a meeting-wide fact.
- **The main room calls breakout rooms**, through the same namespace binding (`MEETING_ROOM`), in a lane of `BREAKOUT_FANOUT_CONCURRENCY = 8` — the mute-all lane's width and its reasoning.
- **A breakout room calls the main room** for exactly three things: handing people back (section 3), a help request (section 6), and a departure the main room's copy must learn of (a leave, a sweep, a removal inside the breakout).
- **The socket upgrade addresses the room the record names.** `GET /api/v1/meetings/{meetingId}/socket` reads the caller's open placement and addresses that breakout, or the main room when there is none. The browser cannot choose.

## 3. The move — one routing session per browser, carried across rooms

### What a browser holds

One `RTCPeerConnection` and one routing session (the master design's _Signaling_). Tracks are published into the session and pulled from other sessions by `(sessionId, trackName)`. A session is created on the first publish by whichever room serves that browser, and it is a fact of the Realtime application, not of the room.

### Keep the session, close every track

Three shapes were on the table.

- **Carry everything** — keep the session and its published tracks, and hand the destination the track list. Rejected: a published track goes on being forwarded to every session that pulled it, and the room the mover left has no record of which of its other participants' sections carry the mover's tracks. A modified browser left in the main room keeps its subscription and hears the breakout. The move would be a request.
- **Carry nothing** — close the session, build a new peer connection, republish, the reconnect path. Rejected as the ordinary path: opening a round of three hundred would be three hundred new sessions, three hundred ICE and DTLS handshakes and three hundred TURN allocations in the same second, and a black tile of a second or more for every mover. It stays as the fallback (below).
- **Keep the session, close every track across the boundary — chosen.** The room losing the person closes, with `force: true`, every track the mover publishes and every section it subscribed on the mover's behalf (`subscribedMids`), in one `tracks/close` call on the mover's session. That stops the mover hearing the old room and stops every pull of the mover's media in the old room, at the routing service, whatever any browser does — which is exactly how a host's mute is enforced today. The browser keeps its peer connection and republishes its microphone and camera into the same session, on the same media sections, in the new room.

A screen share is not carried: it is stopped by the move and the member shares again if they mean to. A share is an act addressed to a room, and carrying it into another would show a document to people it was not shown to. The microphone and the camera are the person, and they come along. A microphone a host had muted stays closed across the move — a host's mute is not undone by walking through a door.

### The sequence

**The room losing the person** (`departForMove` in `room/room-transfer.ts`), for a batch:

1. Read the roster once. For each mover present, take the session, the published sections and `subscribedMids`.
2. Close all of them at the routing service in one call per mover, `force: true`, in a lane of `MOVE_CONCURRENCY = 8`. Keep each answer's session description. A routing failure is recorded through the standard pipeline and the move goes on: the record already says where the person is.
3. Build each mover's **carried record** — `userId`, `participantKind`, `displayName`, `sfuSessionId`, `muted`, `hostRole`, `unmuteAskedAt` — and nothing else. No tracks (all closed), no sections (all closed), no hand (a raised hand asks for the floor of the room it was raised in), no throttle windows (a new room starts them).
4. Hand each destination its batch, `participantsArriving(from, carried[])`, and **await it**, so the destination holds the record before the browser can knock.
5. Delete the movers' `participant:` records; one roster broadcast (`left: [...]`) for the batch; clear the spotlight if it named a mover.
6. Send each mover `move { to, reason, by, sessionDescription, at }`, then close their socket with `NORMAL_CLOSE_CODE` and the reason `moved`.
7. Record one event for the batch (section 18).

**The room gaining the person** (`receiveArrivals`):

1. Write each carried record as an ordinary `participant:` entry: the carried session, `tracks: []`, `subscribedMids: []`, `socketLostAt` set to the move instant, and a new marker `carriedSessionAt` set to the same instant.
2. One roster broadcast (`joined: [...]`) for the batch. The arrivals are on the roster at once, with no tracks, which is what everybody sees for somebody walking in.
3. Arm the alarm. `socketLostAt` is what makes a browser that never arrives — a laptop shut at the instant of the move — an ordinary grace sweep sixty seconds later, closing the stay through `closeAttendanceAfterSocketLoss` and releasing the session through `releaseMedia`. No new deadline kind is invented for it.
4. If an arrival holds a grant and the room holds a help request, clear it and tell the main room (section 6).

**The browser**, on `move`:

1. Standing becomes `moving`. The subscription scheduler stops; every pulled track is forgotten WITHOUT sending `close` — the old room already closed them — and every remote stream is released. A running screen share is stopped locally, likewise without a `close`.
2. In the negotiation queue: apply the description the move carried, create the answer, and hold it.
3. Close the old socket as this browser's own act (no `lost`), and open the same socket URL with `carrying=true`. The route resolves the new room from the record.
4. On the new room's `welcome` with `carried: true`: send `renegotiate` with the held answer, then republish the microphone (unless a host's mute closed it) and the camera on their existing sections with `replaceTrack` — the microphone's reuse of its own section after a host's mute, generalized to the camera — and send one `publish`. Standing becomes `live`, and the plan is reconciled against the new roster.
5. On `welcome` with `carried: false`: the new room does not hold the session (section 3, _The fallback_). Close the peer connection, call `POST /api/v1/meetings/{meetingId}/join` again — which returns the existing open stay and fresh relay credentials, and opens no attendance row — and join afresh.

### The upgrade, and why the browser says `carrying`

`admitParticipant` in `room/room-lifecycle.ts` resets a returning stay to no session and no tracks, because a reconnecting browser brings a new peer connection that cannot resume its predecessor's session. A moved browser brings the SAME peer connection, so the reset would be wrong for it — and only the browser knows which of the two it has. So the upgrade carries one value the browser states, `carrying`, and the room keeps the session only when BOTH hold: the record carries `carriedSessionAt` (written only by a hand-off, cleared at the first welcome after it) and the browser says `carrying=true`. Anything else takes the ordinary reset, and the stored session, if any, is closed at the routing service.

This is the one value on the upgrade a browser supplies, and it can only narrow: the session it keeps is the one its own stay already holds, keyed by the attendance handle the route authorized. A browser saying `carrying` on an ordinary reconnect finds no marker and is reset. A second tab claiming it after the first welcome finds the marker cleared. The rest of the upgrade stays server-derived, including the new `breakout` value, read by the route off the placement.

### The fallback

`welcome.carried` is `false` whenever the destination did not hold a marked record: the arrival was swept before the browser reached it, the hand-off call failed after the record committed, or the browser lost its peer connection mid-move. The client's answer — re-join and rebuild — is the only one that is always right, and it opens no attendance row because the stay is still open. A browser left open across the deploy knows no `move` frame: it ignores it, the room closes its socket, its screen reports the connection lost and offers Rejoin, and the rejoin lands in the right room because the record decides. That degrades; it does not misplace anybody.

### Convergence, where two objects race

A removal, a leave or a meeting's end can land while a move is in flight between two objects. The input gate is open during an outgoing call, so the main room can serve a callback between steps 4 and 6. Nothing here relies on the two objects agreeing in that window, because three things converge it: the socket route refuses any upgrade without an open stay, so a person the record put out cannot reach any room; a carried record that no socket claims is swept at its grace; and a forwarded callback that finds no record is a no-op, exactly as `releaseParticipant` already is. The worst case is a tile with no media on a breakout's roster for up to `SOCKET_LOSS_GRACE_SECONDS`, for somebody the record says has gone.

## 4. Assignment, and who may move whom

### The three ways a room is filled

- **By hand.** The host's panel lists everybody in the main room; the host sets each person's room and commits the arrangement.
- **Automatically.** The panel proposes an even split — `proposeEvenSplit(participants, roomCount, seed)` in `apps/web/src/lib/meetings/client/breakout-split.ts`, a pure function: everybody in the room who holds no grant, shuffled by the seed, dealt round-robin so no two rooms differ by more than one. The host sees the proposal, may reshuffle or adjust, and commits it. It is committed as an explicit list, on the lobby's reasoning against a server-side "admit everyone": a server-side "everybody" would place whoever joined in the second after the host looked, which is precisely the person the host did not decide about. Hosts and co-hosts are left in the main room by the proposal, because somebody has to be there to run the round; a host may put themselves anywhere.
- **Self-select.** The round is opened with `selfSelect: true`; each firm member in the meeting may choose a room, and move between the round's rooms, on their own. A host may still place anybody.

Late arrivals while a round is open land in the main room — admitted through the door as ever — and are listed in the host's panel as not placed.

### Who may move whom

| Actor                   | May move                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Host                    | Anybody in the room — member, guest, co-host, themselves — to any room of the open round, or back to the main room.      |
| Co-host                 | The same, except the host. Moving the host is acting on the host, which a co-host does not do anywhere else either.      |
| Member holding no grant | Themselves only: into a room of a self-select round, and back to the main room where the round lets participants return. |
| Guest                   | Nobody, themselves included.                                                                                             |

**Why a guest never moves themselves, not even in a self-select round.** A settlement conference is the ordinary case: the firm's client is in one room, opposing counsel in another. A guest who could choose a room could walk into the other side's caucus, and a guest who could return at will could walk into a main room where the mediator is talking to one side. The lobby already says a guest's way into a room is a host's decision; a breakout is a room. The schema holds it as well as the service: a placement a guest started is never `chosen` (section 12).

**Returning.** `participantsMayReturn` (default true) lets a member go back to the main room during the round. Once the round is closing, anybody may return early whatever the setting says, because returning is what the countdown asks of them. A member may always leave the meeting.

## 5. The round — open, timer, countdown, closed

**A round is the set of rooms a host opens together**, and at most one is open per meeting — held by a partial unique index, on the one-meeting-per-event precedent. Rooms of one round open and close together. A meeting may hold several rounds in sequence; each is its own record.

**Opening** needs the meeting live and a grant. The route writes the round, its rooms and any placements it was given in one batch, then calls the main room with the round, which configures each breakout room (`breakoutConfigured`) and performs the placements.

**The timer.** `durationMinutes` (1–240, optional) is turned into `ends_at` once, at opening, and stored — an instant, never re-derived at read time, on the guest link's `expires_at` precedent in [`docs/conventions/dates.md`](../conventions/dates.md). At `ends_at` nothing moves unless the host chose `closesAutomatically` when opening: every screen in every room says the time is up, the host's panel says so, and the host decides. Screens compute "time is up" from `endsAt` themselves; no frame is sent at that instant.

**Closing automatically** is a decision the opener took in advance, and it is recorded as theirs. At `ends_at` the main room's alarm begins the closing exactly as the opener's press would have, with `closing_requested_by_user_id` set to the opener. The alternative — a closing attributed to nobody — was rejected on the grant's own reasoning: every act on the record is attributed to a person, and here a person did decide, fifteen minutes earlier.

**The countdown.** "Close All Rooms" writes `closing_at = now + countdownSeconds` (the round's setting, 0, 15, 30, 60 or 120 seconds, default 60, and overridable at the press) and the requester. The main room broadcasts the new room state to every room — `closingAt` beside `at`, the room's own instant at send, so a screen counts down against the difference rather than against its own clock and a machine whose clock is out still counts down the right number of seconds — and arms its alarm for `closing_at`. Placements are refused from here on except returns to the main room, and anybody may press Return Now. A countdown of 0, or a second press with 0, closes at once.

**Closed.** At `closing_at` the main room's alarm commits the close through the firm-scoped data-access layer (`completeBreakoutRound`: the round's `closed_at`, `closed_by_user_id` from the closing's requester, `close_reason` of `host` or `timer`, and every open placement closed `round-closed` at the same instant), then asks each breakout room to send everybody back to the main room — the move of section 3, with `to: null` and `reason: "round-closed"` — and clears its own copy. A breakout room that has handed everybody back deletes its storage. The record is written before anybody is moved, the precedent every other act here follows.

**A write the alarm could not make** is recorded through the standard pipeline and retried at the next wake, `BREAKOUT_DEADLINE_RETRY_SECONDS = 30` later. `completeBreakoutRound` on a round already closed writes nothing, so a retry that overlaps a host's own close cannot write a second ending.

**The meeting ending** closes the open round and every open placement in the end route's own batch, at the meeting's one ending instant (`close_reason: 'meeting-ended'`), and the main room's `end` forwards `end` to every open breakout room before it deletes its own storage.

## 6. The host visiting, and a room asking for help

**Visiting is being placed.** A host who opens a room's row in the panel and presses Join is placing their own stay there, through the same route — recorded as `start_reason: 'visit'`, audited as a visit. Everything a host does inside the room works as it does in the main room, because the room authorizes host frames from the stored participant record and the carried record brings `hostRole` along. Returning is a placement to the main room.

**A help request is a tap on the shoulder, not a record.** A participant in a breakout presses Ask for Help; the browser sends `ask-for-help`. The breakout room stores ONE room-level fact, `help: { participantId, at }` — a request is the room's, so a second person asking while one is pending restates nothing and costs nothing — broadcasts its new room state so everybody in the room sees "Help has been requested", and calls the main room's `helpRequested`. The main room keeps `help:<breakoutId>` and re-sends the hosts their `breakouts` frame. The frame answers to the signal window a hand and a reaction answer to (`SIGNAL_INTERVAL_MILLISECONDS`), refused `rate-limited` inside it. From the main room it is refused `not-in-a-breakout`, socket kept open.

It is cleared three ways: a grant-holder arrives in the room (the host came), a host sends `clear-help` for that room from wherever they are (the frame is forwarded to the main room, which clears both copies), or the round closes. It is not audited and it reaches no table, on the rule that decides routes from frames: nobody will later ask who asked for help in room 3.

## 7. Hosting inside a breakout

**There is no per-room host.** The meeting's grants are meeting-wide and follow the person into whatever room they stand in: a co-host placed in room 3 can mute, spotlight and lower hands in room 3, and nobody else in room 3 can. The alternative — a "room lead" per breakout with host acts inside it — was rejected for three reasons. It would be a third role and a second answer to "who is running this", which the grant table exists to answer once. It would hand host acts over a firm's client to whoever the automatic split happened to put first. And the need it serves already has an answer on the record: a host who wants somebody to run a room names them co-host, which is deliberate, audited and revocable.

What a host's frames reach is the room they are in: Mute Everyone mutes one breakout, a spotlight is on that breakout's screens, Lower All Hands clears that breakout's queue. Every grant change reaches every room: `hostingChanged` is forwarded by the main room to every open breakout, so a withdrawn co-host loses their menus in room 3 on the next frame, as they would in the main room.

## 8. The door, the lock and guests

**The lobby belongs to the main room.** Waiting stays are only ever in the main room's `waiting:` keyspace; a placement requires a stay that is in the room, so nobody at the door can be placed, and admission lands in the main room. The door list reaches grant-holders in the main room as today; a grant-holder standing in a breakout is told the door's count on their `breakouts` frame (`waitingCount`), re-sent when the door moves, so a host visiting a room does not leave somebody outside unnoticed. The Lobby panel's read works from any room.

**The lock is the main room's door too.** A locked meeting refuses arrivals and touches nobody inside; moving between rooms is not arriving, so a locked meeting's rounds run as usual. `roomStateChanged` and `lobbyChanged` are forwarded to every open breakout, so the Host Controls menu tells the truth in whichever room the host is.

**A guest may be moved, by a host, and by nobody else** (section 4). A guest in a breakout is on that room's roster under the room's own per-viewer redaction — `rosterEntryFor(…, viewer)` and `broadcastPerViewer`, unchanged — so a guest's socket sees display names and never a firm's user identifiers, in every room. The guest's socket route resolves the guest stay's placement exactly as the member's does.

**A guest's view of the round is its own room and nothing else.** The room state's `breakouts.rooms` list — every room's position and name — is built per viewer and is EMPTY on a guest's socket. A room name typed by a host ("Client caucus — settlement authority") is shown to the members of the meeting, and never to the other side.

## 9. Chat, per breakout, on the record

**One transcript per meeting, with the room on each line.** `meeting_message` gains a nullable `breakout_id`. A line said in room 3 carries room 3; a line said in the main room carries null. It is filed under the same meeting, with the same redaction, retention and personal-data treatment every line has — the owner's ruling that chat is kept on the record is unchanged.

**The room is decided by the record, never by the request.** The post route reads the poster's open placement and writes its breakout; a body naming a room is not a field. A member posting from room 3 cannot put a line into room 4's conversation.

**The relay follows the line.** The chat route calls the main room's `messageSent` as it does today; the message now carries `breakoutId`, and the main room forwards a breakout line to that breakout room and relays a main-room line itself. `messageRedacted` gains the row's breakout handle for the same forwarding. A breakout line reaches the sockets in that breakout and nobody else.

**The read gains a scope.** `GET /api/v1/meetings/{meetingId}/messages` takes an optional `breakout` query value — a breakout handle, or `main` — and a room's chat panel asks for its own room. Absent, the read is the whole transcript with the room on each line, which is what it has always returned. Who may read any of it is unchanged: the owner's open question on the host-controls design — whether a transcript should be readable by somebody who was never in the room — applies to a breakout's lines exactly as to the main room's, and this design neither widens nor narrows the answer.

## 10. Recording — deferred, and what it needs

Recording is designed and not built. This design builds nothing for it and records two requirements on the `meetings.recording` node, because the move's shape decides them.

- **A recording is of the main room.** The recorder pulls audio tracks by `(sessionId, trackName)` from the main room's roster. Because a move closes the mover's published tracks at the routing service (section 3), a person moved out of a recorded main room stops being recorded structurally — their adapter's source closes — and the recorder treats it as a leave. A breakout room is not recorded, and its Record control is absent.
- **A move INTO a recorded room is an arrival.** The mover's welcome must carry the recording state, and the room must write the `arrival` notice from that welcome, as for any late arrival. A carried session changes nothing about consent: the person is being told on entering a room.

## 11. Capacity and ceilings

- **`MAX_MEETING_PARTICIPANTS` (300) is unchanged and untouched.** A move opens no stay, so the meeting's one ceiling over members and guests in the room already covers every breakout.
- **`MAX_BREAKOUT_ROOMS = 50` per round.** Six people a room at a full meeting, and fifty is the width the main room fans out to. It is a CHECK on `position` as well as a bound on the request.
- **`MAX_BREAKOUT_ROUNDS = 20` per meeting**, guarded in the open statement's own `WHERE`. A meeting that has split twenty times has said what it needs to, and the ceiling bounds the objects and rows a host in a loop can mint.
- **No per-room ceiling.** A room's size is bounded by the meeting's; a breakout is a `MeetingRoom` and runs a room of three hundred the way the main room does.
- **`MAX_BREAKOUT_ROOM_NAME_LENGTH = 80`**, a CHECK and a request bound.
- **Placements per request: 1 to `MAX_MEETING_PARTICIPANTS`.** A whole arrangement is one request.

None of these is on the wire: a browser draws what the frames carry and divides by none of them, which is the protocol package's own test for what it holds.

## 12. Schema (per-firm lineage, additive)

Three new tables and one added column, in one hand-written migration, `packages/database/drizzle/per-firm/<timestamp>_a-meeting-splits-into-breakout-rooms.sql`, the snapshot refreshed and `pnpm run migration-bundles` run in the same commit. Nothing existing is rebuilt and no CHECK is widened. No civil-date or wall-clock column is added — every `_at` column is a stored instant in `toISOString()` form — so the date-shape guard has nothing new to classify.

```sql
CREATE TABLE `meeting_breakout_round` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`opened_by_user_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`self_select` integer DEFAULT 0 NOT NULL,
	`participants_may_return` integer DEFAULT 1 NOT NULL,
	`ends_at` text,
	`closes_automatically` integer DEFAULT 0 NOT NULL,
	`countdown_seconds` integer DEFAULT 60 NOT NULL,
	`closing_at` text,
	`closing_requested_by_user_id` text,
	`closed_at` text,
	`closed_by_user_id` text,
	`close_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closing_requested_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_breakout_round_flags_check" CHECK("meeting_breakout_round"."self_select" IN (0, 1) AND "meeting_breakout_round"."participants_may_return" IN (0, 1) AND "meeting_breakout_round"."closes_automatically" IN (0, 1)),
	CONSTRAINT "meeting_breakout_round_countdown_check" CHECK("meeting_breakout_round"."countdown_seconds" IN (0, 15, 30, 60, 120)),
	CONSTRAINT "meeting_breakout_round_timer_check" CHECK("meeting_breakout_round"."closes_automatically" = 0 OR "meeting_breakout_round"."ends_at" IS NOT NULL),
	CONSTRAINT "meeting_breakout_round_ends_check" CHECK("meeting_breakout_round"."ends_at" IS NULL OR "meeting_breakout_round"."ends_at" > "meeting_breakout_round"."opened_at"),
	CONSTRAINT "meeting_breakout_round_closing_shape_check" CHECK(("meeting_breakout_round"."closing_at" IS NULL) = ("meeting_breakout_round"."closing_requested_by_user_id" IS NULL)),
	CONSTRAINT "meeting_breakout_round_closed_shape_check" CHECK(("meeting_breakout_round"."closed_at" IS NULL) = ("meeting_breakout_round"."closed_by_user_id" IS NULL) AND ("meeting_breakout_round"."closed_at" IS NULL) = ("meeting_breakout_round"."close_reason" IS NULL)),
	CONSTRAINT "meeting_breakout_round_close_reason_check" CHECK("meeting_breakout_round"."close_reason" IS NULL OR "meeting_breakout_round"."close_reason" IN ('host', 'timer', 'meeting-ended')),
	CONSTRAINT "meeting_breakout_round_span_check" CHECK("meeting_breakout_round"."closed_at" IS NULL OR "meeting_breakout_round"."closed_at" >= "meeting_breakout_round"."opened_at")
);
--> statement-breakpoint
-- AT MOST ONE OPEN ROUND PER MEETING, held by the database: two hosts pressing Open together end
-- with one round, and the loser's batch rolls back on the precedent of one meeting per event.
CREATE UNIQUE INDEX `meeting_breakout_round_open_unique_index` ON `meeting_breakout_round` (`meeting_id`) WHERE `closed_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `meeting_breakout_round_meeting_opened_index` ON `meeting_breakout_round` (`meeting_id`, `opened_at`);
--> statement-breakpoint
CREATE TABLE `meeting_breakout` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`round_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `meeting_breakout_round`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_breakout_position_check" CHECK("meeting_breakout"."position" BETWEEN 1 AND 50),
	CONSTRAINT "meeting_breakout_name_check" CHECK("meeting_breakout"."name" IS NULL OR (length("meeting_breakout"."name") > 0 AND length("meeting_breakout"."name") <= 80))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_breakout_round_position_unique_index` ON `meeting_breakout` (`round_id`, `position`);
--> statement-breakpoint
CREATE TABLE `meeting_breakout_placement` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`round_id` text NOT NULL,
	`breakout_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`participant_id` text NOT NULL,
	`start_reason` text NOT NULL,
	`placed_at` text NOT NULL,
	`placed_by_user_id` text,
	`left_at` text,
	`ended_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `meeting_breakout_round`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`breakout_id`) REFERENCES `meeting_breakout`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`placed_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_breakout_placement_participant_kind_check" CHECK("meeting_breakout_placement"."participant_kind" IN ('member', 'guest')),
	CONSTRAINT "meeting_breakout_placement_start_reason_check" CHECK("meeting_breakout_placement"."start_reason" IN ('assigned', 'chosen', 'visit')),
	CONSTRAINT "meeting_breakout_placement_actor_shape_check" CHECK(("meeting_breakout_placement"."start_reason" = 'chosen') = ("meeting_breakout_placement"."placed_by_user_id" IS NULL)),
	CONSTRAINT "meeting_breakout_placement_member_only_check" CHECK("meeting_breakout_placement"."start_reason" = 'assigned' OR "meeting_breakout_placement"."participant_kind" = 'member'),
	CONSTRAINT "meeting_breakout_placement_span_check" CHECK("meeting_breakout_placement"."left_at" IS NULL OR "meeting_breakout_placement"."left_at" >= "meeting_breakout_placement"."placed_at"),
	CONSTRAINT "meeting_breakout_placement_ended_shape_check" CHECK(("meeting_breakout_placement"."left_at" IS NULL) = ("meeting_breakout_placement"."ended_reason" IS NULL)),
	CONSTRAINT "meeting_breakout_placement_ended_reason_check" CHECK("meeting_breakout_placement"."ended_reason" IS NULL OR "meeting_breakout_placement"."ended_reason" IN ('moved', 'returned', 'round-closed', 'stay-closed', 'meeting-ended'))
);
--> statement-breakpoint
-- ONE OPEN PLACEMENT PER STAY: a stay is in one room at a time. The stay handle is unique across
-- both stay tables because each carries its own prefix.
CREATE UNIQUE INDEX `meeting_breakout_placement_open_unique_index` ON `meeting_breakout_placement` (`participant_id`) WHERE `left_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `meeting_breakout_placement_breakout_open_index` ON `meeting_breakout_placement` (`breakout_id`) WHERE `left_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `meeting_breakout_placement_meeting_placed_index` ON `meeting_breakout_placement` (`meeting_id`, `placed_at`, `id`);
--> statement-breakpoint
ALTER TABLE `meeting_message` ADD `breakout_id` text REFERENCES `meeting_breakout`(`id`);
--> statement-breakpoint
CREATE INDEX `meeting_message_breakout_sent_index` ON `meeting_message` (`breakout_id`, `sent_at`, `id`) WHERE `breakout_id` IS NOT NULL;
```

### Why a placement table and not a column

A `breakout_id` column on `meeting_attendance` would be smaller and would answer "where is this person now". It would answer only that: a move overwrites it, so the record could not say that somebody spent ten minutes in room 2 and twenty in room 5 — and "who was in the caucus when the offer was discussed" is exactly the question a firm asks of a mediation months later. It would also be two columns, one on each stay table, where the placement carries the stay by value beside a kind (the `meeting_message` precedent) and covers both. The host grant's own reasoning, applied again: the question is about an interval, so the answer is a row with two instants.

### Why every stay-closing path closes the placement, rather than deriving its end

A placement's end could be derived — the earlier of its own `left_at` and its stay's — and no stay-closing path would change. It is written instead, because the derivation is wrong in the one case that matters: a round closing later would close a placement whose stay ended earlier, and the record would say somebody was in a room after they had left the meeting. So every path that closes a stay composes `closePlacementOfStayStatement` (`ended_reason: 'stay-closed'`, the same instant) into its own batch — the leave, the socket-loss sweep, the removal of a member and of a guest, the guest's own departure — and the end composes `closeAllPlacementsStatement` (`'meeting-ended'`). A source-scan fitness test holds that every module composing a stay's close composes the placement's too (section 21).

### The column on `meeting_message`

SQLite permits `ADD COLUMN` with a `REFERENCES` clause when the column's default is NULL, which this one is. The migration test applies it to a populated `meeting_message`; if durable-object storage refuses it, the column carries the breakout handle by value with no foreign key, which is the `participant_id` precedent on the same table.

### Identifiers and personal data

- **Identifiers:** `meetingBreakoutRound`, `meetingBreakout`, `meetingBreakoutPlacement` in `packages/identifiers` (registry and types).
- **Personal-data registry:** `meeting_breakout_round.opened_by_user_id`, `closing_requested_by_user_id`, `closed_by_user_id`, `meeting_breakout_placement.participant_id` and `placed_by_user_id` are `retain-under-matter` — who was in which room is part of what the record says happened. `meeting_breakout.name` is `retain-under-matter` and **content-level residue**, on the chat body's line: a host types it, and it can say what the room was for.

## 13. `@magna-carta/meetings` — the breakout trio

On the structural rule of one types, statements and service trio per concern:

- **`src/breakout-types.ts`** — `MAX_BREAKOUT_ROOMS`, `MAX_BREAKOUT_ROUNDS`, `MAX_BREAKOUT_ROOM_NAME_LENGTH`, `BREAKOUT_COUNTDOWN_SECONDS = [0, 15, 30, 60, 120]`, `BREAKOUT_START_REASONS`, `BREAKOUT_END_REASONS`, `BREAKOUT_CLOSE_REASONS`, `BREAKOUT_PLACEMENT_OUTCOMES = ['placed', 'unchanged', 'not-in-the-room', 'not-permitted']`, the row types, and the summaries a route returns.
- **`src/breakout-statements.ts`** — the reads (`readOpenRound`, `listRounds`, `readOpenPlacement`, `listOpenPlacements`, `listPlacements` paged on `(placed_at, id)` with the stay's display name joined per kind, as `listAttendance` joins it) and the writes. The round insert carries the meeting's liveness, the open-round absence and the round count in its own `WHERE` and is guarded. The placement insert carries "the stay is in the room" — composed from `MEETING_STAY_TABLES`'s own predicate for the stay's table, never re-spelled — and "the round is open and, unless this is a return, not closing", so a host closing the round in the instant of a placement wins, on the door-in-the-statement precedent. The one exported predicate `OPEN_PLACEMENT_PREDICATE` is what the socket route and the chat post read.
- **`src/breakout-service.ts`** — `openBreakoutRound`, `placeParticipants` (one outcome per identifier, the admission's shape), `chooseBreakout`, `beginClosingBreakoutRound`, and the two the main room's alarm calls with no actor and no visibility predicate, on `closeAttendanceAfterSocketLoss`'s precedent: `beginClosingOnTimer` and `completeBreakoutRound`. Every host path composes `requireHostGrant`; every path reads the meeting through `readMeeting` and its visibility gate first.
- **`src/validation.ts`** gains six codes: `meeting-breakouts-open`, `meeting-breakouts-not-open`, `meeting-breakouts-closing`, `meeting-breakout-unknown`, `meeting-breakout-rounds-exhausted`, `meeting-breakout-choice-not-offered`.
- **The stay-closing paths** in `meeting-service.ts` (`leaveMeeting`, `closeAttendanceAfterSocketLoss`, `endMeeting`), `hosting-service.ts` (`removeParticipant`), `guest-service.ts` (`leaveAsGuest`, `closeGuestStayAfterSocketLoss`) and `guest-removal.ts` (`removalOfGuestStatements`) each compose one more statement.
- **The chat posts** in `chat-service.ts` read the poster's open placement and write its breakout.

**Audit rows**, identifiers and instants only, never a room name: `meetings.breakout.opened` (`roundId`, `roomCount`, `selfSelect`, `participantsMayReturn`, `endsAt`, `closesAutomatically`, `countdownSeconds`), `meetings.breakout.placed` (`roundId`, `breakoutId` or null, `participantKind`, `participantId`, `startReason`), `meetings.breakout.visited` (the same, when a grant-holder placed themselves), `meetings.breakout.closing` (`roundId`, `closingAt`, `reason`), `meetings.breakout.closed` (`roundId`, `closedAt`, `reason`). A placement per person, like an admission: "where was this person" is a question about a person.

## 14. Routes (`apps/api-worker/src/routes/meeting-breakouts.ts`)

One route file per resource. All `resource: "firm"`, the family's rule; every write `idempotency: "required"` and audited.

| method | path                                                | permission              | does                                                                                                                                                        |
| ------ | --------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/meetings/{meetingId}/breakouts`            | `meetings:host` + grant | Opens a round. Body below. `201` with the round and one outcome per placement.                                                                              |
| GET    | `/api/v1/meetings/{meetingId}/breakouts`            | `meetings:join`         | `{ open, rounds, arrangement, myPlacement }`. `arrangement` is who is in which room of the open round, and is EMPTY for a caller holding no grant.          |
| POST   | `/api/v1/meetings/{meetingId}/breakouts/placements` | `meetings:host` + grant | Body `{ placements: [{ participantId, breakoutId: string \| null }] }`, 1–300 entries, `null` is the main room. One outcome per identifier.                 |
| POST   | `/api/v1/meetings/{meetingId}/breakouts/choice`     | `meetings:join`         | Body `{ breakoutId: string \| null }`. A member's own move: into a room of a self-select round, or back to the main room. Needs an in-the-room member stay. |
| POST   | `/api/v1/meetings/{meetingId}/breakouts/closing`    | `meetings:host` + grant | Body `{ countdownSeconds?: 0 \| 15 \| 30 \| 60 \| 120 }`. Begins the return; `0` closes at once. `200 { closingAt, closedAt }`.                             |
| GET    | `/api/v1/meetings/{meetingId}/breakout-placements`  | `meetings:join`         | Who was in which room and when, cursor-paged, ascending by `(placed_at, id)` — the attendance read's permission, shape and keyset.                          |

**The open body:** `{ rooms: [{ name: string | null }] (1–50; a room's position is its index plus one), selfSelect = false, participantsMayReturn = true, durationMinutes: 1–240 | null = null, closesAutomatically = false (true requires durationMinutes), countdownSeconds = 60, placements: [{ participantId, position }] (0–300) = [] }`. Placements are named by position because the breakout handles do not exist until the round does.

**The round a surface is given:** `{ id, openedAt, openedByUserId, selfSelect, participantsMayReturn, endsAt, closesAutomatically, countdownSeconds, closingAt, closedAt, closeReason, rooms: [{ id, position, name }] }`. `rounds` is recorded in the unpaged-list baseline with `MAX_BREAKOUT_ROUNDS` as what bounds it, on the hosts read's precedent.

**`arrangement` is the host's, and a member reading it would read other people's caucuses.** Who is in which room is the host's arrangement; a member learns who is in their own room from that room's roster, and learns nothing about the rest. It rides every answer and is empty for a non-host, on the welcome's lobby-list precedent: a response whose shape depended on the caller would be a shape both ends branch on.

**The placements route tells the main room the whole of what it just decided, unchanged entries included.** A room the previous call failed to reach after its commit is therefore repaired by the host pressing again: the record answers `unchanged`, and the room makes it true. Placing a stay into the room it is already in is a no-op in the room as well.

**Rate limits use the existing buckets**, so `contracts/route-meta.ts` and `chokepoint/rate-limiter.ts` — the platform's shared surface — are not touched: the host writes ride `default`, the member's own choice rides `expensive` (ten a minute), which bounds a member pacing between rooms without touching anybody who is choosing once.

**Changed routes.**

- `GET /api/v1/meetings/{meetingId}/socket` (`routes/meetings.ts`) reads the caller's open placement with `readOpenPlacement`, addresses the room it names, passes the breakout's identity (`breakout`, its round, position and name) inward so a breakout room can always stand itself up from the upgrade — the `putRoom` precedent — and takes the optional `carrying` query value (section 3).
- `GET /api/v1/guest/meeting/socket` (`routes/meetings-guest.ts`) does the same for the guest stay.
- `GET /api/v1/meetings/{meetingId}/messages` (`routes/meeting-chat.ts`) takes the optional `breakout` scope; the redaction's relay passes the row's breakout handle. The guest chat read in `routes/meetings-guest.ts` takes the same scope.
- `GET /api/v1/meetings/{meetingId}/inspect` (`routes/meeting-inspect.ts`) takes an optional `breakout` query value, so an operator can read one breakout room.
- `POST /api/v1/meetings/{meetingId}/end` is unchanged at the route; its batch closes the round (section 5).

**Problem types added:** `meeting-breakouts-open` (409 — "Breakout rooms are already open"), `meeting-breakouts-not-open` (409), `meeting-breakouts-closing` (409 — "Everybody is returning to the main room"), `meeting-breakout-not-found` (404, and the same for a room of another meeting, a closed round, or a meeting the caller cannot see — one refusal for every way a room is out of reach), `meeting-breakout-rounds-exhausted` (409), `meeting-breakout-choice-not-offered` (409 — "You cannot choose a room in this meeting"). Reused: `meeting-not-host` (403), `meeting-not-joined` (409), `meeting-ended` (409), `meeting-not-found` (404).

## 15. Frames

Additive in both directions, so `MEETING_PROTOCOL_VERSION` stays 1. Two client frames and two room frames; the fitness function in `packages/meeting-protocol/test/frames-have-handlers.test.ts` then demands, and gets, a `parsed.frame.type === "…"` branch for each client frame in `room/room-frames.ts`, a sender for each in `apps/web/src/lib/meetings/client/`, a builder for each room frame in `src/frames.ts`, and a `case "…":` for each in `client/signaling.ts`. Both halves land in one pull request, because that test is part of the gate and `main` deploys.

### Client to room

| type           | fields       | room does                                                                                                                                                                                   |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ask-for-help` | —            | In a breakout: stores the room's help fact, broadcasts `room-state`, tells the main room. Signal window; `rate-limited` inside it. In the main room: `not-in-a-breakout`, socket kept open. |
| `clear-help`   | `breakoutId` | A host frame, authorized from the stored participant (`not-host` otherwise). Any room forwards it to the main room, which clears both copies and re-sends the hosts' `breakouts`.           |

Both are answered before a routing session is resolved, like every frame that asks nothing of the routing service, and both spend from the socket's frame budget first.

### Room to client

| type        | to                             | fields                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `move`      | the one socket being moved     | `to: string \| null` (a breakout handle, or null for the main room), `reason: "assigned" \| "chosen" \| "visit" \| "returned" \| "round-closed"`, `by: string \| null` (the stay handle of the host who moved them; null for their own choice and for a round closing), `sessionDescription: { type, sdp } \| null`, `at`                                           |
| `breakouts` | sockets holding a grant, whole | `round: { roundId, openedAt, selfSelect, participantsMayReturn, endsAt, closesAutomatically, countdownSeconds, closingAt } \| null`, `rooms: [{ breakoutId, position, name, participantIds }]`, `mainRoom: { participantIds }`, `participants: [{ participantId, displayName, kind, hostRole }]`, `help: [{ breakoutId, participantId, at }]`, `waitingCount`, `at` |

`move` carries no user identifier, so a guest's copy needs no redaction. `breakouts` is sent whole, on the `waiting` frame's reasoning — bounded by three hundred stays and fifty rooms, sent to a handful of sockets — only to grant-holders, and carries display names and stay handles and never a user identifier. A grant-holder in the main room receives it from the main room; a grant-holder in a breakout receives it from that room, which the main room asks to relay (`relayToHosts`), using its copy of where each grant-holder stands.

### Additions to frames that exist

- **`MeetingRoomState` gains `breakouts`**, carried on `room-state` and inline on `welcome`: `{ roundId, here: string | null, position: number | null, name: string | null, rooms: [{ breakoutId, position, name }], selfSelect, participantsMayReturn, endsAt, closingAt, helpRequestedAt: string | null, at } | null`. `at` is the room's instant when it built the state, which a screen counts down against. **It is built per viewer**: a guest's copy carries `rooms: []`. So `announceRoomState` in `room/room-state.ts` moves from `broadcast` to `broadcastPerViewer` — a change that costs nothing when no guest is present, because the payload is built once per kind of reader, lazily.
- **`welcome` gains `carried: boolean`** — whether the room kept this browser's routing session (section 3).
- **`MeetingChatMessage` gains `breakoutId: string | null`**, on the frame and on the read alike, since the frame is a copy of the row.

### Refusal reasons added

`not-in-a-breakout` — a frame that only means something inside a breakout, arriving at the main room. Not fatal; the socket stays open. Nothing else is added: a socket whose room no longer matches the record is closed by the room with the normal code after `move`, and a frame arriving on a socket the room has already let go of is `not-a-participant`, as today.

## 16. The room — two modules, and the wiring

On the rule that a concern is a module and the Durable Object class is not where a new one goes.

- **`room/room-transfer.ts`** — the hand-off both sides run: `departForMove` (section 3's first list), `receiveArrivals` (its second), `dispatchMoves` (the `move` frames and the closes), the carried record's shape, and `MOVE_CONCURRENCY = 8`.
- **`room/room-breakouts.ts`** — the round, from the main room's side and a breakout's: the main room's copy of the round and of who is where, the hosts' `breakouts` frame, the help list, the two deadlines the main room's alarm reconciles, the fan-out to breakout rooms in a lane of `BREAKOUT_FANOUT_CONCURRENCY = 8`, the return at closing; and in a breakout, its own configuration, its help fact, and `returnEveryone`.

### Storage keys

| Key                  | Where         | Holds                                                                                                                                                            |
| -------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `breakout-round`     | main room     | The open round as the main room executes it: rooms, settings, `endsAt`, `closingAt`, the closing's requester.                                                    |
| `placement:<stayId>` | main room     | Where one stay is, with `hostRole`, `displayName` and `kind` for the hosts' frame. The room's COPY of the record, on the terms `locked` and `lobby` already are. |
| `help:<breakoutId>`  | main room     | A pending request, one per room.                                                                                                                                 |
| `breakout`           | breakout room | The room's identity in the round (round, position, name) and the round's settings and deadlines, for its `room-state`.                                           |
| `help`               | breakout room | The room-level request.                                                                                                                                          |

`StoredRoom` gains `breakoutId?: string` (absent in the main room, which is what every room stored before this slice reads as). `StoredParticipant` gains `carriedSessionAt?: string | null`. `MeetingSocketAttachment` gains `breakoutId?: string` and `carrying?: boolean`, both set at upgrade.

**The main room's copy never decides anything the record decides.** It says where to forward a callback and what to draw on a host's panel. The socket route reads the record; the record is what a removal, a leave and an end are checked against. A copy that has drifted costs a stale row on a host's panel until the next placement repairs it, and never puts anybody in a room.

### Methods on `MeetingRoom` (thin wiring, each one line into a module)

| Method                                                                     | Called by                       | Does                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `breakoutsOpened(round, placements)`                                       | the open route                  | Stores the round, configures each breakout room, performs the placements, sends the hosts' frame. |
| `breakoutsPlaced(placements)`                                              | the placements, choice routes   | Groups moves by source room; runs the moves.                                                      |
| `breakoutsClosing(closingAt, by)`                                          | the closing route               | Stores the deadline, fans `room-state` out to every room, arms the alarm.                         |
| `breakoutsClosed(closedAt)`                                                | the closing route at 0          | Returns everybody, clears the copy.                                                               |
| `participantsMoving(moves)`                                                | the main room                   | In a breakout: the departing half for the named stays.                                            |
| `participantsArriving(from, carried)`                                      | any room                        | The arriving half.                                                                                |
| `breakoutConfigured(breakout)`                                             | the main room                   | In a breakout: writes its `breakout` key and broadcasts `room-state`.                             |
| `returnEveryone(reason)`                                                   | the main room                   | In a breakout: moves every participant to the main room, then deletes its storage.                |
| `helpRequested(breakoutId, participantId, at)` / `helpCleared(breakoutId)` | a breakout room / the main room | Keep the two copies of a request in step.                                                         |
| `breakoutDepartures(breakoutId, stayIds)`                                  | a breakout room                 | A leave, a sweep or a removal inside a breakout, so the main room's copy drops them.              |
| `relayToHosts(payload)`                                                    | the main room                   | In a breakout: sends the hosts' frame to its own grant-holders.                                   |

The existing methods keep their signatures, except `messageRedacted`, which gains the breakout handle. In the main room each forwards: `participantLeft`, `participantRemoved` and `guestCredentialReplaced` to the breakout its copy places the stay in (and to itself otherwise); `hostingChanged`, `roomStateChanged`, `lobbyChanged` and `end` to every open breakout as well as itself; `messageSent` and `messageRedacted` to the message's own room.

### The alarm

The main room's `armAlarm` reconciles two more deadlines from one `get` of `breakout-round` — `endsAt` while the round closes automatically and is not yet closing, and `closingAt` — and `runAlarm` gains the two jobs. A breakout room's alarm is unchanged: its graces are the carried arrivals' and its own participants'. `room-inspect.ts` names the new pending jobs (`breakout-timer`, `breakout-return`) and reports the round's facts in the main room and the room's identity in a breakout — never a room name, on its rule against display names.

### What the load harness adds

`test/support/meeting-room-load.ts` gains a breakout pass: everybody arrives, a round of fifty opens with every participant placed, everybody publishes in their room, the round closes on a countdown of zero. It asserts, and prints for a pull request: routing-service calls the rooms made per mover (one close per move, both ways), coordinating calls per round (at most one per breakout per act), frames per mover per socket, and storage lists per placement call. The fast variant runs forty participants in eight rooms in the ordinary suite; the full variant is three hundred in fifty, on the same variable.

## 17. The screen (`apps/web`)

- **The host's control.** A **Breakout Rooms** control in the band, beside Hands and Lobby, for grant-holders only — absent, not disabled, for everybody else — carrying a count badge of pending help requests, on the Lobby control's reasoning that a request inside a menu is a person waiting ten minutes. It opens `meeting-breakouts-panel.svelte`, a `Sheet`.
- **The panel, before a round.** How many rooms (1–50), optional names, and one of Assign Automatically (the proposal drawn as it will land, with Reshuffle), Assign by Hand (a room chooser per person), or Let Members Choose. Then Let Participants Return, a time limit with Close Automatically, and the countdown. **Open Rooms** commits.
- **The panel, during a round.** Each room with its occupants, a Join control (a visit), a Move To menu per person, a help request marked on its room with Join beside it, the people not placed with Assign, and **Close All Rooms** behind an `ActionDialog` stating the countdown — everybody is taken out of their room, and there is no undoing it.
- **In a breakout.** `meeting-breakout-banner.svelte` above the stage: the room's position and name, the time left against `endsAt` — or "Time is up" — and during the closing "Returning to the main room in 0:42" with **Return Now**. **Ask for Help** in a breakout, "Help has been requested" once it has; **Return to Main Room** where the round allows it. Remaining time is a live countdown drawn with `formatDuration`; it is not a record, so the elapsed-time ban in `docs/conventions/dates.md` does not bear on it, and a closed countdown falls back to the absolute instant.
- **Choosing.** In a self-select round a member sees **Choose a Room**, opening `meeting-breakout-choice.svelte`: the rooms by position and name, and Join. No counts — a count per room would change on every choice and cost a fan-out to every room each time, for a number nobody needs to pick a room.
- **The move itself.** The standing is `moving`: the tiles clear and "Moving to Room 3" shows until the new welcome, which is usually well under a second.
- **Chat.** The chat panel names its room ("Chat — Room 3") and reads its own room's scope.
- **The record.** The attendance panel lists under each stay the rooms it was placed in, with the two instants drawn by `formatTimeOfDay`.
- **A guest** sees the banner without Choose a Room or Return to Main Room, and with Ask for Help.

Design-system components only; Lucide icons (`layout-grid` for the control, `life-buoy` for help, `corner-up-left` for returning); no raw CSS; titles in the band's own Title Case.

## 18. Telemetry

In the `meetings.room.*` family in `packages/telemetry/src/events.ts`, each an allowlist builder with no field for a display name, a room name, a track name or a session description.

- **Every event in the family gains `breakoutId`**, null in the main room — a refusal, a sweep or an alarm is otherwise uncorrelatable to the room it happened in. `RoomIdentity` in `room/room-diagnostics.ts` gains it, read off the attachment or the stored room at no extra cost.
- `meetings.room.joined` gains `carried` — whether this welcome kept a routing session. A move that fell back is the report behind "my camera went black when I was moved".
- `meetings.room.breakoutsOpened` — `roomCount`, `placedCount`.
- `meetings.room.moved` — one per batch per source room: `toMainRoom`, `movedCount`, `tracksClosedCount`, `closeFailedCount`, `durationMilliseconds`.
- `meetings.room.helpRequested` — `attendanceId`. `meetings.room.helpCleared` — `clearedBy: "host-arrived" | "dismissed" | "round-closed"`.
- `meetings.room.breakoutsClosing` — `countdownSeconds`, `reason: "host" | "timer"`. `meetings.room.breakoutsClosed` — `roomCount`, `returnedCount`, `reason`.
- `meetings.room.alarmRan` gains `breakoutTimerDue` and `breakoutReturnDue`.

## 19. Security

### Tenant isolation

Every breakout key begins with the session's firm (or the guest credential's), and the rest is platform-minted handles read from that firm's own record: the meeting the caller was authorized against, and the breakout on the stay's open placement or on the round a route read through the visibility gate. No path composes a key from a request value. A breakout room stores its firm and meeting from the upgrade route's server-derived values or from the main room's coordinating call, and a coordinating call naming a different firm or meeting than the room already holds is refused and recorded — a guard, not a normal path, since only the main room of the same meeting can compose the key.

### Isolation between rooms of one meeting

- **The roster is the whole of what may be asked for**, per room, unchanged: a browser in room 3 cannot subscribe to a session in room 4, because room 3 has never heard of it.
- **A move closes every track across the boundary at the routing service, both ways** (section 3), so neither the mover nor anybody they left can go on hearing the other through a subscription a browser declined to drop.
- **The room a socket reaches is the record's decision**, never the URL's.
- **A carried session is only ever the mover's own**, and only across the one welcome after a hand-off.
- **Who is where is the hosts'**: the `breakouts` frame and the route's `arrangement` reach grant-holders only; a member sees their own room.
- **A guest sees one room**: its own room's roster under the per-viewer redaction, and `breakouts.rooms` empty.
- **A breakout's chat reaches that breakout**, and its scope is the poster's placement.

### Who may move whom

Section 4's table, held in two places: `requireHostGrant` and the co-host rule in the service, and the schema's `meeting_breakout_placement_member_only_check`, which makes a guest's self-placement unrepresentable rather than merely refused. A member's own choice needs an in-the-room member stay, so a socket at the door cannot choose its way past the host.

### Resource exhaustion across many rooms

- **Objects.** At most fifty breakout rooms live per meeting and twenty rounds over its life, each guarded in the statement that creates it. A breakout room deletes its storage when it hands everybody back, and the main room's copy is cleared at close and at end.
- **Fan-out.** Every coordinating walk is over at most fifty rooms, in a lane of eight; every move batch is one roster broadcast per room, never one per person; the hosts' frame is whole but reaches a handful of sockets.
- **The routing service.** A move costs one forced close per mover from the rooms, in a lane of eight, and the browser's own renegotiation and publish — both already inside the per-participant windows the security review added. `ask-for-help` spends the frame budget and the signal window; `clear-help` spends the frame budget and is a host frame.
- **Requests.** A placement request is bounded at three hundred entries; host writes ride the `default` bucket and a member's choice the `expensive` one.
- **Record growth.** A round is at most fifty room rows; placements grow one row per move, each behind a rate-limited, audited, idempotent write.

### Audit and redaction

Audit rows carry identifiers and instants. No room name reaches an audit row, a telemetry field or an inspect answer; the name is on the record, classified as content, and on the screens of the members of the meeting.

### The open owner question on socket lifetime

A move opens a new socket, and the upgrade re-reads the session and the stay — so a member whose session was revoked cannot be moved into a breakout. That narrows the window the host-controls design's open question describes, incidentally; it does not answer it, and nothing here depends on it.

## 20. Cost, in Cloudflare Realtime terms and beyond

**Rooms multiply signaling objects, not media.** Cloudflare Realtime bills the gigabytes it delivers ([`docs/operating-costs.md`](../operating-costs.md): 1,000 GB a month included, about $0.05 a gigabyte after). A breakout round changes neither how many people are in the meeting nor what each browser may pull: the subscription policy's caps (sixteen cameras, twenty-four microphones) apply in a room of six exactly as in a room of three hundred, and in a room of six a browser simply pulls five. The per-participant-minute media bill is the same order in a breakout as in the main room.

**A move costs no new session and no TURN allocation**, because the session is carried. What it spends at the routing service is one forced close from the rooms and a renegotiation and a publish from the browser, plus the subscriptions the new room's plan calls for; those API calls are not the billed unit.

**What does multiply is Durable Objects**: up to fifty extra rooms per meeting while a round is open. Each bills requests (one per frame and per coordinating call — about $0.15 per million over the included million) and duration only while it is handling one, because it hibernates between frames; its storage is a few keys and is deleted at close. A round of three hundred opening and closing is on the order of a few thousand requests in total — three hundred upgrades, a handful of signaling frames per mover each way, and a coordinating call per room per act — which is a rounding error on the included allotment. The fan-out is cheaper than the same people in one room: a join in a room of six costs five frames where a join in a room of three hundred costs three hundred.

## 21. Testing

**`packages/meetings/test/breakouts.test.ts`** (`node:sqlite`, on the service-test precedent):

- Opening needs a live meeting and a grant; a second open while one is open is `meeting-breakouts-open`, and two racing opens end with one round; the twenty-first round is `meeting-breakout-rounds-exhausted`; fifty-one rooms and an eighty-one-character name are refused.
- Placements answer one outcome per identifier; a waiting stay, a left stay and a stranger's handle are `not-in-the-room`; a co-host placing the host is `not-permitted`; placing a stay into the room it is in is `unchanged` and writes nothing; moving between breakouts closes the old placement `moved` and opens the new at one instant.
- A member's choice is refused in a round that is not self-select, a return is refused where the round forbids it and accepted once the round is closing whatever it says; a guest's self-placement is refused by the service AND by the schema's check.
- A placement racing the closing loses in the statement's own `WHERE`; a return during the closing succeeds.
- `beginClosingOnTimer` records the opener as requester; `completeBreakoutRound` closes the round and every open placement at one instant with the right reason, and a second call writes nothing.
- Every stay-closing path — leave, socket loss, removal of a member and of a guest, a guest's departure, the end — leaves no open placement behind, each asserted separately; the end closes the round `meeting-ended` at the meeting's instant.
- The placements read walks both stay kinds across a page boundary in `(placed_at, id)` order.
- Every audit row written here carries identifiers and instants, and no room name.

**`packages/meetings/test/placement-closes-with-stay.test.ts`** — a source scan: every module composing `closeAttendanceStatement`, `closeGuestStayStatement` or `closeAllAttendanceStatement` also composes the placement's close. A new way to close a stay that forgets the placement fails it by name.

**`apps/api-worker/test/meeting-breakouts-routes.test.ts`:** every host route is 403 `meeting-not-host` to a key-holder with no grant; `arrangement` is empty for a non-host and populated for a host; a walled matter's meeting is 404 on every route; a breakout handle from another meeting is `meeting-breakout-not-found`; the socket route addresses the room the placement names whatever the URL says; a closed stay's upgrade is refused wherever the placement points; the chat post writes the poster's breakout and the scoped read returns only that room's lines; a repeated placements call re-sends the arrangement to the main room.

**`apps/api-worker/test/meeting-room-breakouts.test.ts`** (real objects, the fake routing service):

- A move force-closes the mover's published tracks and subscribed sections in ONE call on their session, carries the session, and sends `move` with the description before closing the socket; the destination holds the carried record before the `move` is sent.
- The source's remaining sockets receive one `left` for a batch; the destination's receive one `joined`.
- An upgrade with `carrying=true` over a marked record keeps the session and welcomes `carried: true`; the same upgrade over an unmarked record, and an upgrade without `carrying` over a marked one, reset and close the stored session; a second tab after the first welcome finds no marker.
- An arrival no socket claims is swept at its grace, closing the stay and the session.
- A subscription from room 3 naming a session in room 4 is `unknown-track`.
- `hostingChanged` reaches a co-host in a breakout: their next `mute` there is `not-host`.
- `ask-for-help` in a breakout sets the room fact, reaches the main room's hosts on `breakouts`, and clears when a grant-holder is placed there; from the main room it is `not-in-a-breakout`; a second inside the signal window is `rate-limited`.
- A guest's `room-state` carries `rooms: []` while a member's carries every room.
- The closing countdown fans `room-state` to every room; the alarm at `closingAt` commits and returns everybody to the main room; a failed commit re-arms at the retry interval; the main room's `end` ends every breakout room.
- Removal, leave and guest-link rotation reach a stay that is in a breakout through the main room's forwarding.

**`apps/api-worker/test/meeting-room-load.test.ts`** — the breakout pass of section 16, asserting its bounds.

**`packages/meeting-protocol/test/frames-have-handlers.test.ts`** — unchanged, and green only when both halves have landed.

**`apps/web/test/`:**

- `breakout-split.test.ts` — three hundred into fifty differ by at most one per room; grant-holders are left out; the same seed gives the same split; a reshuffle moves people.
- `meeting-client.test.ts` — `move` clears every pulled track without sending `close`, stops a screen share without sending `close`, applies the description and holds the answer, reopens with `carrying=true`, and on `welcome { carried: true }` sends `renegotiate` then one `publish` reusing the camera's and the microphone's sections; a host-muted microphone is not republished; `welcome { carried: false }` re-joins and rebuilds; the old socket's close is not a failure.
- `meeting-breakouts.test.ts` — the panel's two stages against a host, a co-host and a member; Close All Rooms asks first; the banner's countdown counts from the room's `at`; Choose a Room appears only in a self-select round and never for a guest; Ask for Help appears only in a breakout.
- `meeting-chat.test.ts` — the panel reads its room's scope and names the room.
- `meeting-room-page.test.ts` — the `moving` standing renders the move state and returns to the gallery on welcome.

## 22. The files, and who owns each

Two agents, and every file has exactly one owner: **the backend agent owns everything under `packages/` and `apps/api-worker/`, the emitted contract and the generated client, and the ledger and record fragments; the web agent owns everything under `apps/web/` and `docs/user/`.** The contract is the hand-off — the backend emits and regenerates first. Both halves merge in one pull request, because the frames fitness function is in the gate and `main` deploys.

**Sequencing.** After the guest slice has landed: it is in flight in `packages/meetings/src/guest-service.ts`, `guest-removal.ts`, `meeting-statements.ts`, `apps/api-worker/src/routes/meetings-guest.ts`, `contracts/problem-types.ts` and the room modules, all of which this slice touches.

### Backend agent

- `packages/database/src/per-firm-schema.ts` — the three tables, `meeting_message.breakout_id`
- `packages/database/drizzle/per-firm/<timestamp>_a-meeting-splits-into-breakout-rooms.sql`, the refreshed snapshot under `packages/database/drizzle/per-firm/meta/`, and the regenerated `apps/api-worker/src/per-firm-migrations.ts`
- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts` — the three handles
- `packages/data-access/src/pii-registry.ts` — the columns of section 12
- `packages/meetings/src/breakout-types.ts`, `breakout-statements.ts`, `breakout-service.ts` (new)
- `packages/meetings/src/validation.ts` — the six codes
- `packages/meetings/src/meeting-service.ts`, `hosting-service.ts`, `guest-service.ts`, `guest-removal.ts` — the placement's close in every stay-closing path, and the round's close in the end
- `packages/meetings/src/chat-service.ts`, `chat-statements.ts`, `chat-types.ts` — the breakout on the write, the scope on the read
- `packages/meetings/CLAUDE.md` — the placement rule and the stay-closing composition
- `packages/meetings/test/breakouts.test.ts`, `placement-closes-with-stay.test.ts` (new); `chat-service.test.ts`, `guests.test.ts`, `host-grants.test.ts`, `meeting-service.test.ts` — the stay-closing assertions
- `packages/meeting-protocol/src/frames.ts`, `src/types.ts` — the four frames, `MeetingRoomState.breakouts`, `welcome.carried`, `MeetingChatMessage.breakoutId`, `not-in-a-breakout`
- `packages/meeting-protocol/CLAUDE.md` — which frames reach only some sockets: `move` one, `breakouts` the grant-holders
- `packages/telemetry/src/events.ts` — section 18
- `apps/api-worker/src/meetings/room-address.ts` (new) — the two keys
- `apps/api-worker/src/meetings/meeting-room.ts` — the attachment's two values and the methods of section 16
- `apps/api-worker/src/meetings/room/room-transfer.ts`, `room/room-breakouts.ts` (new)
- `apps/api-worker/src/meetings/room/room-state.ts` — the keys, the stored shapes, `roomStateOf` with breakouts, `announceRoomState` per viewer
- `apps/api-worker/src/meetings/room/room-lifecycle.ts` — the carried session at upgrade, the two alarm jobs, the forwarding in `participantLeft` and `endMeeting`
- `apps/api-worker/src/meetings/room/room-frames.ts` — the two client frames
- `apps/api-worker/src/meetings/room/room-hosting.ts` — `clear-help`; the forwarding in `hostingChanged`, `participantRemoved`, `guestCredentialReplaced`, `roomStateChanged`
- `apps/api-worker/src/meetings/room/room-lobby.ts` — `lobbyChanged` forwarded; `waitingCount` to grant-holders outside the main room
- `apps/api-worker/src/meetings/room/room-chat.ts` — the relay by room
- `apps/api-worker/src/meetings/room/room-diagnostics.ts` — `breakoutId` on every event, the new records
- `apps/api-worker/src/meetings/room/room-inspect.ts` — the breakout facts and jobs
- `apps/api-worker/src/meetings/CLAUDE.md` — the module map, the one-door rule, the carried session
- `apps/api-worker/src/routes/meeting-breakouts.ts` (new); `routes/meetings.ts` (the socket route, `meetingRoomFor` delegating); `routes/meetings-guest.ts` (the guest socket route, the guest chat scope); `routes/meeting-chat.ts`; `routes/meeting-inspect.ts`
- `apps/api-worker/src/app.ts` — registering the route bundle
- `apps/api-worker/src/contracts/problem-types.ts` — the six problem types
- `apps/api-worker/openapi/openapi.json` (emitted) and `packages/api-client` (generated), never hand-edited
- `apps/api-worker/test/meeting-breakouts-routes.test.ts`, `meeting-room-breakouts.test.ts` (new); `meeting-room-load.test.ts` and `test/support/meeting-room-load.ts`; `meetings-routes.test.ts`, `meetings-guest-routes.test.ts`, `meeting-chat-routes.test.ts`, `meeting-inspect-routes.test.ts`
- `roadmap.d/meetings.md` (`meetings.breakout-rooms` to `designed`, then `in-build`, then `shipped`), `pnpm exec vp run register-build`, `status.d/meetings.md`, `STATUS.md`, `STATUS.json`, `docs/now.md`, `changelog.d/<slug>.md`, and `docs/decisions/pending/<slug>.md` for decisions 1 and 3 — a breakout is a room object of its own, and a move keeps the session and closes every track across the boundary

### Web agent

- `apps/web/src/lib/meetings/client/meeting-client.svelte.ts` — the `moving` standing, `move`, `breakouts`, `welcome.carried`, the republish, `askForHelp`, `clearHelp`
- `apps/web/src/lib/meetings/client/signaling.ts` — `case "move"`, `case "breakouts"`, their handlers, and a socket switch that is not a loss
- `apps/web/src/lib/meetings/client/breakouts.ts` (new) — the readers for both frames and for `room-state`'s breakouts, and the sentences
- `apps/web/src/lib/meetings/client/breakout-split.ts` (new) — `proposeEvenSplit`
- `apps/web/src/lib/meetings/client/capture.ts` — re-offering the camera on its own section
- `apps/web/src/lib/meetings/client/host-controls.ts` — `readRoomState` reads `breakouts`
- `apps/web/src/lib/meetings/client/chat.svelte.ts` — the room scope
- `apps/web/src/lib/api/socket-url.ts` — `carrying` on both socket addresses
- `apps/web/src/lib/meetings/meetings-api.ts` — the five breakout calls and the placements read
- `apps/web/src/lib/meetings/screen/meeting-controls.svelte` — the Breakout Rooms control and its badge
- `apps/web/src/lib/meetings/screen/meeting-breakouts-panel.svelte`, `meeting-breakout-banner.svelte`, `meeting-breakout-choice.svelte` (new)
- `apps/web/src/lib/meetings/screen/meeting-chat-panel.svelte` — the room's name on the panel
- `apps/web/src/lib/meetings/meeting-attendance-panel.svelte`, `meeting-attendance.ts` — the placements under each stay
- `apps/web/src/lib/meetings/guest-meeting.svelte` — the banner for a guest
- `apps/web/src/routes/(app)/meetings/[id]/+page.svelte` — the wiring
- `apps/web/src/lib/meetings/CLAUDE.md` — the move, and the two new modules
- `apps/web/test/breakout-split.test.ts`, `meeting-breakouts.test.ts` and a `meeting-breakouts-harness.svelte` (new); `meeting-client.test.ts`, `meeting-chat.test.ts`, `meeting-room-page.test.ts`, `meeting-controls-harness.svelte`
- `docs/user/features/meetings.md` — running breakout rooms, and what a participant sees

## 23. What this does not settle

- **A host's typed message to every room at once.** It is content, so it belongs on the record with chat and is designed with it rather than as a frame here.
- **Rooms prepared before the meeting**, from the event's participant list. Scheduling's question, and it needs the placements to be on the record before anybody has a stay.
- **Recording a breakout room.** Section 10 states what this design needs of recording; recording a second room is recording's own decision.
- **A count of people per room for a member choosing.** Deliberately absent (section 17), not deferred.
- **A per-room lead.** Deliberately absent (section 7).
- **A guest choosing a room or returning on their own.** Deliberately absent (section 4).
- **Cancelling a countdown once it has begun.** A host who closes too early reopens a round.
- **Placing somebody straight from the door into a breakout.** Admission lands in the main room.
- **Room templates a firm saves and reuses.**
- **Whether a breakout's lines are readable by members who were never in it.** The owner's open question on the transcript, unchanged.
- **The Realtime API's own limits under a whole-meeting move.** The harness runs against a fake routing service; whether three hundred forced closes, renegotiations and publishes inside a few seconds meet a limit Cloudflare applies is unmeasured until a real round is run.
- **A carried session that outlives its relay credentials.** A peer connection that needs to gather candidates again more than an hour after the join's credentials were minted has nothing fresh to gather with; the fallback re-join mints new ones, and whether that happens in practice is measured, not assumed.
- **The desktop shell.** Parity holds by construction — the room is the web client — and nothing here is platform-specific.
