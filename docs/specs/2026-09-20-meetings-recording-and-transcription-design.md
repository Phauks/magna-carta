# Meetings — recording, live captions, transcript and summary, design

**Status:** Design (brainstormed), 2026-09-20. Slice R1's server half built 2026-10-02 behind a fake
routing service, switched off until the §6.1 experiment answers (see the amendments, §18). Slice R2's
server half (compose, filing and the sweep) built 2026-10-02 (A18 to A26). Slice R3's server half (the
transcript of record) built 2026-10-03 (A34 to A44). Extends
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
   (`apps/web/src/lib/meetings/client/audio-level-meter.ts`). Synthesizing it beats bundling a sound file:
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
  `meeting-room.ts` + `packages/meeting-protocol/src/frames.ts` (the `recording` frame, `welcome`, notice batching)
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
  frames; `packages/meeting-protocol/src/frames.ts` + `meeting-room.ts` gain the `caption` frame
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
`packages/meeting-protocol/src/frames.ts`, `meeting-room.ts`, `packages/meetings/src/types.ts` and
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

---

## 18. Amendments

Recorded as the build met the design. Each says what changed and why; the section it amends is named.

**A1 — The stay is named by kind and by value (§3, §5). 2026-10-02.** `meeting_recording_track` and
`meeting_recording_notice` carry `participant_kind` (`member` | `guest` | `attendee`), `participant_id`
with no foreign key, and a nullable `user_id`, in place of `attendance_id` and a NOT NULL `user_id` —
`meeting_message`'s precedent. A guest's stay is a `meeting_guest_stay` row and a webinar attendee's
will be a table of its own, so a foreign key onto `meeting_attendance` would have barred both from the
consent record, and widening it later is the rebuild this lineage refuses. A guest or a phone caller is
now recorded as having been told, and as having a track, exactly as a member is.

**A2 — `meeting_recording.breakout_id`, nullable, by value (§5). 2026-10-02.** On the poll's
precedent, null for the main room, which is every recording today. The one-running-recording index is
partial on `state = 'recording' AND breakout_id IS NULL`, because NULLs are distinct in a unique index;
a breakout's own recordings take an index of their own when breakouts land.

**A3 — The §6.1 gate is an OWNER ACTION outstanding, and R1 was built behind the fake (§6.1, §16).
2026-10-02.** The experiment needs the live Cloudflare Realtime application, which the building session
did not have. R1 was built against the routing-service fake the meeting tests already use, extended with
`adapters/websocket/new` and `adapters/websocket/close`, keeping the token design of §6.1 exactly: the
token rides the PATH (`/internal/meeting-audio/<token>`), never a query string, so the experiment needs
to prove only that the adapter dials the endpoint with its path intact. Until it has — and the envelope's
field numbers (`sequenceNumber = 1`, `timestamp = 2`, `payload = 5`, named once in
`packages/meetings/src/pcm-frame.ts`) are confirmed in the same run — `MEETING_SINK_SIGNING_KEY` is not
set and the start route answers 503 `meeting-recording-not-configured`. The owner's steps, in order: run
the experiment; set `MEETING_SINK_SIGNING_KEY` with `wrangler secret put`; add the `/internal/*` zone
route to the api Worker (a new top-level family, `run_worker_first` already names it); then a firm
switches `meetings.recordingEnabled` on.

**A4 — Announced first, captured second (§6 "Starting", step 4). 2026-10-02.** The design had the
recorder open every adapter and then ask the room to announce. The build reverses it: the start route
asks the room to broadcast and write the `start` notices, and only then hands the recording to the
recorder, so nobody's voice is captured before the announcement reached them. A start the room could not
announce, or the recorder could not take, is stopped and failed in the record with the Error ID, and the
room is told it stopped. Symmetrically on stop: the recorder closes every adapter first and the room
announces after, so nothing is captured after the stop is announced.

**A5 — A late track is admitted by the recorder's reconciliation, not by a hook in the room's publish
(§6 "Starting"). 2026-10-02.** The recorder asks the room (`recordingCandidates`) every five seconds
while it records and reconciles: arrivals are admitted (or recorded `lost` past the ceiling), a
participant no longer publishing has their adapter closed and their track `closed`, the same track on a
new session gets a new adapter into the SAME staged object (one track with a gap, not two), and a track
whose socket has been gone fifteen seconds is `lost`. This keeps the room's media path free of any
recording concern, at the cost of up to five seconds before a late arrival's audio is captured — and the
arrival was told on their welcome at once, which is what the ruling is about.

**A6 — The staged object key is minted from the track ROW, not the track name (§6 "Starting", step 3).
2026-10-02.** `meeting-recordings/<meetingId>/<recordingId>/<trackId>.pcm`. The track name is chosen by
a browser; an object key is opaque and server-minted, the rule every other object a firm holds is
written under. The staged object is stamped with the matter and a new object class,
`meeting-recording-track`.

**A7 — The carry is in memory only (§6 "What it holds"). 2026-10-02.** §6.2 says the recorder writes no
content to its own storage; §6's list put `carry` in storage beside the metadata. The build keeps §6.2:
storage holds each track's upload, parts and counters, and the carry (at most one 8 MiB part per track)
is in memory. A recorder that dies loses at most its carry, which is the abandoned-recording sweep's
case (R2).

**A8 — Compose is handed on through an optional queue binding (§6 "Stopping", §16 R2). 2026-10-02.**
The task for R1 included enqueuing compose. The message type is defined
(`MeetingRecordingComposeMessage` in `apps/api-worker/src/meetings/meeting-recorder.ts`); the queue
binding (`MEETING_RECORDING_COMPOSE`) is optional and not declared in `wrangler.jsonc`, because the queue
and its consumer are R2's. Until then a stopped recording waits in `composing`. A recording that
captured nothing at all is `failed` with an Error ID at the stop, and its empty staged uploads are
aborted.

**A9 — The welcome's `recording` field is absent, not null, when nothing is recorded (§3, §7).
2026-10-02.** So a welcome to a room that is not recording is byte-for-byte the welcome it always was.
A browser reads the missing field as not recording. `by` is nullable on the frame, for a stop nobody
made (every track lost), and a guest's copy carries `by.userId: null`.

**A10 — Stop is gated on `meetings:join` at the chokepoint (§4, §7). 2026-10-02.** A member holding
`meetings:record` and a member running the meeting may both stop a recording, and a chokepoint gate on
either key would refuse the other; the handler reads the key and the service asks the grant, and anybody
holding neither is answered 403 `permission-denied`. `MeetingSummary.recordingState` also carries
`abandoned`, the fifth state, so the field never has to widen.

### Amendments from the adversarial review of the first slice

Recorded 2026-10-02, after an adversarial review of the recorder and its sink. Each names the section it
amends and says what changed and why.

**A11 — The recorder reads the record on every pass (§6 "Stopping", §14).** A stop the route committed
whose call never reached the recorder — it failed, or was cancelled — left the recorder capturing,
because the alarm reconciled only against the room and a frame was checked only against memory. Each
pass now reads the recording's row first and settles (adapters closed, uploads flushed and completed,
capture stopped) when it is no longer `recording`, so capture after any stop is bounded by one alarm
interval (five seconds). The route's half: a cancelled event's batch must stop a running recording too.

**A12 — A recording nobody stops ends (§6, §14).** With no track open and the room reporting nobody
publishing audio for ten minutes, the recorder stops the recording itself with `stop_reason: 'abandoned'`
— a recording that never had a track is held to the same rule. At `MAXIMUM_RECORDING_HOURS` (twelve) it
stops with `stop_reason: 'ceiling'`; that constant was a token lifetime only, and every sink token now
expires with the recording's own maximum length rather than twelve hours after it was minted. Both stops
commit the same three statements as every stop with nobody behind it and are announced to the room.

**A13 — The memory ceiling is arithmetic, and the track ceiling follows from it (§6.2, §8).** §8's
"thirty-two tracks is 256 MiB of worst-case carry" was twice an isolate's 128 MB. The staging is now one
buffer per open track, preallocated when it opens, written in place and released when it closes: a part
of R2's minimum size (5 MiB — the part size moves from 8 MiB) plus a 1 MiB overflow for the frames that
arrive while a part uploads. At most one part per track and two per recorder are in flight; a frame that
arrives when the overflow is full is dropped, counted, and kept on the timeline as silence. A gap is a
count of silence, uploaded from one shared part of zeros, never an allocation of its length. With 40 MiB
reserved for everything that is not audio, one shared silence part and a copy per upload in flight, the
recorder holds `floor((122.07 − 40 − 5 − 10) / 6) = 11` tracks, and `meetings.recordedTrackCeiling`
defaults to and is capped at that number; the arithmetic is stated once in
`packages/meetings/src/settings.ts`. Two recordings the platform places in one isolate share its memory;
that is the margin's to absorb, and a larger room is the sharded recorder §8 already names.

**A14 — A restart is accounted for, not silently absorbed (§6, §14).** A recorder that restarts marks
every open track as having lost its socket and as resuming on the wall clock, so a track whose socket is
not redialled is lost on the ordinary path and a redialled one lands at its own instant. Whatever was
buffered and not uploaded is counted as dropped frames once (a second restart before anything more
uploads does not count it again) and put back as silence; `stagedSamples` counts only parts that have
uploaded, and the captured length never includes silence that stands in for lost audio.

**A15 — Sequence numbers are resynchronised, and every discarded frame is counted (§6.2).** The first
frame on every accepted socket is placed by the wall clock, because a new socket is a new counter as far
as the recorder can tell. A frame up to fifty behind the last one taken is a repeat and is discarded; a
jump further back, or forward past the five-minute gap limit, is a counter that started again and is
placed by the wall clock. `frames_dropped` counts every frame the recorder discarded — repeats included —
as well as every frame that never arrived.

**A16 — The sink token names the track row and the adapter, and admits one socket (§6.1).** The token
carries the track ROW's identifier (never the browser-chosen track name) and a nonce the recorder mints
for each adapter it opens and rotates on reopen, so an earlier adapter's token opens nothing. The recorder
refuses a dial against a track whose socket is live. The sink route also takes the token from
`Sec-WebSocket-Protocol: meeting-sink, <token>` (on the bare `/internal/meeting-audio` too) and answers
`meeting-sink`, so the token can leave the address once the A3 experiment confirms the live adapter
offers a subprotocol; until then the path is still what the recorder hands out.

**A17 — Smaller fixes (§6, §8).** The recorder writes only the tracks that changed since its last write,
in batches of at most 128 keys (the storage API's limit). The ceiling counts STAYS: a stay holds one open
recorded track, and its further audio tracks are recorded `lost` rather than taking another
participant's slot. A part that fails to upload keeps its bytes and is retried once on the next pass; if
that fails too it is replaced by a part of silence and its frames are counted as dropped, so the timeline
keeps its length.

### Amendments from slice R2 — compose and file

Recorded 2026-10-02, as the compose step, the filing and the sweep were built. Each names the section it
amends and says what changed and why.

**A18 — The WAV header goes at the head of the FIRST part, and every part is one minute (§9).** §9 had
the header "written last once the length is known, via a final small multipart part at the head". R2
refuses that: every part of a multipart upload but the last must be at least 5 MiB and all of them one
size, so a 44-byte part cannot sit anywhere but last. It is also unnecessary — by the time a recording is
handed on, every staged track is a complete object of known size and lands at its first frame's offset,
so the composite's length is known before the first sample is mixed. The header (`packages/meetings/src/
wav.ts`) is written into the first part's first 44 bytes; parts are sixty seconds of audio (5,760,000
bytes, above R2's minimum), and one invocation composes ten of them — the ten minutes §9 names — before
re-enqueuing itself. Memory per invocation is about 40 MB whatever the length or track count: one part's
32-bit sums, the mixed part, its bytes, one track's span and its copy as samples, and the copy the binding
may make of the part — the arithmetic is in `apps/api-worker/src/meetings/recording-compose-consumer.ts`.
The mixer (`pcm-mix.ts`) sums in 32 bits and clamps once, so two loud speakers saturate rather than wrap.

**A19 — The cursor is five columns on `meeting_recording` (§5, §9).** Migration
`20261002T223719_meeting-recording-compose-cursor` adds `compose_upload_session_id` (the file pipeline's
session, by value), `compose_parts_done` (the cursor), `compose_parts` (each part's number and entity tag,
because completing the upload needs them and the storage binding cannot list an upload's parts),
`compose_attempts` and `compose_progress_at`. Added, never rebuilt: the table is a parent. The cursor
advance is guarded on the value it started from, so two deliveries of one message never both advance it;
the begin is guarded on no session yet, in one batch with the session, so a racing begin leaves nothing.

**A20 — An abandoned recording is not composed (§14).** §14 had the sweep compose "whatever completed
parts exist" of a recording whose recorder died. A staged track is only an object once its upload
completes, and a recorder that has stopped reconciling is exactly the one whose account of its parts
cannot be trusted to line a composite up. So the sweep moves the recording to `abandoned` (stop reason
`abandoned`, nobody behind it, every open track `lost`, one audit row), asks the recorder — if it answers
— to close its adapters and ABORT its uploads (`MeetingRecorder.abandon`), and tells the room it stopped
so the mark clears. "Stopped reconciling" is read from the recorder itself: each alarm pass stamps
`reconciledAt` in its own storage, and `MeetingRecorder.heartbeat` answers it; a recorder holding no
running recording (a start whose hand-over never arrived) counts as stopped, and one that cannot be asked
decides nothing that pass. The recorder's own empty-room stop (A12) is unchanged: it composes.

**A21 — The sweep rides the ten-minute cron (§16 R2).** The trigger set is one atomic write and a
fourth trigger has never been proved on this account (`wrangler.jsonc` says why), and the five-minute
sweep also runs on the tail of a provisioning request. So `runRecordingSweep` runs after the status
snapshot on `*/10`, wrapped so neither can cost the other. Its windows are multiples of that cadence: a
recorder silent five minutes, a compose with no progress for thirty (twice a queue consumer's longest
run, so a working invocation is never raced), three hand-ons before a compose is failed with an Error ID,
seven days' retention for a failed or abandoned recording's staging, a day's grace for a filed one's.

**A22 — The staged tracks are deleted when the recording is filed (§9, §10).** As §9 says. §10 has the
transcript read each track's staged PCM, kept "until the transcript settles, not until the compose
settles"; that is R3's to reconcile — either the compose leaves the staging for the transcript to
release, or the transcript reads its spans out of the filed composite at each track's offset. Named here
so R3 starts from it.

**A23 — Who files it, and what it is called (§9).** The pipeline records the member who started the
recording as uploading it: the document is what their pressing Record produced. The name is
`Meeting recording — <event title> — <YYYY-MM-DD HH:mm>.wav`, the start read in the event's own zone
through `@magna-carta/civil-time`; a zone the runtime cannot resolve is read in UTC and the name says
`UTC`. A compose the pipeline refuses (`FileManagerValidationError`), or one with nothing staged, fails the
recording with an Error ID whose message is a fixed sentence and a code — never the name.

**A24 — Loose ends from R1 (§3, §8).** The start counts STAYS against the ceiling, as the recorder does,
so eleven people each sharing a screen's audio beside their microphone are not refused. A guest's
`recording` frame and welcome carry `recordingId: null` — the handle names a firm record, on the
`by.userId` rule — and a browser tells announcements apart by the transition. The room announces one
recording once however many requests carry its start out (a replay and the request it replays both
reach it), and the room holding the recording is that proof. An end, or a calendar cancel, whose running
recording is stopped between its read and its commit is composed again from what is true now rather than
answering a server error.

**A25 — The load-profile fixture is measured where the work is, not in the load-profile harness (§15).**
That harness generates firms and measures SQL; an hour of five tracks is 1.7 GB of staged audio, which is
not a fixture it can hold. The mixer's CPU is measured over one invocation's window of five tracks in
`packages/meetings/test/pcm-mix.test.ts`, and the compose test crosses a window boundary end to end. The
one-hour five-track fixture §15 names, and the recorder's memory measured at the ceiling under it, remain
to build.

**A26 — `MeetingRecordingSummary` gains `failureErrorId`, and `stoppedBy` is "the actor, or null" (§7).**
The screen shows a failed recording's Error ID for support. `stoppedBy` is declared as a union with null
rather than `.nullable()` on the component, which the contract emitted as an intersection the generated
client read as always present; it is now `anyOf: [MeetingRecordingActor, null]`.

### Amendments from the adversarial review of slice R2 — the recorder, the compose and the sweep

Recorded 2026-10-03. Migration `20261002T234638_meeting-recording-segments-and-compose-claim` adds the two
columns these need, both added rather than rebuilt.

**A27 — A staged track is placed stretch by stretch (§6.2, §9).** A participant who left had their buffer
closed with silence to a part boundary (up to a part, about 55 s) and, on returning, was placed after that
silence: everything they said afterwards landed up to 55 s late for the rest of the meeting. And the
wall-clock silence was clamped at 300 s, so a return after a long absence landed early by the excess.
Now `meeting_recording_track.segments` records each STRETCH of the staged object — the staged sample it
begins at, the instant it was heard, and for a stretch a departure closed, the staged sample its audio
ends at. The recorder begins a new stretch when the wall clock places a frame more than half a second
behind the end of the object (a return before the padding ran out) or more than 300 s past it (a gap not
worth uploading as zeros); any other wall-clock gap is staged as silence of its full length, never
clamped. The compose places every stretch at its own instant (`placeTrackSegments`, shared with the
recorder's captured-length arithmetic), never places the padding, and never lays a stretch over the one
before it. A row with no stretches reads as one from `first_frame_at`, which is what it always meant. A
track records at most 256 stretches, because they ride its metadata in the recorder's storage; past that
a return is placed on the timeline, late by at most one departure's padding.

**A28 — A compose window is claimed, and a stall is measured from the claim (§9, §14).**
`meeting_recording.compose_claimed_at` is a lease: a consumer claims the window at the cursor it read
(guarded, `COMPOSE_CLAIM_GUARD`) before reading a byte, the window's progress releases it, and a holder
past fifteen minutes — a consumer's longest run — is gone. Two deliveries of one message, or a sweep's
hand-on racing the queue's own, therefore never upload the same part numbers at once, whatever R2 derives
an entity tag from. A consumer that throws releases its own claim, so the queue's retry is not locked out.
Progress resets `compose_attempts`, so a long recording nudged once is not one strike down for good. The
sweep hands on a compose untouched — no claim, progress or hand-on — for thirty minutes, least recently
touched first, and fails it only after three hand-ons with nothing between. The compose reads the record
again immediately before it completes the composite, and stops if the recording is no longer composing
or the claim is no longer its own. Queue concurrency is a deployment setting outside this change.

**A29 — A failed compose leaves nothing behind (§14).** `failRecordingCompose` — the compose's own
refusals and the sweep's failure alike — commits the recording `failed` (now guarded,
`FAIL_COMPOSE_GUARD`) in one batch with the file manager's own `abortUploadSession` (session aborted,
pending version abandoned), then aborts the multipart upload and deletes anything a completion left at
the key. A failure that lost the race to a filing rolls back whole and lets go of nothing. The upload
session is opened with a two-day expiry as the stale-upload sweep's backstop.

**A30 — The layout is checked, and a missing track is said (§9).** Each window lays the tracks out again,
and a layout whose length differs from the upload session's declared size — the length the header
already written says — is refused rather than written. A staged object missing when the compose BEGINS is
composed without: the row carries the Error ID of that fault (a fault on the way, not the outcome), the
track's row stops naming the object, and filing brings `captured_seconds` down to the composite's own
length. One that vanishes after the compose began fails the recording, because the windows already
written placed it. `readComposeTarget` deliberately reads the file manager's `upload_session` and
`file_version` rows rather than calling `loadUploadSession`: it needs the declared size and the file the
version belongs to, which that function does not return, and it now checks the session's status. It is
addressed by the session handle the recording itself recorded, in the firm's own database.

**A31 — The WAV-length policy (§9).** A composite past the signed 32-bit boundary (about 6.2 hours) is
still filed as ONE canonical WAV, whole, with lengths written as the format defines them (unsigned). Not
capped — a seven-hour deposition is an ordinary day — and not split, because one recording is one document
on the matter. A reader that misreads the lengths as signed fails on that file; FLAC or the RF64 container
removes the boundary and is the size follow-up §9 already names. Only past the unsigned limit, which the
recorder's twelve-hour maximum never reaches, is a composite refused (before anything is opened).
`WAV_SIGNED_READER_MAXIMUM_DATA_BYTES` in `packages/meetings/src/wav.ts` states it.

**A32 — An abandoned recording keeps what it captured (§14, amends A20).** `MeetingRecorder.abandon()`
now uploads each buffer's remainder and COMPLETES every upload, aborting only one that staged nothing,
and writes what each track carried; nothing is composed. The sweep's seven-day retention of an abandoned
recording's staging therefore keeps real audio, which an aborted upload never did.

**A33 — Smaller fixes (§9, §14, §15).** The filed name's title has controls, bidirectional and invisible
characters removed, path separators replaced, runs of space collapsed, and is cut at 120 characters with
an ellipsis; an empty result is "Untitled meeting". The sweep costs a firm with nothing to tend one read,
not three — it is deliberately not skipped on `meetings.recordingEnabled`, because a firm that switched
recording off mid-compose still needs that recording filed — and its three duties fail independently,
so a queue that refuses a hand-on no longer skips the staging clean-up. Staging keys are cleared in
statements of at most ninety handles: a Durable Object's SQLite binds at most a hundred variables, and
the sweep's page of two hundred failed every time. The mixer's CPU test now covers one invocation at the
eleven-track ceiling with both byte conversions, bounded at a third of a consumer's thirty-second budget.

### Amendments from slice R3 — the transcript of record

Recorded 2026-10-03, as the transcript's server half was built. Migration
`20261003T003618_meeting-transcript` adds both tables. Each names the section it amends and says what
changed and why.

**A34 — The staging is the transcript's until it settles (§9, §10, §14; resolves A22).** The compose no
longer deletes the staged tracks when it files the recording: the transcript reads each track's own staged
PCM, and the staged tracks are deleted when the transcript SETTLES — `ready` or `failed` alike. The sweep's
retention for a filed recording's staging waits for its transcript (a recording with a `pending` transcript
is never released, and one whose transcript settled is released a day's grace after it last moved, as a
backstop for a settle that could not let go), and the sweep fails a transcript stuck past its attempts so
the staging is released even then. Reading spans out of the filed composite was the other way A22 named; it
was not taken, because the composite is the sum of every track and a span read out of it is no longer one
person's voice.

**A35 — Speech spans come from each track's energy, not from presence (§10).** §10 said the recorder knows
who was speaking from the room's relayed `speaking` presence; the recorder never recorded presence, and the
room keeps none. So the spans are found in the staged audio itself (`packages/meetings/src/speech-spans.ts`):
twenty-millisecond frames measured in dB below full scale; a noise floor at the tenth percentile of a
region's frames; a frame is voiced at ten decibels above that floor, the threshold held between -55 dB (so
hiss on a silent track is not speech) and -25 dB (so a stretch that is nearly all speech still hears it); a
span begins 100 ms before its first voiced frame, runs through quiet of up to 300 ms and ends 300 ms after
its last voiced frame (the hangover that keeps a word's end), and fewer than 60 ms of voiced frames is a
click, not speech. A staged sample is mapped onto the recording's timeline through the track's stretches
(`placeTrackSegments`, the compose's own placement, A27) and a piece never crosses from one stretch into the
next. Attribution is the track: a member's stay and `user_id`, or a guest's stay, by value.

**A36 — Pieces, the rate, and the prompt (§10).** A span longer than thirty seconds is cut at the quietest
frame of the two seconds before the thirty when that frame is below the threshold, and at exactly thirty
otherwise. Each piece is downsampled from 48 kHz to 16 kHz (`resample.ts`): a 127-tap Blackman-windowed
sinc low-pass with its cutoff at 7 kHz, evaluated only at the kept samples, then one sample in three — so
nothing above about 8 kHz folds back into the speech band. A piece is wrapped as a 16 kHz mono 16-bit WAV
(`wavHeader` takes the rate) — thirty seconds is 960 kB, inside §10's 1 MB — and sent with the last 200
characters of the same track's previous line, begun at a word, as `initialPrompt`. No language hint is sent;
the model detects it.

**A37 — No new queue; a window is a bounded number of model calls (§10, §16 R3).** The transcript is a
second kind of message (`MeetingTranscriptMessage`, `kind: "meeting-transcript"`, identifiers only) on the
existing `meeting-recording-compose` queue, routed by `kind` in `apps/api-worker/src/event-dispatch.ts` (a
kind neither consumer knows is retried rather than lost), so the deploy needs nothing new. The pending row is
written in the batch that files the recording — a recording is never filed without one, and a filing that
lost its race takes it back — and the first message is sent once that batch has committed. One message is at
most eight model calls and four five-minute regions measured (`transcript-consumer.ts`); the cursor (the
track, the staged sample, the segments written) is on the row, each window is CLAIMED with a fifteen-minute
lease on the compose's terms, every piece's lines commit in one guarded batch with the cursor that moves past
them, and the claim is released before the next window is sent. A region still open at its end resumes at
the start of its last piece, so no span is cut at a region's edge. Memory per invocation is about twenty
megabytes.

**A38 — The schema, adjusted to the built tables (§5).** `meeting_transcript.recording_id` is NOT NULL
with a plain unique index — every transcript is a recording's. `model_id` and `language` are nullable and
are what the model REPORTED (the first language it names), because a row written before the first answer
cannot name a model it has not heard from. Added: `transcribed_seconds` (audio sent, what it is billed by),
`file_version_id` beside `file_id`, the cursor (`cursor_track`, `cursor_sample`, `segments_written`), the
filing's `upload_session_id`, `attempts`, `progress_at` and `claimed_at`; a CHECK that a `ready` transcript
names its file and a `failed` one its Error ID. `meeting_transcript_segment` names the stay by value
(`participant_kind`, `participant_id`, `user_id`) on A1's precedent, plus the `track_id` it came from, in
place of `attendance_id`. While a transcript is pending its lines carry NEGATIVE provisional ordinals in the
order written, because a line's place among the other tracks' is known only at the end; the settle renumbers
them chronologically (start, end, handle) in one `UPDATE … FROM` over a window function, and a negative
ordinal can never collide with a final one under the unique index. The PII registry classes the segment's
`text`, `participant_id` and `user_id` as `retain-under-matter` content and identifiers, and
`meeting_transcript` as holding no personal data.

**A39 — Where the transcript could not hear (§8, §10, §14).** A gap line is attributed to the stay whose
audio is missing — §14's "naming the member", over §5's "null on a gap" — and is: a lost track from its last
frame to the recording's stop; a lost track that carried nothing (the ceiling refused it) from its arrival
to the stop; a track that carried audio whose staged object was not there to read, over the span it was
captured. A recording in which nothing at all was heard is `ready` with ONE unattributed gap over its whole
length, beside any per-track gaps, as §14 says. The gaps are written in the same batch that renumbers the
lines and begins the filing, guarded, so they are written once.

**A40 — The filed document (§10).** WebVTT, named `Meeting transcript — <event title> — <YYYY-MM-DD
HH:mm>.vtt` with the audio's own title cleaning and start stamp (`meetingDocumentFileName`), so the pair sit
together on the matter and a second recording of one meeting is told apart by its time; declared
`text/vtt`, filed through `initiateUpload` (single put) and `completeUploadSession` by the member who started
the recording, then the ingest queue. The declared size is left null: the document is rendered from the rows,
and a filing resumed after a crash renders it again, which a speaker renamed in between would make a
different length. A NOTE carries the meeting's title; each cue's identifier is `<n> <speaker>` and its
payload a voice span `<v speaker>`; a gap's cue says whose audio was not captured, or that no speech was.
Every piece of text is made safe for where it goes: one line, no controls, no `-->` in a NOTE or an
identifier, and `&`, `<`, `>` as character references in a payload. The audit rows (`meetings.transcript.ready`,
`.failed`) carry handles and counts only.

**A41 — Failure (§14).** A model that refuses for now (a retryable problem) is the queue's redelivery; after
three deliveries of the window the transcript is `failed` with an Error ID. A refusal no retry can change, a
staged object that vanished mid-transcript, or a recording that is not filed fails it at once. The recording
sweep hands on a transcript nothing has claimed, moved or handed on for thirty minutes and fails it after
three hand-ons with nothing between. Every failure — `failMeetingTranscript` — is guarded on `pending`,
aborts a filing that had begun (its session and pending version), deletes anything at its key, and releases
the staging. The filed audio is never touched. Every Error ID is recorded against a fixed sentence and a
code; no word, name, document name or key reaches a log line, an audit row or an error.

**A42 — The read (§7).** `GET /api/v1/meetings/{meetingId}/recordings/{recordingId}/transcript` on
`meetings:join`, per RECORDING rather than §7's per meeting, because a meeting may hold several recordings.
It reaches the meeting through the visible-matter predicate and then the recording within it, so a walled
matter's transcript is not found. It answers `{ transcript, data, nextCursor }`: the header always, and the
lines (two hundred a page, the cursor the last ordinal) only once the transcript is `ready` — a pending or
failed one answers its header with an empty page rather than §7's `meeting-transcript-not-ready` 409, so a
screen can say where it stands; no transcript is 404. Each line is `{ id, ordinal, kind, startedMs, endedMs,
text, speaker }`, the speaker `{ participantKind, participantId, userId, displayName }` or null, the name
read off the stay at the moment of asking. The recording list entry gains `transcript: { id, state, fileId }
| null`, and `transcriptId` on the summary is filled from it.

**A43 — The model port (§10).** The consumer reaches `InferencePort.transcribe` the way the inference
consumer reaches the port — through the composition root, `deploymentInferencePort` in `apps/api-worker/src/inference/call-site.ts`, the gateway — with no deploy-time switch, because the
speech model is hosted on Cloudflare and a transcript of stub text filed on a matter would be worse than
none; a test hands its own port in. The audio seconds sent are on the row (`transcribed_seconds`); writing
them to the token-usage meter is not done.

**A44 — Not built here.** The repository-wide fitness scan §15 names (no transcript, summary or caption text
reaching a logger or an audit builder) is not added; the transcript panel is the web half; the load-profile
fixture of A25 is still open; live captions (R4) and the summary (R5) are next.
