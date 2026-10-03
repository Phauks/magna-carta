# Meetings — recording, live captions, transcript and summary, design

**Status:** Design (brainstormed), 2026-09-20. Slice R1's server half built 2026-10-02 behind a fake
routing service, switched off until the §6.1 experiment answers (see the amendments, §18). Slice R2's
server half (compose, filing and the sweep) built 2026-10-02 (A18 to A26). Slice R3's server half (the
transcript of record) built 2026-10-03 (A34 to A44). Slice R5's server half (the summary) built
2026-10-03 (A57 to A67), and corrected after its review (A68 to A80). Slice R4's server half (live
captions) built 2026-10-03 (A81 to A89). Extends
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

### Amendments from the adversarial review of slice R3 — the transcript

Recorded 2026-10-03. Migration `20261003T015627_meeting-transcript-model-failures-and-milliseconds`
adds two columns to `meeting_transcript`. Each names the amendment or section it changes.

**A45 — A speech model that is down for a while is outlasted (amends A41).** Counting the queue's
deliveries of one window failed a transcript after about thirty seconds of a Workers AI outage (two
retries at ten and twenty seconds), and failed one that made progress on every delivery but met a refusal
on a different piece each time. Now a retryable refusal is counted on the row (`model_failures`, reset by
any progress, in the same guarded write as the claim's release), and the window is sent again on a NEW
message after `min(900, 30 × 2^(n−1))` seconds — a new message because the queue's own redelivery is
bounded by its retry budget of three, which an outage of tens of minutes outlasts. The tenth refusal in a
row fails the transcript: thirty seconds to fifteen minutes, about an hour and a quarter in all. The
longest delay is held under the sweep's thirty-minute stall, and the failure write stamps `progress_at`,
so a transcript waiting on a scheduled retry is never judged stalled.

**A46 — What a failure does with the staging depends on why (amends A34 and A41).** A failure a later
attempt could get past — a model that stayed unavailable, or the sweep finding the transcript stalled —
KEEPS the staged tracks, under the seven-day `UNSETTLED_STAGING_RETENTION_MILLISECONDS` a failed compose's
staging has, because they are the only per-speaker copy of the audio (§14's own reason for the compose).
`listExpiredStagingTracks` releases a filed recording's staging seven days after its transcript FAILED,
and a day after it became ready. A refusal no retry can change (the model's non-retryable answer, a
staged object that vanished, a recording not filed, the upload pipeline's refusal) still releases the
staging at once. There is no re-run path yet; the retention is what keeps one possible.

**A47 — Every failure is guarded on what it read (amends A41).** `failTranscriptStatement` is guarded on
the upload session the failure read (`upload_session_id IS ?`) as well as on `pending`, so a filing that
begins between a failure's read and its commit refuses the failure instead of being left open on the
matter. The sweep's failure is further guarded on the `progress_at` and `claimed_at` it judged stalled, so
a consumer that claimed the transcript in between is not failed under (and its staging is not taken while
it reads). A document written at the session's key whose completion the pipeline then refuses (the
session expired in between) is deleted before the refusal fails the transcript, so no bytes are left that
nothing names.

**A48 — A redelivery that meets a live lease is retried, not acknowledged (amends A37).** A claim refused
because another consumer's lease is still live at the very cursor this delivery read — its holder evicted
mid-window by a deploy, most often, and every merge to `main` deploys — answers `claimed-elsewhere`, and
the queue retries the message once the lease has run out. A refusal because the cursor or the state moved
is still nothing to do. The transcript waits at most the rest of a lease rather than the sweep's stall and
one of its hand-ons.

**A49 — A lost speaker whose audio is missing (amends A39).** A39 wrote a lost track's gap from its last
frame, so a lost track whose staged object was not there to read had nothing said for the span it WAS
captured. The settle now asks every track that carried audio whether its object is there, lost or not, and
a missing one's gap begins at its first frame — running to its last frame for a track that closed, and to
the stop for one that was lost.

**A50 — A track whose staging vanishes part-way is refused (amends A41).** A track whose object is missing
once its cursor has moved into it is the fault `readStagedSamples` already refuses, not a track with
nothing more to hear: moving on would have let the settle write a first-to-last-frame gap over lines
already transcribed from it.

**A51 — The settle releases, then drives ingest, and both ingest hand-ons are best effort (amends A40 and
§9).** A redelivery after `ready` (or after `filed`) does nothing, so an ingest enqueue that threw used to
leave the transcript's staging for the sweep's backstop and, in the compose, kept the transcript's first
message from being sent. The staging is released first, and a failed ingest enqueue is recorded and does
not throw — the deployment's own object-created event drives ingest without it.

**A52 — What the speech is measured against, and what is kept of the answer (amends A35 and A36).** The
noise floor leaves the recorder's own digital silence out of its percentile (a mute or frames that never
arrived), which otherwise put the floor at -100 dB and sent ordinary room noise to the model as speech. A
segment the model reports as beginning at or past the end of the piece it was sent is dropped, not clamped
to a zero-length line: it is words where no audio was (the hallucinated tail). The audio sent is counted in
milliseconds (`transcribed_milliseconds`, backfilled from the seconds; `transcribed_seconds` is no longer
written), because rounding each piece to whole seconds counted a half-second "yes" as nothing.

**A53 — The language (amends A36 and A38).** The first piece of at least eight seconds
(`LANGUAGE_DETECTION_MINIMUM_MILLISECONDS`) names the transcript's language, and every later piece is sent
with it as the hint. A shorter piece's detection is not recorded: a misread "yes" used to fix the record's
language and, with no hint, later short pieces could come back in the wrong language. The port carries no
confidence figure (`language_probability` is not passed on), so length is the measure; a transcript with
no piece that long has a null language.

**A54 — The read follows the filed document, and is audited (amends A42).** The lines are a second copy of
the WebVTT document's words, so the route serves them only while the transcript's filed version exists, is
not in the trash and is not held by the scan — read from the file pipeline's own record of that version and
gated on the file's own matter (`recording-document-state.ts`); a version still being scanned, or one a
later upload replaced on the file, still serves. Otherwise the header is answered with no lines and
`linesWithheld` — `removed`, `held` or `unavailable` — says why. The route is `audited`, as the document's
download is: every page of lines served writes ONE `meetings.transcript.read` row naming the reader, the
transcript, the meeting, the recording, the document and its version, where the page began and how many
lines it held — never a word or a name. A header with no lines is not a read of the words and writes none.
This is the conservative reading; the owner has not ruled on whether the route is instead a preview.

**A55 — Purging the document does not yet delete the segments.** The file manager has no purge or
deletion hook another subsystem can join: deletion is a soft delete that destroys only the working copy,
and `purgeableVersionObjects` — the one door to destroying a version's bytes — is called by nothing yet,
by design, until the retention-policy engine is built. So nothing deletes `meeting_transcript_segment` when
the `.vtt` goes. Until that engine exists, A54's gate is what keeps a trashed or purged document's words off
the read (a purged version reads as `unavailable`); when it is built, purging a transcript's version must
delete its segments in the same act, and the retention engine is where that belongs.

**A56 — What is still not built (replaces A44).** The repository-wide fitness scan §15 names is built for
the transcript: `packages/meetings/test/no-transcript-text-escape.test.ts` finds every first-party module
that reaches a transcript's words and fails when one passes the words, a speaker's name, the model's prompt
or the document's name to the failure pipeline, a logger, an audit builder, an Error or a problem body. It
reads names, so text laundered through a variable named for nothing is still a review question. Summary and
caption text join it when R4 and R5 add them. The load-profile fixture of A25 is still open. A thrown Workers
AI error carries only a message (no status or code), so a permanent input error is still retried as an
unavailable model (`gateway.ts`, beside `gatewayFailure`).

### Amendments from slice R5 — the summary

Recorded 2026-10-03, as the summary's server half was built. Migration `20261003T034941_meeting-summary`
adds both tables. Each names the section it amends and says what changed and why.

**A57 — No new queue, and a ready transcript always has a summary (§11, §16 R5).** The summary is a third
kind of message (`MeetingSummaryMessage`, `kind: "meeting-summary"`, identifiers only) on the existing
`meeting-recording-compose` queue, routed by `kind` in `apps/api-worker/src/event-dispatch.ts` beside the
compose and the transcript, so the deploy needs nothing new. The pending row is written in the batch that makes the transcript `ready` — a
transcript is never ready without one, and a ready that lost its race takes it back — and the first
message is sent, best effort, once that batch has committed. A send that fails leaves the summary pending,
and a member's re-run (A63) sends it on. Whether the summary is then written is decided when it RUNS, not
when it is begun, so a switch turned off in between is honoured.

**A58 — Which model writes it, and when none does (§11). An owner decision is assumed here.** Read at run
time through the firm-scoped data-access layer, in this order: `meetings.summariesEnabled` off is `refused`,
`disabled`; a firm that has CHOSEN no reasoning model (no stored `inference.primaryReasoningModel` row —
`resolveChosenReasoningModel` in `apps/api-worker/src/inference/call-site.ts`, because the setting's own
read answers the platform tier's third-party model for a missing row) is summarized by the catalog's
reasoning model HOSTED ON CLOUDFLARE; a firm that chose a model hosted on Cloudflare gets it; a firm that
chose a third-party model gets it only where `inference.aiProcessingEligibility` allows, and is otherwise
`refused`, `not-eligible`, with the chosen model named on the row — the firm's choice is never swapped for
another model behind its back. The catalog had no reasoning model hosted on Cloudflare, so one is added
(`@cf/meta/llama-4-scout-17b-16e-instruct`, catalog version 5): its facts were read 2026-10-03 off
Cloudflare's model page (a 131,000-token context window; no published answer limit, the default being 256
tokens) and its confidentiality facts off the Workers AI data-usage page the transcription entry already
cites. It holds no tier, so an unconfigured firm's default for the assistant is unchanged, and a firm may
select it on its AI settings screen like any other reasoning entry. **Assumed:** that a summary written on
Cloudflare's own infrastructure needs `meetings.summariesEnabled` and not the AI-processing eligibility —
the eligibility setting asks whether content may reach a third-party provider, and on this path it does
not. ADR-0108's open consent question is the owner's; if the answer is that every reasoning model needs
the eligibility, the change is one branch in `resolveSummaryModel`.

**A59 — A transcript too long for one call, and the bound (§11).** The catalog now records each reasoning
entry's `contextWindowTokens` (and `maximumOutputTokens` where the provider publishes one), read off the
providers' own pages on 2026-10-03 — 1,000,000 for both third-party reasoning entries, 131,000 for the one
on Cloudflare — and module-load validation requires it of every reasoning entry. One call carries at most
`context − 8,192 (the answer) − 2,048 (the instruction and participant list)` tokens of transcript,
measured as UTF-8 bytes at three bytes a token, a deliberate over-count (English runs nearer four): about
362 kB on the model hosted on Cloudflare, an hour of meeting being about 36 kB. A longer transcript is cut
into parts at line boundaries, each part summarized with a 4,096-token answer and the parts' answers
combined in one last call. The bound is the per-message budget: a whole run is one message, whose CPU is
string work over a few megabytes and whose wall clock is the model's writing — at a conservative forty
tokens a second, five parts and the combination are about 700 seconds, inside the 900 a consumer may run —
so `SUMMARY_PARTS_MAXIMUM` is five (about 600,000 tokens on the smallest context in the catalog, past the
recorder's twelve-hour maximum spoken without pause). A transcript that would need more fails with an Error
ID rather than being summarized in part. The arithmetic is stated once, in
`packages/meetings/src/summary-prompt.ts`.

**A60 — The answer is a strict structure, and two facts are never the model's word (§11).** The model is
asked for one JSON object — `summary`, and `actionItems` of `text`, `owner`, `dueOn` and `dueOnStated` —
documented in `summary-prompt.ts` and read by `summary-parse.ts`, which refuses anything else with a closed
reason (`not-json`, `wrong-shape`, `summary-too-long`, …) and repairs nothing; the one envelope tolerated is
a single code fence wrapping the whole answer. Each part's answer is held to the same structure before it
is combined. A refused answer fails the summary with an Error ID — a model that answered badly is not a
model that is down — and a member may run it again. An owner is linked only when the name the model gave
is exactly the name of one participant the transcript knows and that participant is a member (a guest, a
near match, or a name two members share leave it unowned). A due date is kept only when it is a real
civil date, the model quoted the transcript's words stating it, those words appear verbatim in what it was
sent, and they carry the date's day of the month as a number — so "next Friday" is never a date, and a
quote naming a different day drops it. Gap lines are not sent; the participant list is the stays that
spoke, by the names the transcript read gives them.

**A61 — The schema, adjusted to the built tables (§5).** `meeting_summary` carries `recording_id` beside
`meeting_id` and `transcript_id` (the read and the recording list are per recording, A42); `model_id` and
`snapshot_id` are nullable — a pending row, a `disabled` refusal and a transcript with no speech name no
model — and a `not-eligible` refusal names the model the firm chose; the token counts are NOT NULL from
zero and summed across a run's calls, beside `model_calls`; added are `model_failures`, `claimed_at`,
`progress_at` and `requested_by_user_id` (the member behind the run on the row, null for the platform's
own); a CHECK that a `ready` summary carries its text, a `failed` one its Error ID, and that a refusal —
and only a refusal — carries a reason. `meeting_summary_action_item.due_on` carries the shared civil-date
guard, and `task_id` is indexed. The PII registry classes `summary_text` and the action item's `text` as
`retain-under-matter` content and work product, and `requested_by_user_id` and `owner_user_id` as
identifiers.

**A62 — A model that will not answer, two deliveries, and the meter (§14).** A retryable refusal is
outlasted exactly as the transcript's speech model is (A45): counted on the row in the guarded write that
lets go of the claim, the run sent again on a NEW message after the transcript's doubling delay, and the
transcript's limit of refusals in a row fails it with an Error ID. A run is claimed on the row with a
fifteen-minute lease before a word is sent, so a second delivery meets the claim and is retried when the
lease runs out. Every settle — ready, failed, or a model refusing for now — writes the provider's usage for
every call the run made to `token_usage_meter` in its own guarded batch, so tokens spent on a run that did
not finish are counted, and a run that lost its claim meters nothing. A retry re-runs every part, and the
parts a failed run had already summarized are spent again; keeping part answers between messages would be
a second store of derived content, and is not done.

**A63 — The routes (§7).** Per RECORDING, as the transcript's read is (A42), all reached through the meeting
read with the visible-matter predicate, then the recording within it, then its transcript:
`GET /api/v1/meetings/{meetingId}/recordings/{recordingId}/summary` on `meetings:join` answers
`{ summary, text, actionItems, withheld }` — the header always; the text and the action items (each
`{ id, ordinal, text, owner: { userId, displayName } | null, dueOn, taskId }`) only for a `ready` summary
whose transcript's filed document can still be opened, otherwise `withheld` is `removed`, `held` or
`unavailable` on A54's reading; no summary is 404. `POST` on the same path, on `meetings:host`, asks for it
again: a summary being written is left alone (and sent on only when nobody holds it), a settled one is
rewritten in place — its text, its spend and its action items cleared in one guarded batch, so two requests
start one run — and a transcript with none gets one; a transcript not ready is 409
`meeting-transcript-not-ready`. A task already made of a replaced action item is kept; the item that named it
goes with the text it was read from. `POST …/summary/action-items/{actionItemId}/task` is on `tasks:write` at
the chokepoint and asks `meetings:join` in the handler (the item is the meeting's), and `tasks:assign` to put
it in another member's name; it composes `createMatterTask` — the task subsystem's own path, its
validation, audit row and assignment notice — on the recording's matter, titled with the item (cut at the
title limit with the whole as the body), due on the item's date read in the meeting's event zone, in the
owner's name unless `assignToOwner` is false, in one batch with the item's `task_id` guarded on its having
none (409 `meeting-summary-action-item-tasked`); a summary not ready or withheld is 409
`meeting-summary-not-ready`. The recording list entry gains `summary: { id, state, refusalReason } | null`,
and `summaryState` is filled from it. §7's `meeting-summary-not-eligible` 409 is not used: eligibility
answers a refused summary, never an error.

**A64 — The audit rows (§5).** `meetings.summary.ready` (models, calls, tokens and counts of items, owned
items and dated items), `.refused` (the reason and the model), `.failed` (the Error ID), `.requested` (a
member asking for a run), `.read` (one per read of the words, identifiers and the item count) and
`.actionItemTasked` (the item and the task). Never a sentence of the summary, an item's text or a name.

**A65 — The model port (§11).** `ConversationInput` gains an optional `maximumOutputTokens`, sent as the
provider's `max_tokens`: Workers AI answers 256 tokens unless told otherwise, which would cut every summary
mid-object. A model hosted on Cloudflare takes the platform's instruction as its first message in the
`system` role its chat schema defines, still written from the port's own `systemPrompt` field and never from
a member message; a third-party model keeps it on its own top-level field. The consumer reaches the port
through `deploymentInferencePort`, as the transcript does, with no deploy-time switch to the stub: a summary
of stub text on a matter would be worse than none.

**A66 — No summary text reaches a sink (§15, amends A56).** `packages/meetings/test/no-transcript-text-escape.test.ts`
now finds every module that reaches a summary — its statements, service, prompt, parse and types, the
consumer, the routes — and fails when one hands the summary text, an item's text, the lines the model was
sent or its answer to the failure pipeline, a logger, an audit builder, an Error or a problem body.

**A67 — What is still not built.** The summary card is the web half. A pending summary whose first message
was lost is rescued by a member's re-run rather than by the recording sweep. Purging the transcript's
document does not delete the summary rows, on A55's terms: the withholding is what keeps their words off
the read until the retention-policy engine exists, and that engine must delete them with the transcript's
segments. Caption text (R4) is not yet in the scan.

### Amendments from slice R5's review — the summary, corrected

Recorded 2026-10-03, after an adversarial review of the summary's server half. Migration
`20261003T045533_meeting-summary-retry-and-failed-call` adds two columns to `meeting_summary`. Each names
what it amends.

**A68 — A summary needs the firm's AI-processing eligibility on every path (amends A58; owner decision).**
A summary sends a privileged conversation to a reasoning model to reason over, whichever model that is, so
it needs BOTH `meetings.summariesEnabled` and `inference.aiProcessingEligibility`. A58's assumption — that
the model hosted on Cloudflare needed only the first — is withdrawn. `resolveSummaryModel` reads, in
order: summaries off is `refused`, `disabled`; eligibility off is `refused`, `not-eligible`, naming the
model the summary would have run on (the firm's chosen model, or the platform's own); otherwise the firm's
chosen third-party model, or, where it chose none, the platform's model hosted on Cloudflare — still the
default. The AI settings screen's "Every AI feature is off while this is off" therefore stays true of the
summary. (The transcript's speech model is platform-fixed and runs whatever that switch says; that is the
transcript's design, unchanged here.)

**A69 — The platform's own reasoning model is `@cf/openai/gpt-oss-120b`, in a role no firm selects
(amends A58, A59, A65).** Llama 4 Scout is replaced. It is multimodal, and the Llama 4 acceptable-use
policy withholds the licence's rights in its multimodal models from a company whose principal place of
business is in the European Union (read 2026-10-03,
https://github.com/meta-llama/llama-models/blob/main/models/llama4/USE_POLICY.md); the firm buckets here use
the EU jurisdiction, so a firm this platform serves can be one. `gpt-oss-120b` is text-only and published
under the Apache License 2.0 with a usage policy that asks only for lawful use (its Hugging Face card's
LICENSE and USAGE_POLICY, read 2026-10-03). Cloudflare's model page states a 128,000-token context window,
a `messages` input with a `system` role, `max_tokens` defaulting to 256, `response_format` (JSON mode) and
reasoning effort low/medium/high (read 2026-10-03,
https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/ and its `sync-input.json`); the Workers
AI changelog for 2026-02-17 says the binding accepts `messages`, `prompt` or a Responses-style `input`. The
chat translation every model hosted on Cloudflare already takes is therefore its request; the gateway now
also reads a JSON-mode `response` object and a Responses-style `output` answer. The catalog (version 6)
puts it in a new `platform-reasoning` slot, so it is NOT on the roster a firm chooses its assistant's
model from: a firm that picked it for the assistant would have every answer cut at 256 tokens. As a guard
for any caller that forgets, the gateway sends a model hosted on Cloudflare a default answer length
(`ON_CLOUDFLARE_DEFAULT_MAXIMUM_OUTPUT_TOKENS`, 4,096) on `generate`, `generateStream` and
`generateConversation` when none is asked for. With no Cloudflare-hosted entry on the roster, the settings
screen never labels one "Zero data retention: In force"; the label is rendered outside `apps/web/src/lib/ai`
(in the settings route itself) and is unchanged, and the catalog entry's own comment says its
confidentiality rests on Cloudflare's Workers AI data terms rather than a third party's retention promise.

**A70 — The answer's form is asked for in the model's own terms (amends A60, A65).** `ConversationInput`
gains `answerFormat: "json-object"`, sent to a model hosted on Cloudflare as `response_format: { type:
"json_object" }`, so somebody in the meeting saying "answer in plain text" cannot change the answer's form
and fail every run. A third-party model is sent no such field on this path (its messages API has none
there), and the strict parse remains the guard.

**A71 — The bound, re-reckoned (amends A59).** Bytes are no longer a safe over-count: a line's
`HH:MM:SS ` prefix is nine bytes and five or six tokens, and Devanagari or Thai runs three bytes a
character and often a token or more a character. Text is now reckoned per UTF-8 byte — a non-ASCII byte
as a whole token (a byte-level tokenizer can make no more), an ASCII byte as two thirds of one
(`estimatedTokens`) — and the participant list is reckoned into each call rather than assumed inside the
instruction's reserve. Every call's answer room is 16,384 tokens, because a reasoning model spends part
of it thinking and the documented structure at its fullest is about 5,000. A long transcript's parts are
summarized as before, but only their PROSE is combined: each part's action items are kept as the part
gave them, in order, so the combining call (`{ "summary": string }` alone, `readCombinedSummaryAnswer`)
can neither drop nor alter an obligation, and a summary may hold `SUMMARY_RUN_ACTION_ITEMS_MAXIMUM` (200)
items — forty an answer, five parts. An undertaking restated in two parts is listed twice.

**A72 — The wall clock is enforced, and each call is metered as it completes (amends A59, A62).** A call
starts only while the run has `SUMMARY_CALL_ALLOWANCE_MILLISECONDS` (five minutes) left of
`SUMMARY_RUN_BUDGET_MILLISECONDS` (fourteen, one short of the consumer's fifteen); otherwise the run is
let go as a refusal for now (A73) rather than killed mid-call with its claim held. Each answered call's
usage is committed to `token_usage_meter` in a batch of its own straight away, not in the settle, so a
run that lost its claim, threw, or was cut off still has every call it made counted; only a fault between
an answer and its own meter write loses one. The settle batches no longer carry the meter.

**A73 — A call the model will never take stops being retried, and a put-off run is not doubled (amends
A62, A63).** Nothing the binding throws tells an outage from an input the model will never take, so
`model_failure_call` records the call (from zero) at which a run was refused for now: a run refused at the
SAME call as the run before it, after every earlier call of the run was answered, fails with an Error ID —
the model is evidently up. `retry_at` records when a put-off run is due: nothing claims the run before then
(a duplicate early message is answered `not-yet-due` and retried), and a host's re-run while a retry waits
writes and sends nothing, where it used to read the released claim as stranded and start a second chain.

**A74 — The gate is read again before every call (amends A58).** Before each call after the first,
`resolveSummaryModel` is read again: a firm that switched summaries or its eligibility off mid-run is
`refused` before another word is sent, and a firm whose chosen model changed has its run started over on
the new one (released, `retry_at` now, sent again, nothing counted).

**A75 — A due date needs its day AND month in what somebody said (amends A60).** The model's quote must
fall inside ONE spoken line — what a person said, never the `HH:MM:SS Name:` before it — and contain no
clock time. It must name the date's month by name (May only capitalized; abbreviations only capitalized)
with the day as a number, or give day and month in figures that read only one way ("14/11", "2026-11-14";
"3/12" is dropped). A quoted year must be the date's year; with none, the year must be within one of the
year the summary was begun. The instruction's example is now "on 14 November 2026".

**A76 — A transcript whose document cannot be opened is not summarized (amends A57, A63).** The consumer
reads the transcript's filed document as the read routes do; trashed, held by the scan or gone, the run
fails with an Error ID and no model is asked. A host's re-run is refused 409
`meeting-summary-not-ready` on the same reading, so it cannot destroy action items the host cannot see.

**A77 — The routes' retries, and a task's title (amends A63).** Both POSTs declare a path fingerprint: the
idempotency record keeps a pointer (the summary's or the task's handle) and a retry with the same key is
answered by reading the record as it stands — `MeetingSummaryView` for a re-run, `{ taskId, actionItem }`
for Create task, with `Idempotency-Replayed: true` — where the default gate replayed the stored pointer as
the body. The "already a task" check moved inside the effect so it cannot pre-empt the retry of the very
request that made the task. A task's title is cut between characters, never inside a surrogate pair.
`assignToOwner` stays true by default (owner decision): the web panel confirms the assignee before it
asks.

**A78 — A task made of an action item can be deleted (amends A61).** `meeting_summary_action_item.task_id`
keeps its enforced reference, and the task subsystem's own delete composes the meetings package's
`clearActionItemTaskStatement` into its batch before the delete, so the item stops naming the task and
reads again as one nobody has made a task of. `@magna-carta/tasks` now depends on `@magna-carta/meetings`
for that one statement; nothing in the meetings package depends on tasks, so there is no cycle.

**A79 — Nothing a firm can reach switches meetings on (amends A67).** No route or screen writes
`meetings.recordingEnabled`, `meetings.captionsEnabled` or `meetings.summariesEnabled`; there is no generic
firm-settings path, and each feature's settings have their own route (`firm-ai-settings.ts`,
`scan-policy.ts`, …). Until a meetings settings surface is built, every summary in production is refused
`disabled`, and recording answers `meeting-recording-not-configured`. Building that surface is not done
here.

**A80 — Provider facts, verified and not (2026-10-03).** Verified: the gpt-oss-120b facts and licence
above; the Llama 4 policy's European Union exclusion for multimodal models (with its exception for end
users of a product that incorporates one); Workers AI's data-usage terms. Not verified: Cloudflare's own
page for gpt-oss-120b states no licence (the licence rests on the publisher's pages); the model's output
schema is published as an untyped object, so which shape the binding returns for a `messages` request is
read defensively (`response` string or object, `choices`, a Responses `output`) rather than known; whether
the reasoning the model does is counted inside `max_tokens` is not published, so the answer room allows
for it; whether a JSON-mode request to this model honours `response_format` exactly as the schema says is
not confirmed against a live call; Claude's one-million-token context through the AI binding may need a
header the binding cannot send (unreachable for an English transcript within five parts).

### Amendments from slice R4 — live captions

Recorded 2026-10-03, as the server half of live captions was built. No migration: nothing about a
caption is stored. Each names the section it amends and says what changed and why.

**A81 — The caption feed is a sibling Durable Object, not a fork in the recorder (§6.2 step 5, §10, §16
R4).** `MeetingCaptioner` (`apps/api-worker/src/meetings/meeting-captioner.ts`), one per MEETING, keyed
`${firmId}:${meetingId}`, a new class with its own binding (`MEETING_CAPTIONER`) and migration tag
(`v12-meeting-captioner`) in `wrangler.jsonc`. The recorder is unchanged. Four reasons, from the
ownership and the memory arithmetic. **Ownership:** a recorder is one recording's and lives exactly as
long as it, while captions are the meeting's, run with or without a recording (§10) and outlive a
recording that stops while people talk on; captions in the recorder would have no object to live in when
nothing is recorded and would be torn down by a stop nobody meant for them. **Memory:** the recorder's
isolate is already spent by A13's arithmetic — eleven 6 MiB staging buffers against a 40 MiB reserve —
and every byte a caption session added would come out of the reserve that arithmetic promises is
untouched; the captioner holds at most eight sessions of under half a megabyte each. **Reach:** the
recorder hears at most eleven stays, and a caption has to hear whoever speaks in a room of three
hundred. **Isolation:** a caption model failing mid-meeting cannot reach the recording's buffers,
uploads or alarm from another object. The cost is §12's captions-only egress line paid on top of the
recording while both run — the speaker's audio leaves the routing service twice for the seconds they
speak, about $0.045 a meeting-hour — which amends §12's "captions add no egress on top". The binding is
typed in `caption-binding.ts` rather than on `Bindings`, so the change touched no file another stream
was editing; folding it beside `MEETING_RECORDER` is a one-line move. The class is exported from
`src/index.ts`. R4's file list therefore reads: `meeting-captioner.ts`, `caption-sink-token.ts`,
`caption-binding.ts` and `room/room-captions.ts` (new), with wiring in `meeting-room.ts`,
`room-frames.ts`, `room-hosting.ts`, `room-presence.ts`, `room-state.ts`, `room-lifecycle.ts`,
`room-media.ts` and `routes/meeting-sink.ts`; `packages/meetings/src/caption-sessions.ts` (new) holds the
arithmetic.

**A82 — The model, through the chokepoint (§10).** `InferencePort.openCaptionStream` — one streaming
operation, platform-fixed like `transcribe` (no model argument), audio fixed by the port at mono 16-bit
little-endian PCM at 48 kHz so nothing is transcoded — implemented in `packages/inference/src/gateway.ts`
and in the stub. The catalog (version 7) gains a `captioning` slot holding exactly one entry,
`@cf/deepgram/nova-3`, off the roster a firm chooses from. The gateway opens it with
`env.AI.run(model, input, { gateway, websocket: true })` and accepts the socket on the Response's
`webSocket`; every input is a STRING, because the binding carries them in the socket's address:
`encoding: "linear16"`, `sample_rate: "48000"`, `channels: "1"`, `interim_results: "true"`,
`punctuate: "true"`, `diarize: "false"` (the speaker is the track), `mip_opt_out: "true"` (the
publisher's model-improvement programme refused), and a well-formed BCP-47 `language` when given. Answers
are Deepgram's `Results` messages — the words at `channel.alternatives[0].transcript`, final when
`is_final` — and the control messages are `{"type":"KeepAlive"}` and `{"type":"CloseStream"}` as text
frames; a close waits three seconds for the model to end the stream before closing it from this side.
The sources, every one read 2026-10-03 and cited in `gateway.ts`: Cloudflare's Nova-3 model page and
Workers AI changelog (WebSocket support for `@cf/deepgram/nova-3`, 2025-08-27); the Deepgram Flux
changelog post (the binding's `websocket: true`); Cloudflare's own Agents SDK, which runs exactly this
from inside a Durable Object (`packages/agents/src/voice/workers-ai.ts`, the `Nova3Session` class); the
workerd source of the binding (`src/cloudflare/internal/ai-api.ts`); the AI Gateway realtime WebSocket
page; and Deepgram's keepalive page. **The same confidentiality settings ride the request** — caching
off, logging off, the derived firm metadata under `slot: "captioning"` — **but the binding's socket path
posts to `/run` and never to `/ai-gateway/run`**, so the gateway is not on the path at all: nothing is
cached or logged there because nothing passes through it, and the firm metadata is not a gateway spend
dimension for captions. The confidentiality of the audio rests on the Workers AI data terms the catalog
entry cites. **Not confirmed against a live call:** that the service accepts the gateway options beside
`websocket: true` (the Agents SDK sends none), and that `channels` and `mip_opt_out` are honoured on the
socket transport; a refusal answers `upstream`, which the captioner degrades to no captions. The stub
answers every run of audio with an interim naming the bytes heard in the stretch and makes a stretch
final at one second of audio (`STUB_CAPTION_FINAL_EVERY_BYTES`), with no clock.

**A83 — When a session opens and closes (§10).** The room tells the captioner when somebody's
`speaking` MOVES — `relayPresence` now answers that beside its deadline, read from the stored record, so
the frame a room of three hundred sends most costs captions nothing unless it says something new and
then one storage read while captions are off — and the captioner is told in the background, so a
presence frame never waits on it. A host's mute and a departure (`releaseParticipant`) tell it too. A
start opens a SESSION for that stay: a routing-service WebSocket adapter on their microphone, dialling the
captioner back through the sink route on a signed caption token, and the model's stream, opened
together; audio that arrives while the stream opens is held, at most two seconds, oldest dropped first. A
stop starts the count: three seconds later the captioner's alarm closes the session — adapter closed,
socket hung up, the model asked to finish so its last words still arrive as a final caption — and a start
inside the three seconds cancels it. A session whose audio socket has been gone ten seconds (twice the
routing service's redial window) closes for want of it; a stream with no audio for four seconds is sent a
keepalive. At most eight sessions are open per meeting (`CAPTION_SESSION_CEILING`) — a cost bound, not a
memory one; speakers past it are counted and not captioned. Each update carries the room's instant, and
one older than the last the captioner acted on for that stay is ignored, so a stop overtaken by a later
start on the way never closes a live session. Turning captions on opens a session for everybody already
speaking. **The first words of a turn are the cost:** presence trails speech, and the adapter and the
stream take a round trip each to open, so the opening fraction of a second of each turn may go uncaptioned;
the three-second close keeps a session open across the pauses inside a turn. The transcript, which reads
the staged audio, is unaffected.

**A84 — The frames (§7).** Room → client `caption`: `participantId` (the stay), `userId` (the member;
null on a guest's socket and for a guest speaker), `displayName` (the roster's name — a guest's is the
name typed at the door), `segmentId`, `text`, `final`, `at`. `segmentId` replaces §7's `sequence`: it is
opaque and unique per stretch of one person's speech — every interim of a stretch carries it, the final
settles it — where a counter would restart with the captioner and collide with a line a browser had
already settled. `displayName` is added so a caption is readable without a roster lookup. Client → room
`captions { enabled }`: a HOST's frame, on the spotlight's terms — captions leave nothing anybody could
later ask who did, so they are a frame and not an audited route — authorized from the stored participant
record and refused `not-host` otherwise. Whether captions are on rides the ROOM STATE as `captions: { by,
at }` (`by` the stay of the host who turned them on), ABSENT while they are off, so the room state of a
room nobody captions is byte-for-byte what it was (A9's rule) and every welcome carries it; this replaces
§7's `welcome.captions: boolean`. A new refusal, `captions-unavailable`, answers a host where the firm or
the deployment does not allow captions, socket open. **The browser half is not built:** the
frames-have-handlers fitness test lists `captions` and `caption` in an `AWAITING_THE_BROWSER` register
that only shrinks — it fails the moment the browser names either, so the entry comes off in the change
that wires the caption strip.

**A85 — Nothing is stored, and what reaches a socket is bounded (§10).** A caption passes through the
captioner's memory and the room's broadcast and is written nowhere: not in either object's storage, not
in the firm's database, not in a log line, an Error ID or a telemetry field. The test reads both objects'
storage after a caption for the words. Interims are COALESCED in the captioner — at most one per speaker
per half second (`CAPTION_INTERIM_INTERVAL_MILLISECONDS`), the latest guess kept, the earlier never sent —
and every caption spends from a room-wide budget of ten a second (`CAPTION_FRAME_BUDGET_PER_SECOND`, half
the twenty a second a browser may itself send, so captions never ask a browser to read faster than it is
allowed to write; every socket receives every caption, so a bound on the room is a bound on each socket).
An interim that finds the budget spent waits; a FINAL is never held or dropped, because nothing later
restates it. They are coalesced in the captioner rather than in the room's per-second bucket because that
bucket is a storage key, and a caption is content the room never writes. Text is put on one line, cleaned
of control, bidirectional and invisible characters, and cut at a thousand characters as a reader counts
them (`captionText`). A caption arriving at the room after a host turned captions off is dropped. The
interim's half-second window adds up to that much to §10's latency estimate.

**A86 — The gate, and the AI-processing eligibility (§10, §11). An owner decision is assumed here.**
Captions run where the firm has switched `meetings.captionsEnabled` on — read when a host turns captions
on, and again at every session the captioner opens, so a firm that switches them off mid-meeting is
honoured at the next person who speaks and every socket is told by the room state — and a host has turned
them on for the room. A recording is not required. **The firm's `inference.aiProcessingEligibility` is
NOT required**, the reading consistent with the transcript of record: the audio goes to a platform-fixed
speech model hosted on Cloudflare, exactly as the transcript's does, and the transcript runs without that
switch; the summary needs it (A68) because it sends a privileged conversation to a reasoning model to
reason over, which a speech model does not do. If the owner rules that every model a meeting's content
reaches needs the eligibility, the change is one more `readFirmSetting` beside each of the two reads above.

**A87 — Failure (§14).** A model that will not open, an adapter the routing service will not open, or a
stream that drops part-way: that speaker's session closes (only its own adapter is closed), the failure is
recorded through the standard pipeline as `meetings.captioner.*` with an Error ID and no word, the room
sends no frame and changes no state, and the speaker's next turn tries again. The recording is untouched
— it is another object and does not go through this model. A captioner that restarts has lost its
sessions; it stores the handles of the adapters it holds open (handles only) and closes them on waking,
so a restart never leaves the routing service sending audio to nobody. The sink route takes a caption
token on the recorder's address under the same secret, told apart by its `typ`
(`meeting-caption-sink`); the captioner is the authority on whether that stay's session is open and the
token its current adapter's, since no row exists for a caption session, and every refusal is the
recorder's bare 404. Captions are therefore configured exactly when recording is: until A3's owner
actions are done, `MEETING_SINK_SIGNING_KEY` is unset and a host's switch is answered
`captions-unavailable`.

**A88 — The meter.** There is no audio meter to write to: `token_usage_meter` counts tokens, and the
transcript keeps its audio milliseconds on its own row (A43, A52), which a caption does not have. The
captioner counts, in its own storage and as counts only, the milliseconds of audio it sent the model —
what the model bills, $0.0092 an audio minute over a socket — the sessions it opened, the speakers it
refused past the ceiling and the sessions that failed; its `inspect()` answers them. A firm-scoped usage
record for audio (for captions and the transcript alike) is not built.

**A89 — What is still not built.** The caption strip and the host's switch are the web half (the
`caption` frame shape above is the contract). `MeetingSummary.captionsAvailable` (§7) is not added — the
routes were not part of this change — so a host learns that captions are unavailable from the refusal. No
`meetings.captioner.*` telemetry events beyond failures, because events are declared in the telemetry
catalog, which this change did not touch. The load-profile measurement of caption latency (§15) and
translated captions remain open. The repository-wide scan in
`packages/meetings/test/no-transcript-text-escape.test.ts` now reads every module that opens the caption
stream, reads its answers, imports the caption arithmetic or names a caption's shape (amends A56, A67).

**A90 — A firm Owner switches meetings on (supersedes A79).** `GET` and `PATCH
/api/v1/firm/meetings/settings` (`apps/api-worker/src/routes/meeting-settings.ts`) read and write
`meetings.recordingEnabled`, `meetings.summariesEnabled`, `meetings.captionsEnabled` and
`meetings.recordedTrackCeiling` under a new `meetings:manageSettings` permission seeded to Owner and
Admin, with one audit row per change. The screen is Settings, Practice, Meetings. The answer also says
whether the recording service is configured on this deployment and whether the firm's AI processing is
on, so the screen can say why a switch that is on still does nothing.
