# Dial-in by phone — the telephony port, the bridge, and the door

**Status:** Design, 2026-09-24. Not accepted; the owner questions in section 16 are open.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — the meeting record, the `MeetingRoom` Durable Object, the routing-service client under `apps/api-worker/src/meetings/sfu/`, the routes and the screen. Nothing here rebuilds any of it.
**Beside:** [`2026-09-20-meetings-external-guests-design.md`](2026-09-20-meetings-external-guests-design.md) — a dial-in caller is a participant with no browser, and the closest thing the record already has to one is a guest. [`2026-09-20-meetings-host-controls-and-waiting-room-design.md`](2026-09-20-meetings-host-controls-and-waiting-room-design.md) — the door every caller waits at. [`2026-09-20-meetings-recording-and-transcription-design.md`](2026-09-20-meetings-recording-and-transcription-design.md) — the routing service's WebSocket adapter, which this design uses in both directions where recording uses it in one.
**Research:** [`docs/research/2026-09-20-meeting-recording-paths.md`](../research/2026-09-20-meeting-recording-paths.md) for the adapter; section 17 below for everything read on 2026-09-24. **Companion research:** [`docs/research/2026-09-24-meetings-end-to-end-encryption.md`](../research/2026-09-24-meetings-end-to-end-encryption.md), which is why dial-in is refused in an end-to-end encrypted meeting.
**White paper:** _Communications layer_ (voice and telephony, the `telephony` port, Telnyx as launch adapter), _Plugin / Add-on system_ (ports and adapters), _Authentication, access control & encryption_. **Decision:** ADR-0047 (messaging and telephony behind plugin ports; Telnyx the launch adapter; transcription in-house).
**Ledger:** the `meetings.dial-in` node in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md), whose evidence line reads "blocked on the communications layer's voice port, which has no adapter yet". This design is that port's first use.

## 1. What this settles

Somebody without a browser — a client in a car, an expert on a landline, a partner whose laptop will not join — calls a telephone number, types a number on the keypad, waits at the door, is let in by a host, and then hears the meeting and is heard in it. Everyone else sees a tile with a telephone on it. The record says who called, when they were let in, when they left, and the last four digits of the number they called from.

Nine decisions carry the design.

1. **The carrier terminates the call and hands us audio over a WebSocket; a Durable Object we run bridges that audio into the meeting through the routing service's WebSocket adapter, both ways.** No container, no WebRTC stack of our own, no codec library, no C or C++ in our deployment. Section 3.
2. **The routing service does not mix, so we do.** A caller hears one mixed stream of at most four other people, chosen by who spoke most recently, summed in TypeScript in the bridge. The mixer is integer addition and a resampling filter, measured in operations per second and well inside one object's budget, so it is TypeScript rather than Rust compiled to WebAssembly and nowhere near a container. Section 4.
3. **Cloudflare is building exactly the piece this design writes by hand.** A draft documentation change dated 2026-09-05 describes a SIP gateway into Realtime with a server-side mix of the tracks a caller hears. It is "in development and not yet generally available", so nothing is built against it; the port and the record are shaped so that when it ships, the bridge is replaced and nothing else moves. Section 3.3 and owner question T2.
4. **A caller proves possession of a twelve-digit PIN, minted per person per meeting, like the guest link.** A guest's PIN travels in the invitation mail beside the link; a member mints their own from the meeting. The PIN is stored only as a keyed verifier. Section 5.
5. **Every caller waits at the door, member or guest, whatever the lobby setting says,** because twelve digits prove possession of twelve digits and nothing else. The host sees the invited name and the last four digits of the calling number before deciding. Section 6.
6. **A phone stay is a member stay or a guest stay with `channel = 'phone'`, not a third kind of stay.** One additive column on each of the two stay tables, and the phone-specific facts on a leg table of their own. Section 7.
7. **The telephony port is a domain package, `@magna-carta/telephony`, built on `@magna-carta/integrations`, not a file inside it** — the integrations package's own rule, and the reason is given in section 10. The first adapter is Telnyx.
8. **No telephone number is kept or emitted in the clear.** The record and the lobby carry the last four digits; telemetry carries at most the last four; the full number exists only in memory while a call is being answered, and the brute-force guard keys on a keyed hash of it. Sections 8 and 12.
9. **Nothing in this design needs a golden-rule-14 consent,** and the one path that would — a container speaking WebRTC to the routing service, which needs an Opus codec — is named and routed to the owner rather than taken. Section 14.

## 2. What the routing service and the carriers actually offer

Facts, each with its source in section 17. The design uses nothing that is not on this list.

| Question                                                     | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can our code put audio INTO a meeting without a browser?     | **Yes.** The WebSocket adapter's ingest direction (`location: "local"`, `inputCodec: "pcm"`, buffer mode) publishes PCM we send as a track in a session. "The SFU opens a WebSocket connection to the `endpoint` URL you supply" — the routing service dials us in both directions. Ingest audio "is not charged as ingress".                                                                                                                                                                                                            |
| Can our code take audio OUT of a meeting?                    | **Yes, one track per adapter.** Egress (`location: "remote"`, `outputCodec: "pcm"`), stream mode, the routing service reconnecting for up to five seconds. Counted as Realtime egress at $0.05/GB inside the shared 1,000 GB free tier; free while the adapter is in beta.                                                                                                                                                                                                                                                               |
| In what format?                                              | 16-bit signed little-endian PCM, 48 kHz, stereo interleaved, Protocol Buffers framing (`sequenceNumber`, `timestamp`, `payload`), each message under 32 KB.                                                                                                                                                                                                                                                                                                                                                                              |
| How is the endpoint the routing service dials authenticated? | "Scoped tokens in the URL path/query string authenticate connections. No custom WebSocket headers allowed." This settles the recording design's first open question in the direction that design hoped: a token in the path is the documented mechanism.                                                                                                                                                                                                                                                                                 |
| Does the routing service mix?                                | **No, today.** The adapter page mentions no mixing and is one adapter per track; the recording research note records "no mixing or compositing is offered".                                                                                                                                                                                                                                                                                                                                                                              |
| Is Cloudflare building telephony into Realtime?              | **Yes, in development.** A draft documentation change (`src/content/docs/realtime/sfu/bridge-phone-call-sip.mdx`, opened 2026-09-05, unmerged) describes a SIP gateway at `sip.rtc.live.cloudflare.com:5601` over TLS with digest authentication, a `sip.call.incoming` webhook, accept / terminate calls, the caller's voice appearing "as a track in your app", and `PUT /v1/apps/{appId}/sip/calls/{callId}/mix` naming which tracks the caller hears. G.711 only; inbound only; "in development and is not yet generally available". |
| What does Telnyx deliver?                                    | Call Control webhooks signed with Ed25519, and media streaming over a WebSocket Telnyx dials at a `stream_url` we name: `connected`, `start`, `media` (base64 audio), `stop` and `dtmf` events, with bidirectional mode (`stream_bidirectional_mode: "rtp"`) accepting audio back. Codecs PCMU, PCMA, G722, OPUS, AMR-WB and L16.                                                                                                                                                                                                        |
| What does Twilio deliver?                                    | Media Streams over `<Connect><Stream>`, bidirectional, with audio in both directions as base64 `audio/x-mulaw` at 8 kHz.                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 3. The bridge

### 3.1 The path

```
PSTN caller ──> carrier (Telnyx) ──Call Control webhooks (Ed25519)──> api-worker: telephony lane
                     │                                                    │  number → firm (control plane)
                     │                                                    │  PIN → stay at the door (firm database)
                     │                                                    ▼
                     │                                          MeetingRoom (lobby: a phone waiter)
                     │                                                    │  host admits
                     │                                                    ▼
                     └──media stream WebSocket (L16)──────────> MeetingPhoneBridge (Durable Object, one per call)
                                                                  │   ▲
                              caller audio: L16 16 kHz → 48 kHz   │   │ mixed audio: 48 kHz → 16 kHz → L16
                                                                  ▼   │
                                              ingest adapter (PCM) │   │ egress adapters (PCM), at most four
                                                                  ▼   │
                                                       Cloudflare Realtime SFU ──Opus──> every browser in the room
```

The caller's voice becomes an ordinary published audio track, `${stayId}:audio`, in a routing session the bridge owns; the roster lists it like any other participant's microphone, and every browser pulls it through the subscription policy it already runs. What the caller hears is the bridge's own mix of the room's audio tracks. Every box is Cloudflare-managed, the carrier's, or TypeScript.

### 3.2 Why this path and not the others

| Path                                                                                                                               | Verdict                               | Why                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Carrier media stream → our Durable Object → WebSocket adapter both ways** (this design)                                          | **Chosen**                            | Documented on both sides today, pure TypeScript on ours, no container, no codec. Its costs are the adapter's PCM egress and a carrier's per-minute rate, priced in section 13.                                                                                                   |
| **Cloudflare's SIP gateway into Realtime**                                                                                         | **The successor, not buildable yet**  | Removes the bridge object, the adapters and the mixer, and brings the carrier leg down to plain SIP trunking. Unmerged draft documentation, "not yet generally available", G.711 only, and it documents no DTMF — so how a PIN would be collected on it is unknown. Section 3.3. |
| **A container speaking SIP and RTP to the carrier and WebRTC to the routing service** (`str0m` or `webrtc-rs/rtc`, both pure Rust) | **Rejected unless the adapter fails** | The WebRTC half needs Opus encode and decode, because the routing service speaks Opus to a WebRTC peer. libopus is C; the pure-Rust Opus crates are young. Section 14, owner question T3.                                                                                        |
| **The carrier's own WebRTC client SDK in a headless browser**                                                                      | **Refused**                           | A headless Chromium in a container is a C++ browser engine parsing privileged media — the worst case golden rule 14 exists to prevent — for a job the adapter does without it.                                                                                                   |
| **The carrier's conference bridge with the meeting dialled into it**                                                               | **Refused**                           | The routing service cannot dial a telephone, so the meeting's audio would have to leave for the carrier's mixer anyway, and the carrier would then hold the whole meeting's audio rather than one caller's.                                                                      |

### 3.3 When Cloudflare's gateway ships

The draft describes an accept call that names the initial mix inputs and a mix update that replaces them. That is the bridge's mix-selection policy (section 4.2) with the arithmetic moved to Cloudflare. So the design draws its line there:

- **What survives unchanged:** the PIN, the door, the record, the telephony port and its webhook lane, the brute-force guard, the prompts, the room's phone waiter, the roster's phone mark, and the mix-selection policy (which becomes the body of a `PUT …/mix`).
- **What is replaced:** `MeetingPhoneBridge`, the ingest and egress adapters for a phone leg, the resampler and the mixer. The carrier leg changes from a media stream to a SIP trunk into Cloudflare, and the carrier's per-minute line drops from Call Control plus media streaming to inbound SIP trunking.
- **What is unknown and has to be asked before anything is built against it:** how DTMF reaches us (the draft is silent; if it does not, the PIN is collected by the carrier's Call Control and the call is then transferred to the SIP URI, which Telnyx prices at $0.10 per transfer), Cloudflare's price per SIP minute and per mixed stream, and the date.

The seam is one interface in the worker, `PhoneAudioBridge`, with `open`, `updateMix`, `mute`, `playPrompt` and `close`; this design builds the carrier-media-stream implementation behind it. Owner question T2 asks whether to build it or wait.

## 4. The mixer

### 4.1 Can the routing service mix, and if not, what mixes

It cannot today (section 2). Without a mixer a caller could hear exactly one track — one other person — which is not a meeting. So the bridge mixes, and the mix is ours to write and to price.

**What the mix is, per 20 milliseconds of output:**

1. From each egress input's jitter buffer, take 960 samples at 48 kHz, downmixed to mono by averaging the two channels (the recorder's step, with the recorder's reasoning: whether the adapter emits true stereo is unconfirmed, and averaging is right either way).
2. Sum the inputs into one `Int16Array` with saturation — `packages/meetings/src/pcm-mix.ts`, the recording design's pure function, reused rather than written twice.
3. Low-pass and decimate by three to 16 kHz (a polyphase finite-impulse-response filter with a fixed table of about 48 taps; the table is the filter, and the filter is a unit test).
4. Encode as the carrier's format — for Telnyx, L16, which is big-endian by its RTP definition while the adapter's PCM is little-endian, so the bytes are swapped (unconfirmed against Telnyx until the first experiment; section 15) — base64 it, and send one `media` message.

**The caller's own audio goes the other way:** L16 at 16 kHz from the carrier, byte-swapped, interpolated by three to 48 kHz with the same filter's partner, duplicated into two channels, framed as a Protocol Buffers envelope carrying only `payload` (buffer mode), and written to the ingest socket. The caller's own track is never an input to their own mix, so they never hear themselves.

**The clock is the caller.** A Durable Object has no audio clock and a timer loop would drift against the carrier's. The carrier sends a frame every 20 milliseconds, so each inbound caller frame is the tick that emits one outbound mixed frame. Each egress input sits behind a jitter buffer with a 60-millisecond target and a 200-millisecond ceiling: an underrun is silence, an overrun drops the oldest frame, and a `sequenceNumber` gap is filled with silence of its length (the recorder's rule), so no input can drift the mix.

**Why TypeScript and not Rust compiled to WebAssembly.** Four inputs at 48 kHz is 192,000 additions a second; the two resampling filters are about a million multiply-adds a second between them. That is a fraction of one core for a JIT-compiled loop over typed arrays, and both languages are memory-safe, so the only argument for Rust is speed nobody has shown is needed. The load profile measures it (section 15); if the bridge's CPU per call-hour comes back uncomfortable, the move is the same Rust-to-WebAssembly step `packages/pdf` already took, and it is a performance change, not a consent question.

**Why not a container.** Nothing here needs one. A container would add a second deployment, a cold start and an always-warm cost for a job measured in a few million integer operations a second.

### 4.2 Which tracks a caller hears

`MAX_PHONE_MIX_INPUTS = 4`, chosen by the same ranking the browser's subscription policy already uses: unmuted audio publishers, most recent speaker first, then roster order, never the caller's own track. The room already relays `speaking` and `muted` presence for exactly this purpose, so the bridge takes the coalesced presence flush the room already produces (one RPC per flush, never per transition) and recomputes its set.

- **In a room with four or fewer other unmuted publishers — the ordinary law-firm call — the set never changes** and nothing is ever clipped.
- **In a larger room the set churns only when a fifth person starts speaking,** and the least recently heard input is replaced. The new speaker's adapter has to be created and has to dial the bridge, so their first words can be clipped by that set-up time. That is the cost of not paying egress on every microphone in a three-hundred-person room, it is stated here rather than discovered, and it is exactly the problem Cloudflare's server-side mix removes.
- **A muted participant's adapter is closed,** because a muted browser track would otherwise be paid for as silence.

### 4.3 What it costs to run

Per phone leg, per hour, at four inputs: the adapter egress is 4 × 691 MB = 2.76 GB, or **$0.138** at $0.05/GB once the adapter leaves beta (free until then); the ingest is free; the bridge object is 128 MB for 3,600 seconds = 450 GB-s, or **$0.006** at $12.50 per million GB-s; its inbound WebSocket messages — about 250 a second across the carrier socket and four inputs, billed at twenty messages to a request — are about 45,000 requests, or **$0.007** at $0.15 per million. **About $0.15 per caller-hour on Cloudflare, $0.012 while the adapter is free.** Section 13 adds the carrier.

## 5. Who a caller is — the PIN

### 5.1 One PIN per person per meeting

A PIN names **one stay-to-be**: a guest invitation, or a member of the firm, on one meeting. It never names a meeting alone, because a meeting-wide PIN is a password shared by everybody on the invitation and the lobby would have nothing to tell the host about who is calling.

- **A guest's PIN is minted with the guest invitation, in the same batch,** and travels in the same invitation mail beside the link, as two lines: the firm's dial-in number and the PIN. Rotating the link rotates the PIN; revoking the link revokes the PIN. A guest therefore has one credential to lose, and the host has one act to take it back.
- **A member mints their own,** from the meeting's entry window or the room, with `POST /api/v1/meetings/{meetingId}/dial-in` under `meetings:join`. It answers the number and the PIN, **once**. Asking again mints a fresh PIN and retires the previous one. That is deliberate: a PIN a member can read back later is a PIN the record has to be able to decrypt, which means a sealed column, a decrypt permission and an audit row per look — for something that lives for one meeting. The guest link already takes the same posture (the row keeps a hash, never the secret).

### 5.2 Format and strength

**Twelve digits**, read and printed as three groups of four (`4821 5530 9716`), collected with a `#` terminator. The arithmetic that sets the length is in section 8.

The PIN is drawn from `crypto.getRandomValues` through `@magna-carta/identifiers/random`, as every credential here is, by rejection sampling so each digit is uniform.

### 5.3 What is stored

**A keyed verifier, never the PIN:** `pin_verifier = HMAC-SHA-256(MEETING_DIAL_IN_PIN_KEY, firmId | pin)`, hex, with `verifier_key_version` beside it. Keyed rather than a plain hash because twelve digits is 10^12 candidates, which an unkeyed SHA-256 table would exhaust offline in hours from a copy of the database; with the key held as a Worker secret, a stolen database alone yields nothing. The firm id inside the input binds a verifier to its firm. The verifier is unique across the firm's table forever (a collision at mint re-mints), so a lookup is one indexed equality and no PIN is ever reissued within a firm.

This is not a `protected()` field and not a blind index, and it is worth saying why so nobody "fixes" it into one. A blind index is truncated to at most 32 bits by design, so that an exact-match channel leaks little; a PIN verifier's whole job is authentication, where truncation is a false positive. And there is no ciphertext to protect, because nothing ever needs the PIN back.

Rotating `MEETING_DIAL_IN_PIN_KEY` invalidates every outstanding PIN. PINs live for a meeting, so that is acceptable; the version column is what lets a rotation say so rather than fail mysteriously.

### 5.4 When a PIN opens anything

A PIN opens the door only inside its window:

```
not_before = max(issued_at, eventStartInstant - DIAL_IN_EARLY_MINUTES)        DIAL_IN_EARLY_MINUTES = 15
expires_at = the guest link's own expiry formula (event end + 2 hours, at most 14 days from issue)
```

Both are instants computed once at mint and stored, per [`docs/conventions/dates.md`](../conventions/dates.md); an event with no start time takes the start of its day in the event's own zone, as the guest link does for an event with no end. And never once the meeting is `ended`. The window is the brute-force section's largest lever: a PIN that is valid for three hours rather than fourteen days is a PIN nobody can grind at for two weeks.

## 6. The door

### 6.1 Every caller waits

**A phone arrival opens a stay at the door — `waiting_from` set, `admitted_at` null — whatever `meeting.lobby` says, member or guest, host or not.** The waiting room's rule that "whoever may run this room does not wait" rests on a session: the member arriving is provably the member. Twelve digits prove only that somebody has twelve digits, and a member's PIN written on a pad or read aloud in an open-plan office is a way into a privileged conversation that nobody decided on. So the PIN gets a caller to the same place the guest link gets a guest: in front of a host.

The consequence is stated because it is real: **a meeting where everybody dials in and nobody has a browser open cannot admit anybody.** A host must be in the room from a browser. Owner question T4 asks whether a member's PIN should admit directly when the lobby is off, which is the shape Zoom offers and the one that serves a partner dialling in from a car.

### 6.2 What the host sees

The lobby list and the hosts' `waiting` frame gain two optional fields, additive, on `WaitingParticipant` in `packages/meeting-protocol/src/types.ts`:

```
channel?: "browser" | "phone"                  -- absent reads as browser
callerNumberLastFour?: string | null           -- phone only; null when the caller withheld their number
```

The host's lobby row reads **"Jane Hollis — Guest, invited as Acme Corporation — Phone ending 4417"**, or **"Phone, number withheld"**. The display name for a phone stay is the invited name (a guest) or the member's display name: a caller cannot type one, so a guest phone stay records the invited name as `confirmed_name`, and the `channel` column says why the two agree. The last four digits are the whole of what the host has to catch a forwarded PIN, which is why they are shown and why nothing more is.

`callerNumberLastFour` travels **only** on the hosts' `waiting` frame and the lobby read, never on a roster: the people in the room see a name and a telephone glyph, and the calling number is not theirs to know.

### 6.3 A waiter with no socket

The room's lobby model assumes a waiter holds a socket — the waiting room's amendment gives a waiter's dropped socket the roster's own grace sweep. A caller has no socket to the room. So the room gains a concern module, `room/room-phone.ts`, and four RPCs the telephony lane and the bridge call:

- `phoneArrived({ stayKind, stayId, displayName, invitedName, callerNumberLastFour, legId })` — stores `waiting:<stayId>` with `channel: "phone"` and the leg handle, and sends the hosts a fresh `waiting`. Like every waiter, the phone waiter is not in the set the roster is made of.
- `phoneLeft(stayId, reason)` — the caller hung up, at the door or in the room.
- `phonePublished(stayId, sfuSessionId, trackName)` — the bridge's ingest track exists; the roster announces the arrival as an ordinary join with `channel: "phone"`.
- `phonePresence(stayId, speaking, muted)` — the bridge measured the caller's level (section 9.1).

**Liveness belongs to the bridge, not to a socket.** The grace sweep skips `channel: "phone"` records. In their place the bridge reports every `PHONE_BRIDGE_HEARTBEAT_SECONDS = 30`, and the room's existing alarm closes a phone participant whose bridge has been silent for sixty seconds (`ended_reason: 'socket-lost'`, leg `end_reason: 'bridge-lost'`), then asks the telephony lane to hang the call up. That is the per-person grace translated, and it is the one addition to the alarm's reconciliation, on the rule that a deadline the alarm waits on is reconciled in `armAlarm` and not only armed for.

**Admission and denial are the waiting room's, unchanged.** The same routes, the same guarded statement, the same ceiling. On admission the room calls the bridge's `open`; on denial the telephony lane plays the denied prompt and hangs up, and the stay closes `denied`, which bars that PIN for the life of the meeting exactly as it bars the guest link.

## 7. The record

### 7.1 Not a third kind of stay

The guests design already paid for a second stay table, and wrote down the cost: "every read of who is in this meeting must now read both tables, and one that forgets silently under-reports the record." A third table for callers would make every one of those unions three-way, and the "in the room" and "waiting" predicates — one home each, in `meeting-statements.ts` — would have to learn a third source for a difference that is not about presence at all. A caller is in the room or at the door on exactly the terms a member or a guest is; what differs is how their audio arrives.

So **the channel is a column on the stay, and the telephone facts live on a leg:**

```
meeting_attendance  (added)
  channel              text not null default 'browser'   -- 'browser' | 'phone'  (CHECK)

meeting_guest_stay  (added)
  channel              text not null default 'browser'   -- 'browser' | 'phone'  (CHECK)
```

Both are `ADD COLUMN` with a default, which SQLite does in place — no rebuild, nothing on the reviewed-rebuild register. The two presence predicates do not change: a phone stay is present or waiting by the same instants.

**A member already in the room cannot also dial in.** `meeting_attendance_open_stay_unique_index` holds one open stay per member per meeting, and a phone arrival for a member with an open stay is refused (`already-joined`) rather than superseding it: taking over a browser stay from a keypad would end a member's video on the strength of twelve digits. Pairing a phone audio leg with a browser stay is named in section 19.

### 7.2 Two new per-firm tables, one control-plane table

```
meeting_dial_in_pin
  id                     text pk            -- meetingDialInPin_ handle
  meeting_id             text not null -> meeting.id
  holder_kind            text not null      -- 'member' | 'guest'  (CHECK)
  user_id                text null     -> member.user_id
  invitation_id          text null     -> meeting_guest_invitation.id
  pin_verifier           text not null      -- HMAC-SHA-256 hex; never the PIN
  verifier_key_version   integer not null
  issued_by_user_id      text not null -> member.user_id
  not_before             text not null      -- instant
  expires_at             text not null      -- instant
  revoked_at             text null
  revoked_by_user_id     text null     -> member.user_id
  arrival_count          integer not null default 0
  created_at, updated_at
  UNIQUE (pin_verifier)
  partial UNIQUE (meeting_id, user_id) WHERE revoked_at IS NULL AND holder_kind = 'member'
  partial UNIQUE (invitation_id)        WHERE revoked_at IS NULL
  CHECK exactly one of user_id / invitation_id, matching holder_kind
  CHECK (revoked_at IS NULL) = (revoked_by_user_id IS NULL)

meeting_phone_leg
  id                     text pk            -- meetingPhoneLeg_ handle
  meeting_id             text not null -> meeting.id
  stay_kind              text not null      -- 'member' | 'guest'  (CHECK)
  stay_id                text not null      -- the stay, BY VALUE, no foreign key (the chat precedent)
  dial_in_pin_id         text not null -> meeting_dial_in_pin.id
  telephony_number_id    text not null      -- control-plane handle, by value
  adapter_id             text not null      -- 'telnyx'
  call_remote_id         text not null      -- the carrier's own call handle
  caller_number_last_four text null         -- four digits; null when withheld  (CHECK)
  connected_at           text not null      -- instant the call reached the door
  bridged_at             text null          -- instant the audio bridge opened (admission)
  ended_at               text null
  end_reason             text null          -- 'hung-up' | 'left-at-door' | 'denied' | 'removed'
                                            -- | 'meeting-ended' | 'carrier-lost' | 'bridge-lost'  (CHECK)
  bridged_seconds        integer null       -- seconds with audio open, for reconciling the carrier's bill
  created_at, updated_at
  UNIQUE (adapter_id, call_remote_id)
  UNIQUE (stay_id)
  INDEX (meeting_id)
```

**Control plane:**

```
telephony_number
  id                     text pk            -- telephonyNumber_ handle
  e164                   text not null unique
  firm_id                text not null -> firm.id
  purpose                text not null      -- 'meeting-dial-in' | 'reception'  (CHECK)
  adapter_id             text not null
  remote_id              text null          -- the carrier's own handle for the number
  active                 integer not null default 1
  created_at, released_at
  INDEX (firm_id)
```

**Why the control plane.** A webhook arrives with no firm context: the only fact that names the firm is the number that was dialled. `email_capture_route` is the precedent — a zone-level inbound address resolved to a firm on the control plane before any firm database is opened. A firm's own published number is not personal data. `reception` is in the CHECK now, unused, because widening a CHECK later is a table rebuild and the receptionist intake line (_Client intake / CRM_) is this port's next use.

**The leg's `(adapter_id, call_remote_id)` is the idempotency key** for a redelivered webhook, on the precedent that a processor's event is append-only and its remote id is its key: a second delivery of an arrival finds the leg and does nothing.

**Identifiers:** `meetingDialInPin`, `meetingPhoneLeg`, `telephonyNumber` in `@magna-carta/identifiers`.

**Personal-data registry:** `meeting_phone_leg.stay_id` and `caller_number_last_four`, and `meeting_dial_in_pin.user_id`, are `retain-under-matter` on the reasoning `meeting_attendance.user_id` carries — who was in the room, and how they came in, is part of what the record says happened.

**Audit rows** (`domainAuditStatement`), identifiers, counts and instants only, never a digit of a PIN or a telephone number: `meetings.dialIn.pinIssued`, `meetings.dialIn.pinRevoked`, `meetings.dialIn.arrived` (leg and stay), `meetings.dialIn.refused` (one per call, with the attempt count and the final reason), `meetings.dialIn.left`. Admission and denial are the lobby's existing rows.

**The attendance read** carries `channel` on every entry, so the Meetings page draws a telephone beside a caller.

**Settings:** `meetings.dialInEnabled`, firm-level, boolean, default **false**, on the recording design's `FirmSettingDefinition` precedent. Off, the firm's number is answered with the not-available prompt and hung up, no PIN is minted, and no invitation mail carries a number.

## 8. Refusals, and the brute-force bound

### 8.1 What a caller hears

A caller has no screen, so every refusal is a spoken prompt from a closed vocabulary, then either a second chance or a hang-up. None of them names the meeting, the event or the matter, because a prompt is heard by whoever typed the digits.

| Situation                                                                                           | Prompt                                                             | Then                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Dial-in is off for this firm, or the number is not active                                           | "Dial-in is not available on this number."                         | hang up                                                            |
| The PIN matches nothing, is outside its window, revoked, rotated, or its meeting has ended          | "That PIN is not valid for a meeting that is running now."         | ask again, up to `DIAL_IN_PIN_ATTEMPTS_PER_CALL = 3`, then hang up |
| The guard has paused this firm's dial-in (section 8.2)                                              | "Dial-in is paused. Please join from the link in your invitation." | hang up                                                            |
| The meeting is locked                                                                               | "This meeting is locked. Please try again later."                  | hang up; the PIN is not spent                                      |
| The door is full (`MAX_MEETING_LOBBY`) or the meeting has `MAX_PHONE_LEGS_PER_MEETING = 20` callers | "This meeting cannot take another caller right now."               | hang up                                                            |
| The member already has an open stay                                                                 | "You are already in this meeting from another device."             | hang up                                                            |
| The stay was removed or denied earlier in this meeting                                              | "This PIN cannot be used to join this meeting again."              | hang up                                                            |
| The meeting is end-to-end encrypted                                                                 | "This meeting cannot be joined by phone."                          | hang up                                                            |

**Every PIN that does not open a door gets the same sentence.** A PIN that exists but has expired and a PIN that never existed must be indistinguishable, or the prompt is an oracle for which twelve-digit numbers are real. The refusals after the first row of the table are spoken only to somebody whose PIN verified, who already knows everything those sentences say — the line the guests design draws between a flat refusal and a useful one, in the same place.

The guest's `arrival_count` on the invitation counts phone arrivals too, under the same `MAX_GUEST_ARRIVALS`; a member's PIN carries its own `arrival_count` against the same ceiling.

### 8.2 The limits, and the arithmetic behind twelve digits

Caller identification is trivially spoofed, so a limit keyed on the calling number bounds a careless attacker and not a determined one. The bound that holds is the firm-wide one, and the design takes it knowing what it costs.

- **Per call:** three attempts, then the call is hung up.
- **Per calling number:** `DIAL_IN_FAILURES_PER_CALLER_PER_HOUR = 10`, keyed on `HMAC-SHA-256(DIAL_IN_GUARD_KEY, e164)` so the guard's own keys hold no number. A withheld number shares one bucket with every other withheld number.
- **Per firm:** `DIAL_IN_FAILURES_PER_FIRM_PER_HOUR = 120`. Past it, PIN entry for the firm pauses for `DIAL_IN_PAUSE_MINUTES = 15`, an alert is raised through the standard pipeline, and every caller in that window hears the paused prompt.

The guard is a Durable Object, `DialInGuard`, keyed per firm, holding sliding windows in transient storage. Not the chokepoint's rate limiter, which is per isolate and therefore not a bound across the fleet; not rows in the firm database, which would let an attacker's keypad write billable storage.

**The arithmetic.** An attacker who holds the firm-wide ceiling open around the clock gets 120 × 24 = 2,880 guesses a day. With a generous 500 PINs inside their windows at once for one firm:

- ten digits: 2,880 × 500 / 10^10 = 1.4 × 10^-4 a day, about 5% over a year;
- **twelve digits: 1.4 × 10^-6 a day, about 0.05% over a year.**

A success reaches a door, not a room: the host sees an invited name and the last four digits of a number that is not that person's. Twelve is the shortest length at which the bound holds without leaning on the host to notice, and it is what a caller types once.

**The trade, stated.** The firm-wide ceiling means an attacker who fails 120 times an hour — about forty calls — pauses a firm's dial-in. Browsers are unaffected, the paused prompt sends callers to the link they were also sent, and the alert names the attack. The alternative, a ceiling that does not pause anybody, is a ceiling that does not bound anything. Availability of the telephone door under attack is traded for the confidentiality of what is behind it.

## 9. In the call

### 9.1 What the caller can do, and how the room sees them

- **Speaking presence.** The bridge measures the caller's level on the audio it already holds — the same root-mean-square and 300-millisecond hysteresis `audio-level-meter.ts` applies in a browser, as a pure function in `packages/meetings/src/pcm-level.ts` — and reports transitions through `phonePresence`. The caller's tile lights, the subscription policy ranks them as a speaker, and the recording and caption paths gate on them exactly as they gate on anybody.
- **Mute and unmute: `*6`.** DTMF arrives on the carrier's media socket as a `dtmf` event. The bridge toggles whether caller audio reaches the ingest socket, plays "You are muted" or "You are unmuted", and reports `muted` through presence.
- **Leave:** hang up.

A caller cannot raise a hand, react, chat, share a screen, or see anything. Those are not hidden controls; the channel has none.

### 9.2 What a host can do to a caller

Every host act reaches a phone stay, because a phone stay is a stay.

- **Mute one, and mute everybody else.** In a browser the room closes the target's track at the routing service because the browser is not trusted to honour a mute. The bridge is our code, so the room tells the bridge and the bridge stops forwarding — a mute the caller cannot decline, with the ingest track left open so `*6` is instant. The caller hears "The host has muted you. Press star six to unmute."
- **Ask to unmute.** "The host asks you to unmute. Press star six." A request, never a forced unmute, as it is in a browser.
- **Remove.** The removal route closes the stay `removed`; the bridge plays "You have been removed from this meeting" and the telephony lane hangs up. The PIN is barred for the meeting.
- **Spotlight** a caller: their tile is spotlit like anybody's.
- **End.** "The meeting has ended." Then hang up. Ending closes the leg in the same batch as every stay.

### 9.3 Recording, captions, and the announcement

**A caller must hear the announcement, because they cannot see the mark.** The owner's 2026-09-20 ruling makes the announcement the consent mechanism for recording, "audibly and on screen" — and for a caller, audibly is the whole of it. So the bridge plays "This meeting is being recorded" when the room broadcasts `recording { state: "started" }`, on admission while a recording runs, and "Recording has stopped" on `stopped`. Captions, which are announced as recording is, take the same prompt path.

**The recording design's notice table cannot name a guest or a caller as written, and this is cheap to fix only while it is unbuilt.** `meeting_recording_notice` carries `attendance_id -> meeting_attendance.id` and `user_id NOT NULL`, and `meeting_recording_track` carries `user_id NOT NULL` — which is the problem the guests design found on chat and solved by carrying the stay by value beside a kind. A guest at a browser, and every guest on a phone, would otherwise be recorded without a notice row: the consent record would be silent about exactly the people from outside the firm. The fix belongs to the recording design's first slice (`participant_kind` + `participant_id` by value on both tables), and it is flagged here so that slice takes it rather than a rebuild later.

The caller's own audio is recorded like anybody's: the recorder opens an egress adapter on the caller's ingest track, which is an ordinary track in an ordinary session.

### 9.4 End-to-end encryption

An end-to-end encrypted meeting cannot take a caller: the bridge would have to read the room's audio to mix it and write plaintext audio into a room whose browsers expect ciphertext. Dial-in is refused for such a meeting (section 8.1), the member's dial-in control is absent, and no PIN is minted. The companion research note is where that trade is recorded.

## 10. The telephony port

### 10.1 Where it lives, and why not inside `packages/integrations`

The brief for this design names "`TelephonyPort` in `packages/integrations`". The integrations package's own area note says otherwise, and it is right: "a port is a TS interface named in our domain vocabulary, defined by the consuming domain package (e.g. `ParcelLookupPort` in `@magna-carta/government-links`), never here and never a vendor's shape." `ShippingPort` lives in `@magna-carta/shipping` for that reason.

The consumer is not only meetings. ADR-0047's `telephony` category serves the receptionist intake line and call logging too, so the port cannot live in `@magna-carta/meetings` either. It gets a domain package of its own, **`@magna-carta/telephony`** (`packages/telephony`), on `@magna-carta/shipping`'s layout: `src/port.ts`, `src/canonical.ts`, `src/prompts.ts`, `src/manifest.ts`, and one directory per adapter. It builds on `@magna-carta/integrations` for `Dispatch`, `IntegrationProblem`, `Adapter`, `CapabilityDescriptor`, `HttpClient` and the manifest, and adds nothing there. It arrives with its area note, as a new package must.

### 10.2 The interface

```ts
export interface TelephonyPort {
  /** Verifies a delivery's signature and maps it; a delivery that does not verify is `adapter-error` with category `auth`. */
  readInboundEvent(delivery: InboundDelivery): Promise<Dispatch<TelephonyEvent>>;
  answerCall(callRemoteId: string): Promise<Dispatch<void>>;
  collectDigits(callRemoteId: string, request: DigitCollection): Promise<Dispatch<void>>;
  playPrompt(callRemoteId: string, request: PromptPlayback): Promise<Dispatch<void>>;
  stopPrompt(callRemoteId: string): Promise<Dispatch<void>>;
  startMediaStream(
    callRemoteId: string,
    request: MediaStreamRequest,
  ): Promise<Dispatch<MediaStreamFormat>>;
  stopMediaStream(callRemoteId: string): Promise<Dispatch<void>>;
  hangUp(callRemoteId: string): Promise<Dispatch<void>>;
  /** The vendor's framing on the media socket: decode an inbound message, encode outbound audio. Pure. */
  mediaFraming(format: MediaStreamFormat): TelephonyMediaFraming;
}

export type TelephonyEvent =
  | {
      kind: "call-arrived";
      eventRemoteId: string;
      callRemoteId: string;
      dialledNumber: string;
      callerNumber: string | null;
      occurredAt: string;
    }
  | {
      kind: "digits-collected";
      eventRemoteId: string;
      callRemoteId: string;
      digits: string;
      outcome: "complete" | "timed-out";
    }
  | { kind: "prompt-finished"; eventRemoteId: string; callRemoteId: string }
  | { kind: "call-ended"; eventRemoteId: string; callRemoteId: string; occurredAt: string }
  | { kind: "not-handled" };

export interface MediaStreamFormat {
  readonly encoding: "linear16" | "mulaw";
  readonly sampleRate: 8000 | 16000;
  readonly byteOrder: "big-endian" | "not-applicable";
}

export type TelephonyMediaMessage =
  | { kind: "audio"; samples: Int16Array }
  | { kind: "digit"; digit: string }
  | { kind: "started"; callRemoteId: string }
  | { kind: "stopped" }
  | { kind: "not-handled" };
```

- **Named in our vocabulary.** No `call_control_id`, no `TwiML`, no `stream_bidirectional_codec`.
- **Prompts are identifiers from a closed vocabulary**, `TELEPHONY_PROMPTS` in `src/prompts.ts` (`enter-pin`, `pin-not-valid`, `dial-in-paused`, `waiting-for-host`, `admitted`, `denied`, `removed`, `meeting-ended`, `meeting-locked`, `meeting-full`, `already-joined`, `barred`, `not-available`, `not-joinable-by-phone`, `muted`, `unmuted`, `muted-by-host`, `unmute-requested`, `recording-started`, `recording-stopped`), each a platform-authored WAV under `apps/web/static/telephony-prompts/`. **No prompt text is ever sent to a carrier's speech synthesis**, so no sentence composed at run time can carry content, and the words are identical whichever carrier speaks them. WAV because it needs no encoder: MP3 would mean an encoder, and every mainstream MP3 encoder is C.
- **Before admission the carrier plays prompts** (`playPrompt` is a URL to that WAV); **after admission the bridge mixes them into the caller's audio itself**, from the same files fetched once into the object's memory, so a prompt during a call never competes with the media stream.
- **The capability descriptor declares the formats the adapter's media stream offers,** and the bridge adapts: Telnyx declares `linear16` at 16 kHz; a Twilio adapter would declare `mulaw` at 8 kHz, and the bridge would add a μ-law table and a ÷6 / ×6 resampler — both pure TypeScript.
- **There is deliberately no operation for carrier-side recording or transcription.** ADR-0047 keeps call audio off a carrier's transcription; an operation that is not on the port is one no caller can reach.
- **Every method returns `Dispatch`, never throws,** and an adapter maps vendor errors into `IntegrationProblem` without splicing the vendor's body, which can echo an authorization header — the EasyPost adapter's rule.

### 10.3 The Telnyx adapter

`packages/telephony/src/telnyx/`: `adapter.ts` (the port over `HttpClient`, bearer `TELNYX_API_KEY`), `map.ts` (webhook payloads to `TelephonyEvent`, validated with `canonicalRecordSchema` because a webhook body is untrusted), `signature.ts` (Ed25519 over the timestamp and the body, carried in the `telnyx-signature-ed25519` and `telnyx-timestamp` headers — the header names and the exact signed string are confirmed against Telnyx's documentation in the first slice, not taken from this page — verified with WebCrypto `Ed25519`, deliveries older than five minutes refused as replays), `framing.ts` (the media socket's JSON events, base64, L16 byte order). Answer, gather, playback, `streaming_start` with `stream_bidirectional_mode: "rtp"` and `stream_bidirectional_codec: "L16"`, and hang-up are Call Control commands.

**The manifest** declares `category: "telephony"`, `id: "telnyx"`, `defaultEnablement: "off"`, and `credential: { kind: "none" }` from the registry's point of view: the account is the platform's (the `ops@` Telnyx account `docs/operating-costs.md` already records for messaging), and its key is a deployment secret handed to the adapter at construction, the way `REALTIME_SFU_APP_SECRET` is handed to the routing-service client. The registry has no word for a platform-held credential, and inventing one for a single adapter is not worth it while owner question T1 is open; if the answer is a firm-connected account, the manifest becomes `{ kind: "apiKey", scope: "firm" }` on EasyPost's pattern and the connection store supplies the key.

Worker wiring: `apps/api-worker/src/plugins/telephony-plugin.ts` beside `shipping-plugin.ts`, and one line in `plugins/registry.ts`.

### 10.4 The lane a carrier arrives on

A webhook has no session, no cookie and no firm, so it cannot pass the chokepoint's first steps — the same position a guest is in. The guests design's answer is the model: **a narrow lane, declared on `RouteMeta`, refused at registration unless the route also declares `authenticated: false` and `permission: null`, run as step zero, and never setting `chokepointUserId`.** For a carrier the credential is the delivery's signature rather than a token, so the lane's step one is `TelephonyPort.readInboundEvent`, and a delivery that does not verify is a flat 401 with nothing read. The firm is then resolved from `telephony_number` by the dialled number, through a port method of its own (`resolveTelephonyFirmContext`), for the reason the guests design gives for `resolveGuestFirmContext`: two methods cannot be confused, and one method with a flag can.

Routes, all under `/api/v1/` so that neither the zone's route patterns nor `run_worker_first` changes (the guests design's reason for the same choice; the recording design's sink proposes `/internal/`, and whichever lands first sets the family for both):

| method | path                                        | lane                 | does                                                                            |
| ------ | ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `POST` | `/api/v1/telephony/telnyx/events`           | carrier              | Call Control webhooks: arrival, digits, prompt finished, hang-up                |
| `GET`  | `/api/v1/telephony/media/{mediaToken}`      | token                | the WebSocket the carrier's media stream dials                                  |
| `GET`  | `/api/v1/meetings/phone-audio/{audioToken}` | token                | the WebSockets the routing service's ingest and egress adapters dial            |
| `POST` | `/api/v1/meetings/{meetingId}/dial-in`      | app, `meetings:join` | mint the member's own PIN; answers `{ number, pin, notBefore, expiresAt }` once |
| `GET`  | `/api/v1/meetings/{meetingId}/dial-in`      | app, `meetings:join` | `{ available, number }` — never a PIN                                           |

`MeetingSummary` gains `dialIn: { available: boolean, number: string | null }`, additive.

## 11. Security

- **The webhook.** Ed25519 verified before anything is read, with a five-minute replay window; the public key is a deployment secret. A failed verification is a flat 401, counted, and never logged with its body.
- **The media sockets.** Three token kinds on the one signed-token format this worker uses (`apps/api-worker/src/signed-token.ts`), each with its own `typ` — `meeting-phone-carrier`, `meeting-phone-ingest`, `meeting-phone-egress` — so none passes another's check; each names the firm, the leg and, for egress, the input; each expires at `MAX_PHONE_LEG_HOURS = 8` after the leg began. The upgrade refuses **any** `Origin` header (the recording sink's mirror-image rule: neither a carrier nor the routing service is a browser, and a page must never reach these paths). One socket per token role: a second connection presenting a carrier token that is already connected is refused. The carrier's `start` event must name the call the token was minted for.
- **The routing service honours any session in the fleet,** so the bridge never takes a track pair from anywhere but its own room's roster: the room hands the bridge the publishers, and the bridge opens egress only on those. This is the room's `unknown-track` rule applied to a server-side subscriber.
- **The PIN.** Twelve CSPRNG digits, a keyed verifier at rest, a window measured in hours, the guard in section 8.2, and the door behind all of it.
- **The telephone number.** Kept as the last four digits and nothing more. The full number exists in memory while an arrival is handled — long enough to take its last four and its keyed guard hash — and is then dropped. It is never in a log, an audit row, a problem body, a telemetry field or a storage key.
- **What the carrier can hear.** The caller's leg crosses the carrier, as every telephone call does, and the caller hears the meeting's mixed audio through it. That is inherent to a telephone and is not a third party transcribing privileged audio: no carrier recording, transcription or speech synthesis is used, and the port has no operation that could turn one on.
- **Nothing privileged is spoken.** No prompt names the firm's client, the matter, the event title or anybody in the room.
- **No user-supplied outbound target.** Every URL the adapter sends to the carrier is ours, so `assertPublicTarget` has nothing to check here, and the reason is recorded so a reviewer does not look for it.
- **Secrets:** `TELNYX_API_KEY`, `TELNYX_WEBHOOK_PUBLIC_KEY`, `MEETING_DIAL_IN_PIN_KEY`, `DIAL_IN_GUARD_KEY`, all Worker secrets. Absent any of them, dial-in reports itself unavailable (`dialIn.available: false`) on the `meetings-not-configured` precedent rather than failing on a call.

## 12. Telemetry

A `meetings.phone.*` family in `packages/telemetry/src/events.ts`, one allowlist builder per act, correlated by firm, meeting, stay and leg handles. **The only field that carries any digit of a telephone number is `callerNumberLastFour`, and only on `callReceived`,** where it is what lets an operator match a carrier's support ticket to a call. No event has a field for a full number, a PIN, a collected digit string, a display name or a track name, so a call site cannot add one without adding it to the catalog first — the redaction is structural, as it is for `meetings.room.*`.

- `callReceived` — firm, telephony-number handle, `callerNumberLastFour` or null.
- `pinRefused` — firm, attempt number, outcome (`not-valid` | `exhausted` | `paused`). No digits.
- `guardPaused` — firm, failure count in the window.
- `arrived`, `admitted`, `left` — firm, meeting, stay, leg, reason.
- `bridgeOpened`, `mixChanged` — input count, adapters created and closed.
- `audioUnderrun` — **sampled** one frame in fifty, with the count covered, on the storage-budget reasoning: an event per underrun would make the record of a bad line cost more than the line.
- `bridgeClosed` — reason, bridged seconds.

## 13. Cost

Prices read 2026-09-24 (section 17), **to be verified before they are relied on**, and marked with how certain each is.

**Per caller-hour, Telnyx, four mix inputs:**

| Line                                                                                                    | Rate                                | Per caller-hour                               |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| Telnyx Voice API (Call Control)                                                                         | $0.002 / min                        | $0.120                                        |
| Telnyx inbound, local or toll-free (the page lists both at $0.0032, which is low for toll-free; verify) | $0.0032 / min                       | $0.192                                        |
| Telnyx media streaming                                                                                  | $0.0035 / min                       | $0.210                                        |
| Realtime adapter egress, four inputs × 691 MB                                                           | $0.05 / GB (free in beta)           | $0.138                                        |
| Bridge Durable Object, duration and requests                                                            | $12.50 / M GB-s; $0.15 / M requests | $0.013                                        |
| **Total**                                                                                               |                                     | **≈ $0.67 ($0.53 while the adapter is free)** |

Whether Telnyx bills the Voice API rate and the inbound rate together on one Call Control call is not stated on the page read; the table assumes both, which is the higher figure.

**Twilio, for comparison:** inbound local $0.0085/min plus Media Streams $0.004/min is **$0.75 per caller-hour** before our Cloudflare lines; toll-free inbound $0.0220/min makes it **$1.56**. Numbers $1.15/month local, $2.15 toll-free.

**Fixed:** one number per firm, $1.00/month on Telnyx (local or toll-free).

**Cloudflare's own gateway, when it exists,** would reduce the carrier leg to inbound SIP trunking ($0.0032/min on Telnyx's page, $0.19 per caller-hour) and remove the adapter egress and the bridge, leaving a Cloudflare SIP price nobody has published.

**Lines for [`docs/operating-costs.md`](../operating-costs.md)**, in the commit that lands the bridge (this design does not edit that file):

- Section A, Cloudflare usage rates: _Realtime WebSocket adapter — meeting dial-in mix inputs_ — $0.05 per GB egress, 691 MB per input per caller-hour, at most four inputs; inside the shared 1,000 GB tier; free during beta. And the bridge object folded into the Durable Objects row.
- Section D, beside the existing Telnyx SMS row: _Telnyx — voice (meeting dial-in)_ — usage plus number rental; Call Control $0.002/min, inbound $0.0032/min, media streaming $0.0035/min, number $1.00/month; about $0.52 per caller-hour on the carrier; committed once owner question T1 is answered.
- Section E, if the firm pays: dial-in minutes as a pass-through, or absorbed — a pricing decision, not an engineering one.

## 14. Memory safety — what is safe, and what would not be

**Everything this design adds to our deployment is TypeScript:** the port, the adapter, the signature check (WebCrypto), the framing, the Protocol Buffers reader the recording design already specifies, the resampler, the mixer, the level meter and the guard. Nothing parses privileged media in anything but a memory-safe language.

**The codecs are somebody else's.** The routing service converts between Opus and PCM on Cloudflare's side of the adapter; the carrier converts between the telephone network and L16 on its side. That is the same line the meetings design draws for the SFU itself: golden rule 14 governs our dependencies, and a vendor's service is not one.

**What cannot be built memory-safely without consent, and is therefore not assumed:**

1. **A container bridge.** If the WebSocket adapter is withdrawn — it is beta, and "its API may change" — or proves unfit (latency, the unpublished concurrent-adapter cap), the fallback is a container speaking SIP and RTP to the carrier and WebRTC to the routing service. `str0m` and `webrtc-rs/rtc` cover WebRTC in pure Rust. The gap is **Opus**: the routing service speaks Opus to a WebRTC peer, libopus is C, and the pure-Rust Opus implementations that exist (`opus-rs`, `rusty-opus`, `opus-decoder`, `oxideav-opus`) are young and self-described as production-ready without an established record. That choice — a young memory-safe codec, a consented C codec in a network-isolated container on the clamd precedent, or no dial-in — is the owner's, and it is owner question T3.
2. **A carrier offering only G.729 or AMR-NB.** Both codecs are C in every mature implementation. The adapter contract admits only `linear16` and `mulaw`, which need no codec at all, so a carrier that cannot offer one of them is not a candidate adapter.
3. **A headless-browser bridge** — refused outright (section 3.2).

## 15. Testing

- **The first slice is an experiment, and nothing else starts until it answers** (the recording design's posture for its own unconfirmed adapter behaviour): (a) the ingest adapter dials an endpoint with a token in its path and publishes the PCM we send as a track a browser can pull; (b) Telnyx's bidirectional L16 is 16 kHz, big-endian, and arrives every 20 milliseconds; (c) end-to-end latency caller-to-browser and browser-to-caller, measured, against an estimate of 150–300 milliseconds over an ordinary participant's that is arithmetic and not measurement; (d) the concurrent-adapter cap, asked of Cloudflare; (e) the Realtime SIP gateway's date, price and DTMF, asked of Cloudflare.
- **`packages/meetings/test`** over `node:sqlite`: a PIN mint writes a verifier and never the PIN; minting again for a member retires the previous one; a guest invitation's rotation rotates its PIN and revocation revokes it; a phone arrival opens a stay at the door with `channel = 'phone'` whatever the lobby setting; a member with an open stay is refused; a removed or denied stay bars the PIN; `MAX_MEETING_PARTICIPANTS` and `MAX_MEETING_LOBBY` count phone stays through the unchanged predicates; ending the meeting closes every leg at the one instant; a PIN outside `not_before`/`expires_at` refuses; the leg's remote id makes a redelivered arrival a no-op.
- **Pure units:** the resampler's frequency response against its table (a 7 kHz tone at 48 kHz is attenuated below the stated floor after decimation), round-trip gain, L16 byte order, μ-law against the ITU table (when a Twilio adapter lands), the level meter's hysteresis, the jitter buffer's underrun and overrun, mix selection over a 300-person roster (the subscription-policy test's shape).
- **`packages/telephony/test`:** Ed25519 verification against fixed vectors (valid, tampered body, stale timestamp, wrong key); every webhook payload maps or answers `not-handled`; a vendor error never reaches `detail`; the framing decodes `media`, `dtmf`, `start`, `stop`.
- **`apps/api-worker/test/telephony-lane.test.ts`:** an unsigned delivery is 401 with no firm read; an unknown dialled number hangs up; `chokepointUserId` is never set; a route declaring the lane with a permission throws at registration.
- **`apps/api-worker/test/meeting-phone-bridge.test.ts`** against a fake carrier socket and the fake routing service: admission opens one ingest and the right egress set; presence changes the set; muting stops caller audio and keeps the track; one outbound frame per inbound frame; a lost carrier socket ends the leg; the audio-token route refuses any `Origin`, a wrong `typ`, and a second carrier connection.
- **`apps/api-worker/test/meeting-room.test.ts`, extended:** a phone waiter reaches the hosts' `waiting` with `channel` and `callerNumberLastFour`; no roster frame carries the last four; the grace sweep skips a phone record and the bridge heartbeat sweeps it instead.
- **`apps/api-worker/test/dial-in-guard.test.ts`:** three attempts per call, ten per calling number, the firm-wide pause at 120, and keys that hold no number.
- **Fitness:** a source scan, registered `@repo-wide-fitness`, that no telephone-number-shaped value, PIN or `digits` field reaches a logger, an audit builder or a telemetry builder under `apps/api-worker/src/telephony`, `apps/api-worker/src/meetings` and `packages/telephony`.
- **Load profile:** a one-hour bridge with four inputs, measuring CPU per call-hour and underruns, so the section 4.1 claim that TypeScript suffices becomes a number.

## 16. Owner questions

- **T1 — Whose carrier account?** A platform-managed Telnyx account (the `ops@` account already signed up), one number per firm bought by us and the minutes absorbed or passed through; or each firm connecting its own account on EasyPost's pattern. **Recommended: platform-managed** — a firm should not need a carrier contract to let a client dial into a meeting, and the webhook lane is simpler with one signing key.
- **T2 — Build the bridge now, or wait for Cloudflare's gateway?** The bridge is buildable today with no consent and about $0.15 of Cloudflare cost per caller-hour; Cloudflare's gateway removes it but is unpriced, undated and silent on DTMF. **Recommended:** build the door (the port, the PIN, the record, the lobby) now, because it survives either way; ask Cloudflare the three questions in section 15 (e); build the bridge if the answer is months rather than weeks.
- **T3 — If the WebSocket adapter goes away, what then?** A container bridge needs an Opus codec: a young pure-Rust one, libopus under golden-rule-14 consent in a network-isolated container, or no dial-in until Cloudflare's gateway ships. **Not needed today; asked so that the answer exists before an adapter change forces it.**
- **T4 — Should a member's PIN admit them directly when the lobby is off?** This design has every caller wait, because a PIN is not a session; the cost is that an all-phone meeting cannot start without a host in a browser. Zoom lets a member's personal code in directly.
- **T5 — Local or toll-free numbers, and one per firm or one per office?** Same price on Telnyx's page read; toll-free is what a client expects from a law firm; offices in several area codes may want one each.

## 17. Sources read on 2026-09-24

- Cloudflare Realtime WebSocket adapter — <https://developers.cloudflare.com/realtime/sfu/media-transport-adapters/websocket-adapter/>: ingest and egress both dialled by the routing service; `inputCodec` `pcm` only; `outputCodec` `pcm` or `jpeg`; 48 kHz stereo little-endian; under 32 KB a message; tokens in the path or query authenticate; ingest not charged; beta.
- Cloudflare documentation draft, "[Realtime] Add SIP phone call bridging how-to", <https://github.com/cloudflare/cloudflare-docs/pull/33251> (draft, unmerged; file `src/content/docs/realtime/sfu/bridge-phone-call-sip.mdx`): the gateway address, the webhook, accept / mix / terminate, G.711, inbound only, "in development and is not yet generally available".
- Telnyx pricing — <https://telnyx.com/pricing/call-control>: Voice API $0.002/min; SIP trunking inbound local and toll-free $0.0032/min; numbers $1.00/month; media streaming $0.0035/min; call transfer $0.10.
- Telnyx media streaming — <https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming>: `stream_url`, the event set including `dtmf`, bidirectional `rtp` mode, codecs including L16. The L16 sample rate of 16 kHz is from Telnyx's release note as summarised by a search (<https://telnyx.com/release-notes/media-streaming-codec-update>) and is confirmed by the first experiment, not assumed.
- Twilio pricing — <https://www.twilio.com/en-us/voice/pricing/us>: inbound local $0.0085/min, toll-free $0.0220/min, numbers $1.15 and $2.15. Media Streams at $0.004/min and μ-law 8 kHz in both directions are from Twilio's documentation as summarised by a search (<https://www.twilio.com/docs/voice/media-streams>, <https://www.twilio.com/docs/voice/media-streams/websocket-messages>).
- Pure-Rust Opus crates (search, 2026-09-24): `opus-rs`, `rusty-opus`, `opus-decoder`, `oxideav-opus` — existence only; maturity not assessed.
- Durable Objects and Realtime rates: [`docs/operating-costs.md`](../operating-costs.md) as it stands, and the recording research note.

## 18. Slices and the file-touch list

Three slices after the experiment. D1 lands dark (the setting defaults off and no firm has a number); D2 makes it usable; the ledger node moves to `shipped` after D2.

### D1 — the port and the door

- `packages/telephony/` (**new package**): `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.test.json`, `vitest.config.ts`, `CLAUDE.md`, `src/port.ts`, `src/canonical.ts`, `src/prompts.ts`, `src/manifest.ts`, `src/telnyx/adapter.ts`, `src/telnyx/map.ts`, `src/telnyx/signature.ts`; `test/*`.
- `packages/identifiers/src/registry.ts`, `src/types.ts` — `meetingDialInPin`, `meetingPhoneLeg`, `telephonyNumber`.
- `packages/database/src/per-firm-schema.ts` + one additive migration + snapshot; `apps/api-worker/src/per-firm-migrations.ts`; `pnpm run migration-bundles`.
- `packages/database/src/control-plane-schema.ts` + one control-plane migration; `apps/api-worker/src/control-plane-migrations.ts`.
- `packages/data-access/src/pii-registry.ts`.
- `packages/meetings/src/dial-in-types.ts`, `dial-in-statements.ts`, `dial-in-service.ts` (**new**, the trio per concern); `guest-service.ts` (the PIN minted, rotated and revoked with the invitation); `settings.ts` (`meetings.dialInEnabled`; new unless the recording slice has created it).
- `packages/meeting-protocol/src/types.ts` — `channel` on `RosterParticipant` and `WaitingParticipant`, `callerNumberLastFour` on `WaitingParticipant`.
- `apps/api-worker/src/telephony/telephony-events.ts`, `dial-in-arrival.ts`, `dial-in-guard.ts` (**new**; the guard is a Durable Object).
- `apps/api-worker/src/routes/telephony-events.ts`, `routes/meeting-dial-in.ts` (**new**).
- `apps/api-worker/src/chokepoint/chokepoint.ts`, `ports.ts`, `contracts/route-meta.ts` — the carrier lane and `resolveTelephonyFirmContext`. **Shared surface; one commit of its own, ahead of the rest.**
- `apps/api-worker/src/meetings/room/room-phone.ts` (**new**), `room-lobby.ts`, `room-lifecycle.ts` (the sweep skips phone records; the heartbeat deadline), `room-state.ts`, `meeting-room.ts` (the four RPCs).
- `apps/api-worker/src/meetings/guest-invitation-mail.ts` — the number and PIN lines.
- `apps/api-worker/src/plugins/telephony-plugin.ts` (**new**), `plugins/registry.ts`.
- `apps/api-worker/src/app.ts`, `apps/api-worker/wrangler.jsonc` — `DIAL_IN_GUARD`, the four secrets.
- `packages/telemetry/src/events.ts` — `meetings.phone.*`.
- `apps/api-worker/openapi/openapi.json` + `packages/api-client` — regenerated.
- `apps/web/static/telephony-prompts/*.wav` (**new**).
- `apps/web/src/lib/meetings/meeting-lobby-panel.svelte` (the phone mark and last four), `meeting-dial-in-panel.svelte` (**new**; the member's number and PIN, shown once), `meeting-entry-action.svelte`, `meeting-attendance-panel.svelte`, `meetings-api.ts`.

### D2 — the bridge

- `apps/api-worker/src/meetings/meeting-phone-bridge.ts` (**new**, non-hibernating Durable Object) over `apps/api-worker/src/meetings/phone/phone-audio-bridge.ts` (the seam of section 3.3), `phone/mix-selection.ts`, `phone/jitter-buffer.ts` (**new**).
- `apps/api-worker/src/meetings/sfu/sfu-client.ts` — adapter create and close (**shared with the recording slice R1**).
- `packages/meetings/src/pcm-frame.ts` (**shared with recording R1**), `pcm-mix.ts` (**shared with recording R2**), `pcm-resample.ts`, `pcm-level.ts` (**new**).
- `packages/telephony/src/telnyx/framing.ts` (**new**).
- `apps/api-worker/src/routes/meeting-phone-audio.ts` (**new**; the carrier and adapter socket routes).
- `apps/api-worker/src/meetings/room/room-phone.ts` — presence to the bridge; `room-roster.ts` — `channel` on entries.
- `apps/api-worker/wrangler.jsonc` — `MEETING_PHONE_BRIDGE`.
- `apps/web/src/lib/meetings/screen/meeting-tile.svelte`, `screen/meeting-roster.svelte` — the Lucide `phone` glyph.

### D3 — in-call control and the announcement

- `apps/api-worker/src/meetings/room/room-hosting.ts` — mute, unmute request, remove and spotlight reaching a phone stay.
- `apps/api-worker/src/meetings/meeting-phone-bridge.ts` — DTMF `*6`, prompt injection, the recording and caption announcements.
- The recording design's notice and track tables, if it has not already taken the fix in section 9.3.

**Tests** per section 15, each in the slice that builds what it tests. **Docs, in the same commit as the work:** `roadmap.d/meetings.md` (`meetings.dial-in` to `in-build`, then `shipped`) and `pnpm exec vp run register-build`, `status.d/` and `vp run status-build`, `changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md` (the bridge path; the PIN and the door; the port as its own package; the platform-held credential), `docs/user/features/meetings.md` (how to dial in, and what a caller hears), `docs/operating-costs.md` (section 13's lines), `docs/conventions/operations.md` (attaching a number to a firm).

## 19. What this does not settle

- **Dial-out** ("call me"): the routing service's side is the same bridge, but the carrier leg is an outbound call, which is where the white paper's E911 seam stops being sidestepped. Cloudflare's draft gateway is inbound only.
- **Pairing a phone audio leg with a browser stay** — a member watching the screen share on a laptop while listening on a phone. The open-stay index forbids two stays; a stay with two legs is its own design.
- **Localized prompts and international numbers.** One language, one country's numbering, in the first build.
- **A spoken name at the door,** which some products record so the host hears who is calling. It is audio of a person captured before anybody admitted them, and it is not built.
- **Chat, hands and reactions for a caller** by keypad.
- **Noise suppression on a caller's audio.** `nnnoiseless` is pure Rust and could run in the bridge; not needed to ship.
- **Moving an event after a PIN is minted** does not move the PIN's window; rotating does. The guest link has the same property, and both are fixed together or neither.
- **The receptionist intake line** on the same port and the same `telephony_number` table (`purpose: 'reception'`), and whether a dial-in leg also writes a row into the call and text log. This design writes none: the meeting's attendance is the record of a call into a meeting, and a second row in `communication` would be a second answer to the same question.
- **Room systems** (SIP and H.323 endpoints in conference rooms), which are not the public telephone network.
- **How number provisioning is automated.** Attaching a number to a firm is an operator act recorded in `docs/conventions/operations.md` when the door lands.
- **Who owns the shared files at build time** — `apps/api-worker/src/meetings/sfu/sfu-client.ts`, `packages/meetings/src/pcm-frame.ts` and `pcm-mix.ts` with the recording slices; `apps/api-worker/src/chokepoint/*` and `contracts/route-meta.ts` with anything else adding a lane; `packages/meeting-protocol/src/types.ts` and `room/room-lobby.ts` with the waiting room's web half. Section 18 names them; the owner of each is decided when the slices are scheduled, on the rule that a file has exactly one.
