# Meetings — recording, live captions, transcript and summary, design

**Status:** Design (brainstormed), 2026-09-20. Extends
[`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md), which owns the meeting record, the
`MeetingRoom` Durable Object, the SFU client, the routes and the screen. Nothing below rebuilds any
of that.

**Ledger:** [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md) — `meetings.recording`,
`meetings.transcription`, `meetings.summary`.
**Research:**
[`docs/research/2026-09-20-meeting-recording-paths.md`](../research/2026-09-20-meeting-recording-paths.md)
— every Cloudflare fact this design rests on, with its URL and the date it was read. Facts are cited
here by name; the note is the home.
**White paper:** _Communications layer_, _Matters and File Manager_, _AI / inference_.
**Owner ruling (2026-09-20):** the consent mechanism is the announcement and the indicator —
"Recording in progress" to everyone at start and to every late arrival, audibly and on screen, with a
recording mark for as long as it runs. Recording no longer waits on the jurisdiction-profile
machinery.

---

## 1. What this is, and the one sentence that decides it

A member with the right to do so presses **Record**. Everyone in the room is told, out loud and on
screen, at that instant and again whenever anyone arrives. The meeting's audio leaves the routing
service into a Durable Object we run, is composed into one audio file, and is filed into the matter
through the same untrusted-file pipeline every uploaded document goes through. Afterwards a
transcript is produced with speaker attribution and filed beside it, and a summary with action items
is written from the transcript and attached to the event. While the meeting is running, the same
audio produces live captions.

The sentence that decides the architecture is this one, from the research note:

> The Realtime SFU exposes exactly one media transport adapter — a WebSocket adapter that converts an
> Opus track to 16-bit little-endian PCM at 48 kHz and dials a `wss://` endpoint we name. Video
> egress is approximately 1 FPS JPEG stills. There is no recording product, and Stream Live does not
> record a WHIP-ingested input.

So **audio can be recorded end to end on Cloudflare with no C/C++ anywhere in our deployment, and
video cannot be recorded at all without either adopting a different Cloudflare product or taking a
C/C++ codec dependency.** This design builds the first and asks the owner about the second (§13).

### The shape, in one path

```
browser mic ──Opus──> Realtime SFU ──WebSocket adapter, PCM──> MeetingRecorder (Durable Object)
                                                                 │
                                    ┌────────────────────────────┼───────────────────────────┐
                                    ▼                            ▼                           ▼
                          R2 staging (per track)        caption fork (speaking only)   recording/notice
                                    │                    @cf/deepgram/nova-3 ws        rows via the
                                    ▼                            │                     firm-scoped
                       compose consumer (queue)                  ▼                     data-access
                       mix → one mono WAV                 `caption` frames             layer
                                    │                      to MeetingRoom
                                    ▼
                       initiateUpload → R2 → completeUploadSession → files-ingest
                                    │
                                    ▼
                       transcript consumer  @cf/openai/whisper-large-v3-turbo
                                    │
                                    ▼
                       summary consumer  InferencePort  →  meeting_summary + action items
```

Every box is Cloudflare-managed or TypeScript. No container, no FFmpeg, no codec library.

### What is deliberately not here

- **Video recording.** §13 prices the three ways to get it and asks the owner to pick one.
- **Translated captions.** Nova-3 takes a language; translation is a second pass and a second slice.
- **Recording a firm-event meeting.** `initiateUpload` requires a `matterId`
  (`packages/file-manager/src/file-service.ts`), and a firm event has no matter, so there is nowhere
  under the golden-rule-3 model to put the bytes. A firm meeting's Record control is absent and says
  why. When a firm-level document home exists this is a data change, not a redesign.
- **End-to-end encryption.** `meetings.end-to-end-encryption` already records that the two cannot
  coexist; a recorded meeting is a meeting the routing service can read, and that is the trade.

---

## 2. Why this path and not the others

| Path                                                                      | Verdict                  | Why                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SFU publishes to **Stream Live over WHIP**, Stream records                | **Impossible**           | Stream states "Recording and live HLS playback are not yet supported" for WHIP inputs, and the pricing page confirms it from the billing side. The SFU also documents no WHIP egress. |
| **RTMPS/SRT into Stream Live**, which does record automatically           | **Unreachable**          | Nothing in the stack speaks RTMPS or SRT and the SFU cannot produce either. Getting there needs our own encoder and muxer — a C codec.                                                |
| **RealtimeKit** managed recording                                         | **Owner call**           | Real, and the only managed composite-video recorder on Cloudflare. It is a different application layer: its own meetings, participants, tokens and UI SDKs replace ours. §13.         |
| **SFU WebSocket adapter → our Durable Object** (this design)              | **Chosen**               | Documented, Cloudflare-managed, audio-complete, pure TypeScript on our side. Its costs and its beta status are known and priced (§11).                                                |
| **A container running a Rust WebRTC recorder** (`str0m`, `webrtc-rs/rtc`) | **Not needed for audio** | The adapter already delivers decoded PCM, so the container would add operational surface for nothing. For video it does not help either: there is no pure-Rust VP8/H.264 decoder.     |

The deciding facts, in order of weight: the adapter exists and is documented; Whisper and Deepgram
Nova-3 are **hosted on Cloudflare's own infrastructure**, so a privileged conversation reaching a
speech model never leaves Cloudflare; and the adapter's PCM output is `linear16`, which is exactly
the encoding Nova-3 accepts, so nothing has to transcode anything.

---

## 3. Consent — the announcement, the mark, and the record of both

The owner ruled that the announcement and the indicator **are** the consent mechanism. They are
therefore built as a mechanism with a record, not as decoration on a screen.

### The room frame

One new room→client frame, `v: 1`, additive:

```
recording { state: "started" | "stopped", recordingId, by: { userId, displayName }, at }
```

- Broadcast to **every** socket in the room the instant the start (or stop) is committed.
- `welcome` gains `recording: { state: "started", recordingId, by, at } | null` — a late arrival is
  told by the same vocabulary the room used at the start, so there is one code path and one
  wording. This is the "and on arrival" half of the ruling, and it is server-sent, so a client that
  never renders it still had it delivered.
- `roster-delta` and `presence` are untouched.

Start and stop go through the **REST routes** (§7), never a client frame: the permission check, the
audit row and the `meeting_recording` insert belong at the chokepoint, and the room is then told by
the route. A client frame would put an authorization decision inside the socket protocol.

### The announcement in the browser

Three things happen together when `recording.state === "started"` arrives (from a broadcast or from
`welcome`):

1. **A tone, synthesized, not shipped.** Two short notes from the **Web Audio API** on the
   `AudioContext` the meeting screen already owns for speaking detection
   (`apps/web/src/lib/meetings/audio-level-meter.ts`). Synthesizing it beats bundling a sound file:
   no asset, no codec, no decode, nothing to get lost in a build, and it is byte-identical on every
   browser. Autoplay policy is satisfied because the member pressed Join, which is the gesture that
   unlocked that context.
2. **Spoken words, best effort.** `speechSynthesis.speak("Recording in progress")` through the Web
   Speech API where the browser offers it. It is best effort by construction — voice availability
   varies and some browsers have none — so it is never the record and never the only channel. The
   tone is the floor.
3. **On screen, unmissable.** A banner across the meeting header that the member dismisses, plus an
   `aria-live="assertive"` announcement of the same sentence so a screen-reader user is told rather
   than shown.

**The persistent mark** replaces the banner once dismissed and stays for as long as `state` is
`started`: a filled dot and the word **Recording** in the meeting header, mirrored on the Meetings
page row and on the calendar event's entry surface. It is driven off the room frame, not off a
poll, so it appears within the same frame as the announcement and disappears on `stopped`.

Stopping is announced the same way: one tone, "Recording stopped", and the mark clears.

### The record of the announcement

The consent evidence is **what the server announced to whom**, not what a browser rendered. One row
per notice:

```
meeting_recording_notice(recording_id, attendance_id, user_id, delivered_at, reason)
reason ∈ 'start' | 'arrival' | 'stop'
```

Written by the room when it fans the frame out (batched through the firm-scoped data-access layer,
one batch per fan-out, never one write per socket). Identifiers and instants only — this table says
that a person in the room at a given instant was told, and says nothing about what anybody said.

A member who joins while a recording is running gets an `arrival` row from their own `welcome`. A
member whose socket was lost and is re-established gets another `arrival` row; duplicates are
correct here, because each one is a separate occasion on which they were told.

---

## 4. Who may record

**A new permission key, `meetings:record`**, beside `meetings:join` and `meetings:host` in
`packages/access-control/src/registry.ts`, binding `resource: "firm"` for the same reason the other
two do (a firm event has no matter).

The argument for a third key rather than folding it into `meetings:host`:

- **Hosting and recording are different acts with different consequences.** Hosting is about running
  the room — start it, end it, and in the coming slice mute and remove. Every one of those acts ends
  when the meeting ends. Recording creates a durable, discoverable, privileged artifact that outlives
  the room, enters the matter file, and is subject to disclosure. A firm that is happy for any
  attorney to convene a call is not thereby happy for any attorney to create a recording of a client
  conversation.
- **It is separable now and not separable later.** Adding a key costs one registry entry and one
  seed; taking a capability back out of `meetings:host` after firms have granted it is a migration
  and a conversation with every firm.
- **Day one changes nothing.** `meetings:record` is seeded to exactly the roles that already hold
  `meetings:host`, so no firm's behaviour changes on the merge; the firms that want to narrow it can.

Stop is `meetings:record` as well — the same key that starts it. A **host** may also stop a running
recording without holding `meetings:record`, because ending the room already stops it and a host who
can end the meeting can obviously end the recording; that is recorded as `stop_reason: 'host'` with
the stopping member's id.

Reading a recording, a transcript or a summary is **`meetings:join` on a meeting the member may
see** — the same predicate the attendance read uses, which resolves through the event's visibility
(`visibleMatterPredicate`). The filed document is additionally subject to the File Manager's own
matter-level access, so a member who loses matter access loses the recording with it. That is the
point of filing it as a document rather than inventing a second delivery path.

---

## 5. Schema (per-firm lineage, additive)

Five new tables in `packages/database/src/per-firm-schema.ts`, one hand-written migration, snapshot
refreshed in the same commit, worker bundle regenerated by `pnpm run migration-bundles`.

```
meeting_recording
  id                     text pk           -- meetingRecording_ handle
  meeting_id             text not null  -> meeting.id
  matter_id              text not null  -> matter.id        -- denormalized from the event; a firm meeting cannot record
  state                  text not null     -- 'recording' | 'composing' | 'filed' | 'failed' | 'abandoned'  (CHECK)
  started_by_user_id     text not null  -> member.user_id
  started_at             text not null     -- instant
  stopped_by_user_id     text null      -> member.user_id
  stopped_at             text null         -- instant
  stop_reason            text null         -- 'member' | 'host' | 'meeting-ended' | 'sink-lost' | 'ceiling' | 'abandoned'  (CHECK)
  track_count            integer not null default 0
  captured_seconds       integer null      -- what the composite actually contains
  file_id                text null      -> file.id          -- the filed audio document
  file_version_id        text null      -> file_version.id
  failure_error_id       text null         -- the standard pipeline's Error ID, never a message
  created_at, updated_at text not null
  INDEX (meeting_id, started_at); INDEX (state)

meeting_recording_track
  id                     text pk           -- meetingRecordingTrack_ handle
  recording_id           text not null  -> meeting_recording.id
  attendance_id          text not null  -> meeting_attendance.id
  user_id                text not null  -> member.user_id
  track_name             text not null     -- the SFU track name; the attribution key
  adapter_id             text null         -- the SFU adapter handle, for close
  staging_key            text null         -- R2 key of this track's PCM, null once swept
  first_frame_at         text null
  last_frame_at          text null
  frames_received        integer not null default 0
  frames_dropped         integer not null default 0
  state                  text not null     -- 'open' | 'closed' | 'lost'  (CHECK)
  created_at, updated_at
  UNIQUE (recording_id, track_name); INDEX (recording_id, state)

meeting_recording_notice
  id                     text pk           -- meetingRecordingNotice_ handle
  recording_id           text not null  -> meeting_recording.id
  attendance_id          text not null  -> meeting_attendance.id
  user_id                text not null  -> member.user_id
  reason                 text not null     -- 'start' | 'arrival' | 'stop'  (CHECK)
  delivered_at           text not null     -- instant the room fanned the frame out
  created_at
  INDEX (recording_id, delivered_at)

meeting_transcript
  id                     text pk           -- meetingTranscript_ handle
  meeting_id             text not null  -> meeting.id
  recording_id           text null      -> meeting_recording.id
  state                  text not null     -- 'pending' | 'ready' | 'failed'  (CHECK)
  language               text null         -- BCP-47, as reported by the model
  model_id               text not null     -- '@cf/openai/whisper-large-v3-turbo'
  segment_count          integer null
  word_count             integer null
  file_id                text null      -> file.id          -- the filed .vtt document
  failure_error_id       text null
  created_at, updated_at
  UNIQUE (recording_id)   WHERE not null
  INDEX (meeting_id)

meeting_transcript_segment
  id                     text pk           -- meetingTranscriptSegment_ handle
  transcript_id          text not null  -> meeting_transcript.id
  ordinal                integer not null  -- 0-based, chronological
  kind                   text not null     -- 'speech' | 'gap'  (CHECK)
  user_id                text null      -> member.user_id    -- attribution; null on a gap
  attendance_id          text null      -> meeting_attendance.id
  started_ms             integer not null  -- offset from meeting_recording.started_at
  ended_ms               integer not null
  text                   text not null     -- '' on a gap
  created_at
  UNIQUE (transcript_id, ordinal); INDEX (transcript_id, started_ms)

meeting_summary
  id                     text pk           -- meetingSummary_ handle
  meeting_id             text not null  -> meeting.id
  transcript_id          text not null  -> meeting_transcript.id
  state                  text not null     -- 'pending' | 'ready' | 'failed' | 'refused'  (CHECK)
  model_id               text not null
  snapshot_id            text null         -- the pinned snapshot the run used
  summary_text           text null
  input_tokens           integer null
  output_tokens          integer null
  refusal_reason         text null         -- 'not-eligible' | 'disabled' | 'transcript-empty'  (CHECK)
  failure_error_id       text null
  created_at, updated_at
  UNIQUE (transcript_id)

meeting_summary_action_item
  id                     text pk           -- meetingSummaryActionItem_ handle
  summary_id             text not null  -> meeting_summary.id
  ordinal                integer not null
  text                   text not null
  owner_user_id          text null      -> member.user_id    -- resolved only on an exact display-name match
  due_on                 text null         -- civil date, only when the transcript stated one
  task_id                text null      -> task.id           -- set when a member turns it into a task
  created_at, updated_at
  UNIQUE (summary_id, ordinal)
```

**Identifiers** (`packages/identifiers`, types + registry): `meetingRecording`,
`meetingRecordingTrack`, `meetingRecordingNotice`, `meetingTranscript`, `meetingTranscriptSegment`,
`meetingSummary`, `meetingSummaryActionItem`.

**PII registry** (`packages/data-access/src/pii-registry.ts`). The meeting subsystem has held exactly
one content table until now (`meeting_message`, in-meeting chat). This design adds three more, and
they are the most sensitive content the platform stores:

- `meeting_recording.started_by_user_id` / `stopped_by_user_id`, `meeting_recording_track.user_id`,
  `meeting_recording_notice.user_id` — `retain-under-matter`, identifiers only, the same basis as
  attendance: who recorded, who was recorded, and who was told is part of what the record says
  happened.
- `meeting_transcript_segment.text` and `user_id` — **content**, `retain-under-matter`, the same
  treatment as a filed email body: never logged, never in an audit row, never in an error payload,
  redact-by-default everywhere.
- `meeting_summary.summary_text` and `meeting_summary_action_item.text` — **derived content**,
  `retain-under-matter`, and additionally **work product**: a summary is the platform's
  characterization of a privileged conversation, so it takes the work-product retention class the
  assistant's turns already carry.

**Audit** (`domainAuditStatement`): `meetings.recording.started`, `.stopped`, `.filed`, `.failed`,
`.abandoned`, `meetings.transcript.ready`, `.failed`, `meetings.summary.ready`, `.refused`,
`.failed`, and `meetings.recording.noticed` (one row per fan-out, with the count, not per person).
Identifiers, counts and instants only. **No audit row ever carries a transcript segment, a summary
sentence, or a filename derived from either.**

**Settings** (`packages/meetings/src/settings.ts`, `FirmSettingDefinition` on the
`matters/src/settings.ts` precedent), all defaulting off so a firm opts in deliberately:

- `meetings.recordingEnabled` — boolean, default **false**.
- `meetings.captionsEnabled` — boolean, default **false**.
- `meetings.summariesEnabled` — boolean, default **false**.
- `meetings.recordedTrackCeiling` — integer, default **32** (§8).

---

## 6. The sink — `MeetingRecorder`

`apps/api-worker/src/meetings/meeting-recorder.ts`, a Durable Object keyed `${firmId}:${recordingId}`,
one per recording rather than one per meeting, so a stop-and-start-again is a fresh object with a
fresh lifecycle and no state to reset.

It is **not** hibernating. A hibernating socket is the right shape for a signaling room that is idle
between frames; a recorder receives 50 frames a second per track and has an open R2 multipart upload
per track. `MeetingRoom` stays exactly as it is.

### What it holds

`ctx.storage`, all of it transient and deleted when the recording settles:

- `track:<trackName> → { attendanceId, userId, adapterId, uploadId, stagingKey, partNumber,
partsEtags[], carry, framesReceived, framesDropped, firstFrameAt, lastFrameAt, socketLostAt }`
- `recording → { meetingId, matterId, medium, startedAt, state, captionsOn }`

### Starting

1. The start route (§7) inserts `meeting_recording` in state `recording` and every
   `meeting_recording_track` in state `open`, in one effect batch with the audit row, then calls the
   recorder.
2. For each audio track on the room's roster, the recorder calls
   `POST /v1/apps/{appId}/adapters/websocket/new` with `location: "remote"`, the participant's
   `sessionId` and `trackName`, `outputCodec: "pcm"`, and an `endpoint` of
   `wss://<api-origin>/internal/meeting-audio/<sinkToken>` (§6.1). It records the returned
   `adapterId`.
3. It opens an R2 multipart upload per track at
   `meeting-recordings/<meetingId>/<recordingId>/<trackName>.pcm` in the firm's own bucket.
4. It asks the room to broadcast `recording { state: "started", … }` and to write the `start`
   notices.

A participant who **joins after** the recording starts has an adapter created for their audio track
the moment the room reports the publish, and gets an `arrival` notice from their `welcome`. A
participant who leaves has their adapter closed and their track moved to `closed`.

### 6.1 Authenticating the socket the SFU dials

This is the one place the design has to invent something, because the adapter documentation says only
"Secure WebSocket endpoints with authentication" and specifies no header or token mechanism
(recorded as unconfirmed in the research note).

- `GET /internal/meeting-audio/{sinkToken}` on the api-worker, a WebSocket upgrade route **outside**
  the session chokepoint — the SFU has no cookie and is not a member.
- `sinkToken` is a compact token minted by the recorder: `HMAC-SHA-256` over
  `firmId | recordingId | trackName | expiresAt` with a Worker secret (`MEETING_SINK_SIGNING_KEY`),
  base64url, with the payload carried alongside so the route can verify without a lookup. It is
  **single-use-per-adapter and short-lived** (the recording's own maximum duration plus a margin),
  and the route additionally checks the named recording is still in state `recording` and the named
  track is still `open`. A token for a settled recording opens nothing.
- **The same-origin check `MeetingRoom` applies does not apply here.** The upgrade in
  `/api/v1/meetings/{meetingId}/socket` refuses a foreign `Origin` because a browser will send one;
  the SFU is not a browser and sends none. The route refuses an upgrade that carries **any** `Origin`
  header at all, which is the mirror-image rule and keeps a page from ever reaching this path.
- **Before any of this is trusted, prove the SFU preserves the path and any query parameters on
  `endpoint`.** It is an unconfirmed behaviour. If it does not, the fallback is a token in the
  `Sec-WebSocket-Protocol` subprotocol, and if that is unavailable the design escalates to asking
  Cloudflare. This is the first task of the first slice, and the rest of the slice does not start
  until it answers.

### 6.2 Frames in, bytes out

Each message is a Protocol Buffers envelope with `sequenceNumber`, `timestamp` and `payload`; the
payload is 16-bit little-endian PCM, 48 kHz, stereo, at most 32 KB. The recorder:

1. Decodes the envelope. The protobuf decode is a **hand-written reader** in
   `packages/meetings/src/pcm-frame.ts` — three fields, two varints and a length-delimited bytes
   field, which is twenty lines of TypeScript and no dependency at all. Golden rule 1 is not a reason
   to add a protobuf runtime for three fields.
2. **Downmixes to mono** by averaging the two channels into an `Int16Array` with saturation. This is
   addition, not signal processing, and it halves everything downstream. (Whether the adapter emits
   true stereo or an upmixed mono track is unconfirmed; averaging is correct either way.)
3. Appends to a `carry` buffer and, whenever the carry passes **8 MiB**, uploads it as the next R2
   multipart part. 8 MiB of mono 48 kHz is ~87 seconds, so a one-hour track is ~41 parts.
4. Records `sequenceNumber` gaps as `frames_dropped` and writes **silence of the gap's length** into
   the stream, so the staged track stays on a real timeline and the composite never drifts.
5. If captions are on and the track's participant is currently `speaking` (the presence fact the room
   already relays), forwards the same mono frames to the caption path (§10).

The recorder writes **no content to its own storage** and keeps nothing in memory but the carry
buffer — at most 8 MiB per track. That bound is why the track ceiling exists (§8).

### Stopping

On stop (member, host, meeting end, or every track lost):

1. Close every adapter: `POST /v1/apps/{appId}/adapters/websocket/close` with each `adapterId`.
2. Flush each carry as a final part and complete each multipart upload.
3. Move the recording to `composing`, write `stopped_at`, `stopped_by_user_id`, `stop_reason` and
   `track_count`, and enqueue `meeting-recording-compose`.
4. Ask the room to broadcast `recording { state: "stopped" }` and write the `stop` notices.
5. Set an alarm to delete its own storage.

---

## 7. Routes

All under the existing OpenAPI chokepoint in `apps/api-worker/src/routes/meetings.ts` except the sink,
which is deliberately outside it (§6.1).

| method | path                                                            | permission        | does                                                                                                   |
| ------ | --------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| POST   | `/api/v1/meetings/{meetingId}/recording`                        | `meetings:record` | starts a recording; returns `MeetingRecordingSummary`                                                  |
| DELETE | `/api/v1/meetings/{meetingId}/recording`                        | `meetings:record` | stops the running recording (a host may also stop; §4)                                                 |
| GET    | `/api/v1/meetings/{meetingId}/recordings`                       | `meetings:join`   | cursor-paged list of this meeting's recordings                                                         |
| GET    | `/api/v1/meetings/{meetingId}/recordings/{recordingId}/notices` | `meetings:host`   | who was told, and when — the consent record                                                            |
| GET    | `/api/v1/meetings/{meetingId}/transcript`                       | `meetings:join`   | the transcript header plus cursor-paged segments                                                       |
| GET    | `/api/v1/meetings/{meetingId}/summary`                          | `meetings:join`   | the summary and its action items, or 404                                                               |
| POST   | `/api/v1/meetings/{meetingId}/summary`                          | `meetings:host`   | re-runs the summary over the existing transcript (idempotent while one is `pending`)                   |
| GET    | `/internal/meeting-audio/{sinkToken}`                           | token (§6.1)      | WebSocket upgrade the SFU dials; 426 on a non-upgrade, 403 on any `Origin`, 404 on a settled recording |

`MeetingRecordingSummary`: `{ id, meetingId, state, startedBy: { userId, displayName }, startedAt,
stoppedBy | null, stoppedAt | null, stopReason | null, trackCount, capturedSeconds | null,
fileId | null, transcriptId | null, summaryState | null }`.

`MeetingSummary` (the existing shape from the meetings design) gains three fields, additive:
`recordingState: 'none' | 'recording' | 'composing' | 'filed' | 'failed'`, `captionsAvailable:
boolean`, and `recordingConfigured: boolean` — so the screen knows whether to show the Record
control, exactly as `configured` already gates Start.

New problem types: `meeting-recording-not-configured` (503 — the settings are off, or
`REALTIME_SFU_APP_SECRET` / `MEETING_SINK_SIGNING_KEY` is absent), `meeting-recording-already-running`
(409), `meeting-recording-not-running` (409), `meeting-recording-needs-matter` (422 — a firm event),
`meeting-recording-too-many-tracks` (409), `meeting-transcript-not-ready` (409),
`meeting-summary-not-eligible` (409 — the firm's AI-processing eligibility setting refuses it).

### New room frames

Client → room: none. Recording is started and stopped over REST.

Room → client, both additive and both `v: 1`:

| type        | fields                                                                           |
| ----------- | -------------------------------------------------------------------------------- |
| `recording` | `state: "started" \| "stopped"`, `recordingId`, `by {userId, displayName}`, `at` |
| `caption`   | `participantId`, `userId`, `text`, `final: boolean`, `sequence`, `at`            |

`welcome` gains `recording: { state, recordingId, by, at } | null` and `captions: boolean`.

Caption frames are **not** delivered as roster deltas and are not stored by the room. A client that
joins mid-sentence sees the next final segment and nothing before it; the transcript is where the
past lives.

---

## 8. The track ceiling, and why there is one

The recorder holds one open socket, one open R2 multipart upload and an 8 MiB carry buffer per track.
A Durable Object has a bounded memory budget, so the number of simultaneously recorded tracks is
bounded whether we name a number or not. Naming it is the difference between a refusal and a crash.

`meetings.recordedTrackCeiling`, default **32**. Starting a recording in a room already above the
ceiling is refused with `meeting-recording-too-many-tracks` and the mark never lights. A recording
that is **already running** when the room grows past the ceiling keeps the tracks it has, records the
overflow participants' arrival in `meeting_recording_track` with `state: 'lost'` and
`frames_received: 0`, and the transcript carries a `gap` segment naming the span — because a record
that silently omits a speaker is worse than one that says it could not hear them.

Thirty-two is a knob, not doctrine: it is 256 MiB of worst-case carry, and the real number comes from
the load-profile harness (§14). A 300-person room recorded in full is a different design — most
likely a second recorder object sharding tracks — and it is named here, not built.

---

## 9. Compose, and filing into the matter

`apps/api-worker/src/meetings/recording-compose-consumer.ts`, a queue consumer, because mixing an
hour of audio is exactly the heavy work golden rule 10 keeps off a request handler and out of a
socket callback.

- **The mixer is a pure function**, `packages/meetings/src/pcm-mix.ts`: given N aligned
  `Int16Array` windows and their start offsets, sum with saturation into one mono window. Integer
  addition over 48,000 samples a second — about a second of CPU per hour of audio per track, and a
  unit test rather than a rehearsal.
- **It composes in windows and re-enqueues.** One invocation composes a bounded span (default ten
  minutes of audio), appends it as an R2 multipart part on the output object, records the cursor, and
  re-enqueues itself. This is the `bundle-build` consumer's shape
  (`apps/api-worker/src/downloads/bundle-consumer.ts`), and it is what keeps a four-hour deposition
  inside a Worker's budget.
- **The output is a WAV** — a 44-byte canonical header over mono 48 kHz 16-bit PCM, written last once
  the length is known, via a final small multipart part at the head. No encoder, no codec, no
  dependency, and a file every operating system and every court's media player opens.
  **FLAC is the named follow-up**: `flacenc` is pure Rust, compiles to WASM the way
  `packages/pdf` already does, and halves the stored bytes. It is deliberately not in the first slice
  — the recording has to exist before its size is worth optimizing.
- **Filing rides the existing pipeline, unchanged.** `initiateUpload` (mode `multipart`, matter from
  the event, `uploadKind: "interactive"`, name
  `Meeting recording — <event title> — <YYYY-MM-DD HH:mm>.wav`, `declaredContentType: "audio/wav"`),
  the composed object written at the minted key, `completeUploadSession`, then the `files-ingest`
  queue — the same path `apps/api-worker/src/emails/attachment-extraction.ts` uses for an email
  attachment. The recording is scanned, hashed and status-gated like every other document, and
  nothing about the File Manager changes to accommodate it.
- On success the recording moves to `filed` with `file_id`/`file_version_id`, the staging objects are
  deleted, and `meeting-transcript` is enqueued.

---

## 10. Transcript, and live captions

### The transcript of record — after the meeting

`apps/api-worker/src/meetings/transcript-consumer.ts`.

- Model **`@cf/openai/whisper-large-v3-turbo`**, through the inference chokepoint. `InferencePort`
  has no speech operation today, so this slice adds exactly one:
  `transcribe(input: { audio, firmId, language? }) → Dispatch<TranscriptionResult>` in
  `packages/inference/src/port.ts`, implemented in `gateway.ts` beside the others so the four
  confidentiality fields stay in the one place `packages/magnus/CLAUDE.md` insists they stay. **No
  second model port, and no model id named outside the catalog.** The catalog gains a `transcription`
  slot, platform-fixed like the embedding slot: a firm does not choose its speech model, because the
  transcript's fidelity is a property of the record, not a preference.
- **It transcribes speech spans per track, not the composite.** The recorder already knows who was
  speaking when, because the room relays `speaking` presence and the recorder timestamps every frame.
  So the consumer reads each track's staged PCM (kept until the transcript settles, not until the
  compose settles), cuts the spans where that participant was speaking, wraps each span in a WAV
  header, and sends it. **Speaker attribution is then a fact, not an inference**: the track name is
  the participant handle, and the participant handle is a member. Nova-3's `diarize` and Whisper's
  own segmentation both produce "speaker 0" — a number nobody can put a name to, in a record that has
  to name people.
- **Chunking:** spans are cut at **30 seconds** or at ~1 MB, whichever comes first, on the documented
  working figure from Cloudflare's own chunking tutorial. A span longer than that is split at a
  silence boundary where one exists in the last two seconds, at the hard boundary otherwise, and
  `initial_prompt` carries the tail of the previous chunk so the model keeps context across the cut.
- Segments are merged into one chronological `meeting_transcript_segment` list by `started_ms`, with
  `kind: 'gap'` rows covering every span where a track was `lost` or the ceiling refused it.
- **The filed document is a WebVTT** (`Meeting transcript — <title> — <date>.vtt`), filed under the
  same matter, beside the audio, through the same `initiateUpload`/`completeUploadSession` path. The
  rows are the record the application reads; the `.vtt` is the record the matter file holds, so the
  file is complete without the application. Cue identifiers carry the speaker's display name.

### Live captions — during the meeting

- Model **`@cf/deepgram/nova-3`** over its WebSocket transport, `encoding: linear16`,
  `sample_rate: 48000`, `channels: 1`, `punctuate: true`, `interim_results: true`, `diarize: false`
  (attribution comes from the track, §10). Flux is cheaper per minute and is built for two-party
  turn-taking; Nova-3's interim results are the better fit for a multi-party room, and the difference
  is recorded in the research note rather than guessed at.
- **A caption session is opened per track only while that participant is speaking**, on the `speaking`
  presence the room already relays, and closed after **three seconds** of silence. In a real meeting
  roughly one person talks at a time, so billed audio-minutes land near 1.3× wall-clock rather than
  N×. This is the single largest cost decision in the design (§11) and it costs nothing to build,
  because the presence machinery is already there.
- Interim results become `caption { final: false }` frames; finals become `caption { final: true }`.
  The room fans them to every socket. **The room stores none of them** — a caption is a display, and
  the transcript is the record. This keeps the "the Durable Object holds no content" posture that
  `MeetingRoom` and `MagnusConversation` both hold.
- **Latency estimate.** Microphone to publish ~40 ms (Cloudflare's own budget); SFU forward plus
  Opus→PCM plus adapter egress to the recorder ~50–80 ms; the recorder's 200 ms feed window;
  Nova-3 interim ~300 ms (Cloudflare's stated transcription budget, not our measurement); frame
  back through the room and out to clients ~30–60 ms. **An interim caption lands roughly 600–800 ms
  behind the speaker and a final roughly 1.0–1.5 s behind.** Every number above is Cloudflare's or
  arithmetic on it; none is measured, and the load-profile extension (§14) is where it becomes
  measured.
- Captions require `meetings.captionsEnabled` **and** a running recording is **not** required —
  captions can run without recording, and when they do the adapters are opened only for speaking
  tracks and torn down after, so the egress cost follows the same 1.3× shape.

---

## 11. The summary

`apps/api-worker/src/meetings/summary-consumer.ts`, enqueued when a transcript reaches `ready`.

- It calls **`InferencePort.generateConversation`** with a platform-authored instruction from
  `packages/meetings/src/summary-prompt.ts` and one member message carrying the transcript rendered
  as `HH:MM:SS Name: text` lines. The firm's `inference.primaryReasoningModel` is read through the
  firm-scoped data-access layer at the call site, exactly as every other call site does, and the
  authoritative token usage from the response is written to the metering record.
- **It is not a Magnus conversation.** A `magnus_conversation` row would put a full privileged
  transcript into the assistant's history and create a second copy of the most sensitive content the
  platform holds, for a job that has no second turn. The assistant and the summary share the one
  model seam and share nothing else. What the member gets instead is the better end of the trade:
  the filed transcript is an ordinary document, so a member can **attach it to a Magnus conversation**
  through the attachment path that already exists (`magnus_conversation_attachment`) and ask
  follow-up questions about it — one copy, one retention basis, and the assistant reached through
  its own front door.
- **Eligibility, and the open consent decision.** A meeting summary sends privileged conversation to
  a reasoning model, which is precisely the question ADR-0108 leaves open. So: the summary runs on
  the **on-Cloudflare model path by default** — a Workers-AI-hosted reasoning model from the catalog
  — and reaches a third-party frontier model only where the firm's AI-processing-eligibility setting
  allows it. When it does not, the summary is `refused` with `refusal_reason: 'not-eligible'` and the
  screen says so plainly rather than silently producing nothing. The transcription models are not
  affected: Whisper and Nova-3 are hosted on Cloudflare's own infrastructure, so a meeting's audio
  never leaves Cloudflare on any path in this design.
- Output is parsed into `summary_text` plus an ordered action-item list. An action item whose owner
  matches a participant's display name **exactly** is linked to that member; anything less than exact
  is left unowned, because a summary guessing who owes what is worse than a summary that does not.
  `task_id` is null until a member presses **Create task**, which is the existing task-creation path
  and not a new one.
- The summary is attached to the event and carries the meeting's visibility, which is the event's:
  a member who may see the meeting may see the summary, and nobody else. It is filed as rows rather
  than as a document — unlike the audio and the transcript, it is our characterization rather than
  the thing that happened, and it belongs with the record it summarizes, not in the matter's document
  list where it would read as evidence.

---

## 12. Cost per meeting-hour

All prices from the research note, read 2026-09-20. Model: a **one-hour meeting, five participants,
all publishing audio, one person speaking at a time** (overlap factor 1.3 on speech).

Per-track PCM from the adapter is 48,000 × 2 channels × 2 bytes = **192 kB/s = 691 MB/hour**.

| Line                                                        | Quantity         | Unit price            | Cost            |
| ----------------------------------------------------------- | ---------------- | --------------------- | --------------- |
| **Recording** — adapter egress, 5 tracks continuously       | 3.46 GB          | $0.05 / GB            | **$0.173**      |
| Staging R2 writes (multipart parts at 8 MiB)                | ~442 Class A     | $4.50 / M             | $0.002          |
| Compose reads                                               | ~432 Class B     | $0.36 / M             | $0.0002         |
| Composite stored (mono 48 kHz WAV, 346 MB)                  | 0.346 GB · month | $0.015 / GB-mo        | **$0.005/mo**   |
| **Transcript** — Whisper over 78 speech-minutes             | 78 audio-min     | $0.000513 / audio-min | **$0.040**      |
| **Summary** — one reasoning call, ~12k in / ~800 out        | 1 call           | model-dependent       | **$0.05–$0.25** |
| **Live captions** — Nova-3 WebSocket over 78 speech-minutes | 78 audio-min     | $0.0092 / audio-min   | **$0.718**      |

- **Recorded + transcript + summary, captions off: ≈ $0.27–$0.47 per meeting-hour**, plus $0.005 a
  month to keep it.
- **Add live captions: ≈ $0.98–$1.18 per meeting-hour.** The adapter is already open for the
  recording, so captions add no egress on top — only the model.
- **Captions alone, no recording: ≈ $0.76 per meeting-hour** ($0.045 egress for speaking spans only,
  plus $0.718 of model).

**Three things this table should make obvious.**

1. **Captions are the expensive feature, not recording.** Nova-3 over WebSocket costs 18× Whisper per
   audio-minute. The speaking-span gate (§10) is what keeps it at 1.3× rather than 5×; without it the
   same hour costs $2.76. It is a firm-level setting, default off, for exactly this reason.
2. **Egress is the whole recording cost, and it is an unconfirmed 48× away from being nothing.** PCM
   at 192 kB/s is why $0.173 is the number. If `outputCodec` accepts a compressed codec — unconfirmed,
   and the first question to put to Cloudflare — the line falls to about $0.004. Worth asking before
   building, worth building anyway if the answer is no.
3. **The free tier is shared with the meeting itself.** Realtime's 1,000 GB covers SFU, TURN and the
   adapter together. 1,000 GB is about 289 recorded five-person meeting-hours a month **before**
   counting the meeting's own fan-out to participants, which for the same meeting is larger. A firm
   that records everything will pass the free tier on the meeting traffic first.

For comparison, RealtimeKit would charge $0.002/participant-minute ($0.60/hour for five) plus
$0.010/minute of export ($0.60/hour) — **$1.20/meeting-hour before transcription** — and would give
composite video for it. The line to record in
[`docs/operating-costs.md`](../operating-costs.md) is the adapter egress and the two model rates; the
Realtime egress line already exists.

---

## 13. Video, and the one question for the owner

**There is no way to record a meeting's video today without either leaving our meeting stack or
taking a C/C++ dependency.** The evidence is in the research note: Stream does not record WHIP
inputs, the SFU has no recording and its only video egress is ~1 FPS JPEG, and there is no
production-grade pure-Rust decoder or encoder for VP8, VP9, H.264 or H.265 — libvpx, openh264 and
dav1d are all C.

Three ways forward, priced, for the owner to choose between. **None is built by this design.**

1. **Audio-only, permanently.** What this design ships. Zero consent needed, zero new operational
   surface, $0.27–$0.47 per meeting-hour. For a law firm this may simply be right: what was said is
   the record, and a picture of who was on camera is not.
2. **Adopt RealtimeKit for meetings.** The only managed composite-video recorder on Cloudflare, with
   recording, live captions, post-meeting transcripts and summaries all built. The cost is that it
   replaces our meeting stack: its own meetings API, participants, tokens, roles and UI SDKs in place
   of the `MeetingRoom` Durable Object, the SFU client, the meeting record's authorization through
   the event, and the meeting screen built in `@magna-carta/design-system`. Its track recording is
   audio-only today ("video track recording is in development"), so only the composite gives video.
   Recordings live seven days on Cloudflare's side before we must have pulled them. **This is a
   product decision about where the meeting lives, not a recording feature.**
3. **A container with a C/C++ codec.** A Rust container subscribing to SFU tracks with `str0m` or
   `webrtc-rs/rtc` — both pure Rust, both fine — that then has to decode VP8/H.264 and encode a
   composite, which is where the memory safety ends. **This requires explicit owner consent under
   golden rule 14**, and it is consent for the worst case the rule exists to prevent: memory-unsafe
   code parsing untrusted, privileged media. The clamd precedent (consented, network-isolated,
   documented) is the shape it would have to take. Recommendation: **do not**, unless option 2 is
   also refused and video recording is genuinely required.

There is a fourth thing that is not video recording but may be worth more than it sounds: the
adapter's **~1 FPS JPEG egress is decodable and re-encodable entirely in Rust** with the `image`
crate the raster conversion engine already uses. A per-participant contact sheet, or a one-frame-a-
second visual record alongside the audio, is achievable with no consent and no new dependency. It is
recorded here as an option, not proposed.

**The question to put to the owner:** _is audio-only the right record for a law firm, or is video
needed — and if it is needed, is it worth moving meetings onto RealtimeKit to get it managed?_ It is
carried on the `meetings.recording` ledger node as `awaiting-owner` once this design is accepted.

---

## 14. Failure modes — what the record says

The governing rule: **a recording never claims more than it captured, and never fails silently.**
Every one of these leaves a row a person can read.

| What happens                                                 | What the record says                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One adapter socket drops and reconnects inside the SFU's 5 s | Nothing user-visible. `frames_dropped` rises by the gap; the recorder writes silence of exactly that length so the timeline never drifts.                                                                                                                                                                                                                                                        |
| One adapter socket drops and does **not** come back          | That track goes `state: 'lost'`, `last_frame_at` is recorded, the composite carries silence for the remainder, and the transcript carries a `gap` segment naming the member and the span. The recording keeps running. The screen shows "1 of 5 participants was not captured" on the recording.                                                                                                 |
| **Every** track is lost                                      | The recorder stops itself: `stop_reason: 'sink-lost'`, the room broadcasts `recording { state: "stopped" }`, stop notices are written, and compose runs on whatever was captured. If nothing was captured at all, the recording goes `failed` with a `failure_error_id` and no document is filed.                                                                                                |
| The recorder Durable Object dies mid-meeting                 | Nothing is silently lost and nothing is silently kept. The room's next presence tick finds no recorder; the recording moves to `abandoned` with `stop_reason: 'abandoned'`, the room broadcasts `stopped` (so the mark clears rather than lying), and a sweep composes whatever completed parts exist. R2 multipart uploads with no completed part are aborted by the same sweep after 24 hours. |
| The room ends while recording                                | `stop_reason: 'meeting-ended'`; the recorder stops before the room closes sockets, so the stop notice reaches everyone who is still there.                                                                                                                                                                                                                                                       |
| Compose fails                                                | `state: 'failed'` with an Error ID. **Staging objects are kept seven days**, not deleted, because they are the only copy and a retry is possible; the sweep deletes them after that and the row keeps saying what happened.                                                                                                                                                                      |
| The `files-ingest` scan quarantines the composed audio       | The recording is still `filed`; the file version carries the quarantine status the File Manager already models, and the recording screen shows it as held rather than pretending it is playable. A WAV we composed ourselves being quarantined means the scanner found something, which is worth knowing.                                                                                        |
| Whisper fails, or every span is empty                        | Transcript `failed` with an Error ID (or `ready` with zero segments and one `gap` covering the meeting). **The audio is already filed and is unaffected** — the transcript is a derivative, and the derivative failing never touches the record.                                                                                                                                                 |
| Nova-3 refuses or drops during a meeting                     | Caption frames stop. The room sends no caption error and the client shows "Captions unavailable"; the recording and the after-the-fact transcript continue untouched, because they do not go through Nova-3 at all.                                                                                                                                                                              |
| The summary is refused by eligibility                        | `state: 'refused'`, `refusal_reason: 'not-eligible'`, and the screen says the firm's settings do not allow it. Not an error, not an Error ID, not a retry.                                                                                                                                                                                                                                       |
| The summary call fails                                       | `state: 'failed'` with an Error ID and a **Retry** control for a member holding `meetings:host`. The transcript is unaffected.                                                                                                                                                                                                                                                                   |
| The track ceiling is exceeded mid-recording                  | §8 — overflow participants get a `lost` track row with zero frames and a `gap` segment. The mark keeps running, because it is still recording the people it can hear.                                                                                                                                                                                                                            |
| `MEETING_SINK_SIGNING_KEY` or the SFU secret is absent       | Start answers 503 `meeting-recording-not-configured` and the Record control is not rendered, on the same precedent as `meetings-not-configured`.                                                                                                                                                                                                                                                 |

**Never**: an Error ID's payload carrying audio, a transcript segment, a summary sentence, or a
filename derived from any of them. The standard pipeline's redact-by-default posture is not optional
in this subsystem — it is the subsystem.

---

## 15. Testing

- `packages/meetings/test/pcm-frame.test.ts` — the protobuf reader against hand-built envelopes,
  including a truncated message, an unknown field, and a payload at exactly 32 KB.
- `packages/meetings/test/pcm-mix.test.ts` — the mixer: two aligned tracks sum; an offset track lands
  at its offset; saturation clamps rather than wraps; a gap becomes silence of exactly the right
  length; a one-hour five-track mix is measured for CPU, not merely for correctness.
- `packages/meetings/test/recording-service.test.ts` — over `node:sqlite` on the existing meetings
  precedent: start refuses a firm event, refuses above the ceiling, refuses a second concurrent
  recording; stop closes every open track at one instant; a lost track never blocks a stop; a walled
  matter's recording is unreachable.
- `packages/meetings/test/transcript-assembly.test.ts` — spans merge chronologically across tracks;
  overlapping speech interleaves by `started_ms`; a lost track produces exactly one `gap`; the
  WebVTT rendering round-trips.
- `apps/api-worker/test/meeting-recorder.test.ts` — the recorder against a fake SFU and a fake R2:
  adapter creation per track, part upload at the 8 MiB boundary, sequence-gap silence insertion,
  close on stop, and the abandoned-object sweep.
- `apps/api-worker/test/meeting-sink-route.test.ts` — **the security surface**: a valid token
  upgrades; an expired one does not; a token for a settled recording does not; a token for another
  firm does not; a request carrying any `Origin` is refused 403; a non-upgrade request is 426.
- `apps/api-worker/test/meetings-recording-routes.test.ts` — permissions (a member with
  `meetings:host` but not `meetings:record` cannot start but can stop), 503 unconfigured, the notices
  read gated on `meetings:host`, and firm isolation on every read.
- `apps/api-worker/test/meeting-room.test.ts` (extended) — the `recording` frame reaches every
  socket, `welcome` carries the state for a late arrival, one notice row per socket per fan-out, and
  caption frames are fanned but never stored.
- `apps/web/test/meeting-recording-announcement.test.ts` — the announcement fires once per
  transition and not on a reconnect that reports the same state; the mark tracks the frame; the
  `aria-live` region receives the sentence; `speechSynthesis` being absent changes nothing else.
- **Fitness:** the existing repo-wide scans cover the rest. One addition, registered
  `@repo-wide-fitness`: **no transcript, summary or caption text reaches a logger or an audit
  builder** — a source scan over the meetings worker and package, on the encryption-chokepoint
  precedent.
- **Load profile:** a recorded-meeting fixture joins the harness — a one-hour five-track recording
  with realistic speaking spans — so the mixer's CPU, the recorder's memory at the ceiling, and the
  caption latency estimate in §10 become measured numbers rather than Cloudflare's budget plus
  arithmetic.

---

## 16. Slices, and the file-touch list per slice

Five slices, each shippable, each owning its files outright so a build can be split between agents
with no file owned twice. **Slice R1 is gated on the §6.1 experiment** and nothing else starts until
that answers.

### R1 — the sink and the consent mechanism

The recording exists, everyone is told, nothing is filed yet.

- `packages/identifiers/src/registry.ts`, `src/types.ts` — three handles
- `packages/database/src/per-firm-schema.ts` + one migration + snapshot; `apps/api-worker/src/per-firm-migrations.ts`
- `packages/data-access/src/pii-registry.ts` — the identifier-only entries
- `packages/access-control/src/registry.ts` — `meetings:record` + the seed
- `packages/meetings/src/settings.ts` (new), `src/types.ts`, `src/validation.ts`,
  `src/recording-statements.ts` (new), `src/recording-service.ts` (new), `src/pcm-frame.ts` (new)
- `apps/api-worker/src/meetings/meeting-recorder.ts` (new), `sfu-client.ts` (adapter calls),
  `meeting-room.ts` + `meeting-room-protocol.ts` (the `recording` frame, `welcome`, notice batching)
- `apps/api-worker/src/routes/meetings.ts` — start, stop, list, notices
- `apps/api-worker/src/routes/meeting-sink.ts` (new), wired in `app.ts`; `MEETING_RECORDER` binding
  and `MEETING_SINK_SIGNING_KEY` in `wrangler.jsonc`
- `apps/web/src/lib/meetings/meeting-client.svelte.ts`, `recording-announcement.ts` (new),
  `recording-mark.svelte` (new), `meeting-controls.svelte`, `meetings-api.ts`,
  `routes/(app)/meetings/[id]/+page.svelte`
- Tests: `packages/meetings/test/{pcm-frame,recording-service}.test.ts`,
  `apps/api-worker/test/{meeting-recorder,meeting-sink-route,meetings-recording-routes,meeting-room}.test.ts`,
  `apps/web/test/meeting-recording-announcement.test.ts`
- Docs: this spec's status, `roadmap.d/meetings.md`, `status.d/meetings.md` + `vp run status-build`,
  `changelog.d/`, `docs/decisions/pending/`, `docs/user/features/meetings.md`,
  `docs/operating-costs.md`

### R2 — compose and file

- `packages/meetings/src/pcm-mix.ts` (new), `src/wav.ts` (new)
- `apps/api-worker/src/meetings/recording-compose-consumer.ts` (new),
  `recording-sweep.ts` (new); queue + cron in `wrangler.jsonc`, consumer wiring in `app.ts`
- `apps/api-worker/src/meetings/meeting-recorder.ts` — stop enqueues compose
- `apps/web/src/lib/meetings/recording-list.svelte` (new), `meeting-list-section.svelte`,
  `routes/(app)/meetings/[id]/+page.svelte`
- Tests: `packages/meetings/test/pcm-mix.test.ts`,
  `apps/api-worker/test/recording-compose.test.ts`; load-profile fixture

### R3 — the transcript

- `packages/inference/src/port.ts`, `src/gateway.ts`, `src/catalog.ts`, `src/stub.ts` — the
  `transcribe` operation and the platform-fixed transcription slot
- `packages/meetings/src/transcript-statements.ts` (new), `src/transcript-assembly.ts` (new),
  `src/webvtt.ts` (new)
- `apps/api-worker/src/meetings/transcript-consumer.ts` (new); queue wiring
- `apps/api-worker/src/routes/meetings.ts` — the transcript read
- `apps/web/src/lib/meetings/transcript-panel.svelte` (new), `meetings-api.ts`
- Tests: `packages/inference/test/transcribe.test.ts`,
  `packages/meetings/test/transcript-assembly.test.ts`,
  `apps/api-worker/test/meeting-transcript.test.ts`

### R4 — live captions

- `apps/api-worker/src/meetings/caption-session.ts` (new); `meeting-recorder.ts` forks speaking
  frames; `meeting-room-protocol.ts` + `meeting-room.ts` gain the `caption` frame
- `apps/web/src/lib/meetings/caption-strip.svelte` (new), `meeting-client.svelte.ts`,
  `meeting-controls.svelte`
- Tests: `apps/api-worker/test/meeting-captions.test.ts`,
  `apps/web/test/caption-strip.test.ts`

### R5 — the summary

- `packages/meetings/src/summary-prompt.ts` (new), `src/summary-statements.ts` (new),
  `src/summary-parse.ts` (new)
- `apps/api-worker/src/meetings/summary-consumer.ts` (new); queue wiring
- `apps/api-worker/src/routes/meetings.ts` — read and re-run
- `apps/web/src/lib/meetings/summary-card.svelte` (new), `meetings-api.ts`
- Tests: `packages/meetings/test/summary-parse.test.ts`,
  `apps/api-worker/test/meeting-summary.test.ts`

**Shared files, and who owns them.** `apps/api-worker/src/routes/meetings.ts`,
`meeting-room-protocol.ts`, `meeting-room.ts`, `packages/meetings/src/types.ts` and
`apps/web/src/lib/meetings/meetings-api.ts` are touched by more than one slice. Run the slices in
order, or give those five files to one agent for the whole run — the repository's own rule is that a
file has exactly one owner, and these are the five that will otherwise cost a serial repair job.

---

## 17. Decisions to record as ADRs

Written as fragments under `docs/decisions/pending/` in the commit that lands R1, per golden rule 5:

- **The recording path.** SFU WebSocket adapter into a Durable Object, PCM staged per track to R2,
  composed off the hot path, filed through the untrusted-file pipeline. Alternatives rejected with
  the evidence: Stream Live over WHIP (does not record), RTMPS/SRT (unreachable), RealtimeKit
  (a different application layer), a container (no pure-Rust video codec, and unnecessary for audio).
- **Audio-only, and the video question.** Video recording is not built and cannot be built
  memory-safely today; the three options are priced in §13 and the choice is the owner's.
- **`meetings:record` as its own permission key**, seeded to the roles that hold `meetings:host`.
- **The announcement and the mark as the consent mechanism, with a server-side notice record** — the
  owner's ruling of 2026-09-20, and what it means in the schema.
- **Speaker attribution from the track name, not from diarization**, and the per-track transcription
  that follows from it.
- **The summary runs through `InferencePort`, not as a Magnus conversation**, on the on-Cloudflare
  model path by default, and remains subject to ADR-0108's open consent question for the frontier
  path.
