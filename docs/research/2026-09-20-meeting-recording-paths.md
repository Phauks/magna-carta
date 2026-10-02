# Meeting recording, transcription and captions — what Cloudflare actually offers

**Read on 2026-09-20.** Every fact below carries the page it came from and the date it was read.
Anything not stated on a Cloudflare page is marked **unconfirmed** and is treated as unknown by the
design, never as a working assumption.

**Why this exists:** the meetings ledger nodes `meetings.recording`, `meetings.transcription` and
`meetings.summary` were all blocked on the same unanswered question — can a meeting's media get out
of the Cloudflare Realtime SFU into something Cloudflare runs, without a media-processing container
and therefore without a C/C++ consent conversation under golden rule 14. The answer is **yes for
audio and no for video**, and the rest of this note is the evidence.

Design that consumes it:
[`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../specs/2026-09-20-meetings-recording-and-transcription-design.md).

---

## 1. The headline answers

| Question                                                          | Answer                                                                                      | Source |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| Does the Realtime SFU record?                                     | **No.** No recording product, endpoint or adapter is documented on the SFU.                 | §2     |
| Can a session's audio get out of the SFU into a Worker?           | **Yes** — the WebSocket adapter converts an Opus track to PCM and dials a `wss://` endpoint | §3     |
| Can a session's video get out?                                    | **Only as ~1 FPS JPEG frames.** No encoded video egress.                                    | §3     |
| Can the SFU publish into Stream Live over WHIP?                   | **No such path is documented** in either product.                                           | §4     |
| Does Stream record a WHIP-ingested live stream?                   | **No.** Recording is explicitly unsupported for WHIP inputs.                                | §4     |
| Does Stream record an RTMPS/SRT live stream?                      | **Yes, automatically** — but nothing in our stack speaks RTMPS or SRT.                      | §4     |
| Is there a managed speech-to-text on Cloudflare?                  | **Yes** — Whisper (batch) and Deepgram Nova-3 / Flux (streaming), both on Workers AI.       | §5     |
| Does Cloudflare offer captions?                                   | **Yes**, in two unrelated places: Stream's AI captions, and RealtimeKit's live captions.    | §6     |
| Is there a fully managed meeting recorder anywhere on Cloudflare? | **Yes — RealtimeKit**, which is a different application layer from the raw SFU.             | §7     |

---

## 2. Cloudflare Realtime — the product split

<https://developers.cloudflare.com/realtime/> (read 2026-09-20) documents three products:

- **RealtimeKit** — "a set of SDKs and APIs that lets you add customizable live video and voice to
  web or mobile applications" (<https://developers.cloudflare.com/realtime/realtimekit/>).
- **Realtime SFU** — "routes WebRTC audio, video, and DataChannels between application endpoints"
  (<https://developers.cloudflare.com/realtime/sfu/>). This is what our meetings are built on.
- **TURN service** — a relay for WebRTC traffic (<https://developers.cloudflare.com/realtime/turn/>).

The Realtime landing page documents **no recording capability, no WHIP/WHEP, and no PCM-over-WebSocket
path at the top level** — the audio-out path lives one level down, under the SFU's media transport
adapters (§3).

**SFU pricing** (<https://developers.cloudflare.com/realtime/sfu/pricing/>, read 2026-09-20):

- "Cloudflare Realtime SFU and TURN services cost **$0.05 per GB of data egress**."
- "There is a free tier of **1,000 GB** before any charges start" — shared across SFU and TURN, not
  a separate quota per product.
- For the SFU, "only traffic originating from Cloudflare towards clients incurs charges"; ingress is
  free.
- "Traffic between Cloudflare Realtime TURN and Cloudflare Realtime SFU or Cloudflare Stream
  (WHIP/WHEP) does not get double charged."

---

## 3. The WebSocket adapter — the path that exists

<https://developers.cloudflare.com/realtime/sfu/media-transport-adapters/websocket-adapter/>
(read 2026-09-20), and the index at
<https://developers.cloudflare.com/realtime/sfu/media-transport-adapters/>.

**The adapter is the only media transport adapter documented.** There is no WHIP, WHEP, RTMP, SRT,
HLS or recording adapter on the SFU. The index describes the one that exists as: "Stream audio and
video between WebRTC tracks and WebSocket endpoints. Video is egress-only and is converted to JPEG."

### API

- Create: `POST /v1/apps/{appId}/adapters/websocket/new`
- Close: `POST /v1/apps/{appId}/adapters/websocket/close`

Egress (SFU → our endpoint) request body, per the page:

```json
{
  "tracks": [
    {
      "location": "remote",
      "sessionId": "string",
      "trackName": "string",
      "endpoint": "wss://...",
      "outputCodec": "pcm"
    }
  ]
}
```

Ingest (our endpoint → SFU) uses `"location": "local"`, `"inputCodec": "pcm"` and a `"mode"` field
(`"buffer"` is the documented value). Both return
`{ "tracks": [{ "trackName", "adapterId", "sessionId", "endpoint" }] }`; close takes
`{ "tracks": [{ "adapterId" }] }`.

### Media formats

- **Audio: 16-bit signed little-endian PCM, 48 kHz, stereo.** Maximum **32 KB per WebSocket message**.
- **Video: JPEG images at approximately 1 FPS**, egress only, "beta; not configurable". Accepted
  WebRTC video inputs are H264, H265, VP8, VP9 — but what comes out is still JPEG stills.
- Framing is **Protocol Buffers** with `sequenceNumber`, `timestamp` and `payload`. Buffer mode
  (ingest) uses the payload field only; stream mode (egress) carries the timing metadata, one frame
  per message.

### Direction and multiplicity

"Each adapter instance handles only one direction" and the page's semantics are **one adapter per
track**. Two-way needs two adapters. **No mixing or compositing is offered** — an N-person meeting is
N adapters and N sockets, and anything that combines them is ours to write.

### Resilience

"The SFU automatically retries the same WebSocket endpoint for up to **5 seconds**" after a
disconnect. Audio keeps "a short bounded backlog"; video keeps only the latest JPEG frame so a
reconnect never replays stale pictures. Confirmed independently by the changelog entry
<https://developers.cloudflare.com/changelog/post/2026-05-29-websocket-adapter-auto-reconnect/>
(auto-reconnect and buffering, dated 2026-05-29).

### Pricing

"Currently free during beta." Post-launch: **$0.05 per GB egress for Cloudflare-to-WebSocket
traffic only**, inside the same **1,000 GB monthly free tier**.

### Limits and gaps

- "Beta status: API may change in future releases."
- Max 32 KB per message. Concurrent-adapter caps: "Limits follow standard Cloudflare Realtime
  quotas. Contact support for specific requirements" — **no number is published**.
- **Authentication of the endpoint the SFU dials is unconfirmed.** The page says only "Secure
  WebSocket endpoints with authentication" and documents no header, token or query-parameter
  mechanism. Whether the SFU forwards query parameters on the `endpoint` URL verbatim is
  **unconfirmed** and must be proved by experiment before the sink is trusted.
- **Whether `outputCodec` accepts anything other than `pcm` (e.g. `opus`) is unconfirmed.** This is
  the single largest cost lever in the design: PCM at 48 kHz stereo is 192 kB/s, roughly 48× a
  32 kbps Opus stream. Worth asking Cloudflare directly.
- Whether the adapter upmixes a mono microphone track to the documented stereo, or emits true
  stereo, is **unconfirmed** — the design treats the output as two channels and downmixes.

### The blog that frames the path

<https://blog.cloudflare.com/cloudflare-realtime-voice-ai/> ("Cloudflare is the best place to build
realtime voice agents", published **2025-08-29**, read 2026-09-20). It describes the SFU converting
"WebRTC audio in Opus codec to PCM" and streaming it "to any WebSocket endpoint you specify", and
gives Cloudflare's own conversational latency budget: **40 ms microphone input, 300 ms transcription,
400 ms LLM inference, 150 ms text-to-speech**, inside an 800 ms conversational threshold. The 300 ms
transcription figure is Cloudflare's, not ours, and is the basis of the caption-latency estimate in
the design.

---

## 4. Cloudflare Stream — WHIP, recording and pricing

### WHIP/WHEP

<https://developers.cloudflare.com/stream/webrtc-beta/> (read 2026-09-20): Stream supports **WHIP
ingest** (the live input's `webRTC.url`) and **WHEP playback** (`webRTCPlayback.url`), with "less
than 500 milliseconds of latency".

The limitations are decisive for us:

- "**Recording and live HLS playback are not yet supported**" for WHIP inputs, and "WHIP and WHEP
  must be used together."
- No simulcasting via RTMP/SRT, no live viewer counts, no broadcast/player metrics.

**There is therefore no WHIP-to-recording path.** The Stream pricing page states the same fact from
the billing side (below).

### Automatic recording of live streams

<https://developers.cloudflare.com/stream/stream-live/> (read 2026-09-20): a live input is fed over
**RTMPS or SRT**, and "**All Stream Live videos are automatically recorded. There is no additional
cost for encoding and packaging live videos.**" "Recordings are available for live streams within 60
seconds after a live stream ends."

Nothing in our stack speaks RTMPS or SRT, and the SFU cannot produce either — reaching this path
would require our own encoder and muxer, which is the container conversation the design is trying to
avoid.

### Pricing

<https://developers.cloudflare.com/stream/pricing/> (read 2026-09-20, page last updated 2026-09-08):

- Storage: **$5 per month per 1,000 minutes** of stored video, "rounded up to the second of video
  duration, _regardless of file size_".
- Delivery: **$1 per 1,000 minutes delivered**, covering the Stream Player, HLS/DASH, WebRTC, MP4
  downloads and simulcasting. Client-cached playback is not billable.
- Ingress, encoding and bandwidth-with-delivery are free.
- Billing for WebRTC delivery **began 2026-10-15** per the page. (The page states a date later than
  the read date; recorded as printed.)
- The page confirms §4's headline from the billing side: **"Live recordings consume storage; WebRTC
  broadcasts currently do not since they cannot be recorded."**

### Can a Stream recording be pulled to R2?

Stream offers **MP4 downloads** as a billable delivery mode (per the pricing page's list of what
delivery covers), so a recording that exists in Stream can be fetched out. **Whether a Stream
recording can be delivered directly into R2 without passing through a Worker is unconfirmed.** It is
moot for us: the recording we would want never exists, because WHIP inputs are not recorded.

---

## 5. Speech-to-text on Workers AI

### Whisper (batch)

<https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/> (read 2026-09-20):

- Model id **`@cf/openai/whisper-large-v3-turbo`**, Cloudflare-hosted, batch-capable.
- Input: an `audio` parameter (required). The chunking tutorial
  (<https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-workers-ai-whisper-with-chunking/>,
  read 2026-09-20) shows it passed as a **base64-encoded string**:
  `env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: base64 })`, with optional `task`
  (`transcribe` | `translate`), `language`, `vad_filter`, `initial_prompt`, `prefix` and beam/threshold
  parameters.
- Output: `text`, `word_count`, `segments` (**WebVTT-shaped, with timing and text**), and a
  `transcription_info` object. **Word-level timestamps are not documented**; segment-level timing is.
- The tutorial splits audio into **1 MB chunks** "to overcome memory and execution time limitations".
  No hard input-size limit is published; **the practical cap is unconfirmed** and 1 MB is the
  documented working figure.
- **Pricing: $0.000513 per audio minute** on the model page; the platform pricing page
  (<https://developers.cloudflare.com/workers-ai/platform/pricing/>, read 2026-09-20) rounds it to
  **$0.0005 per audio minute / 46.63 neurons per audio minute**. Base Workers AI pricing is
  **$0.011 per 1,000 neurons** with **10,000 neurons per day free**, resetting at 00:00 UTC.

### Deepgram Nova-3 (streaming)

<https://developers.cloudflare.com/workers-ai/models/nova-3/> (read 2026-09-20):

- Model id **`@cf/deepgram/nova-3`**.
- Accepted encodings: **`linear16`**, flac, mulaw, amr-nb, amr-wb, opus, speex, g729 — `linear16` is
  exactly what the SFU adapter emits, so no transcoding stands between the two.
- **`interim_results` is "supported only for websockets"**, as are `vad_events` and
  `utterance_end_ms`. `diarize` assigns "a speaker number starting at 0"; `punctuate` adds
  punctuation and capitalization.
- **Pricing: $0.0092 per audio minute over WebSocket** (836.36 neurons/audio-minute) versus
  **$0.0052 per audio minute over HTTP** (472.73 neurons/audio-minute). Streaming costs about 1.8×
  batch.
- Languages include English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian
  and Dutch, with regional variants (`en-GB`, `fr-CA`, `pt-BR`).
- **How a Worker opens the WebSocket is unconfirmed.** The model page states WebSocket support and
  the WebSocket-only parameters, but the exact binding call or URL is not on that page;
  <https://developers.cloudflare.com/workers-ai/features/websockets/> returned **404** on
  2026-09-20. The changelog entry
  <https://developers.cloudflare.com/changelog/post/2025-08-27-partner-models/> announces the models;
  the mechanism has to be read off the current Workers AI WebSocket documentation at build time.

### Deepgram Flux (conversational streaming)

<https://developers.cloudflare.com/workers-ai/models/flux/> (read 2026-09-20), announced
<https://developers.cloudflare.com/changelog/post/2025-10-02-deepgram-flux/> (2025-10-02):

- **`@cf/deepgram/flux`**, "the first conversational speech recognition model built specifically for
  voice agents". Input is **raw signed 16-bit PCM** at configurable sample rates; output carries
  word-level detail, speech-completion confidence and **turn events**.
- **$0.0077 per audio minute over WebSocket.**
- Built for turn-taking in a two-party agent conversation, not for a multi-party meeting transcript —
  recorded here as the cheaper streaming option if turn events ever prove more useful than Nova-3's
  interim results.

### Where partner models run

<https://blog.cloudflare.com/workers-ai-partner-models/> (published **2025-08-27**, read 2026-09-20):
Cloudflare "partnered with Leonardo.Ai and Deepgram to bring their latest and greatest models to
Workers AI, **hosted on Cloudflare's infrastructure**." This is the load-bearing privilege fact: a
meeting's audio sent to `@cf/deepgram/nova-3` or `@cf/openai/whisper-large-v3-turbo` stays on
Cloudflare and never reaches a third-party frontier provider.

---

## 6. Captions

Two unrelated caption products exist, neither of which reaches an SFU meeting:

- **Stream AI captions** (<https://developers.cloudflare.com/stream/edit-videos/adding-captions/>,
  read 2026-09-20): generated with speech-to-text via
  `POST /accounts/<ACCOUNT_ID>/stream/<VIDEO_UID>/captions/<LANGUAGE_TAG>/generate`, in **WebVTT**
  only, for **12 languages** (Czech, Dutch, English, French, German, Italian, Japanese, Korean,
  Polish, Portuguese, Russian, Spanish). The video "must be in a ready state", so this applies to
  an on-demand video, not a live meeting. **Pricing for caption generation is not stated on the
  page — unconfirmed.** Whether it applies to live recordings is **not addressed on the page**.
- **RealtimeKit live captions** — see §7.

---

## 7. RealtimeKit — the managed meeting stack we are not on

<https://developers.cloudflare.com/realtime/realtimekit/> (read 2026-09-20). RealtimeKit is the
application layer above the same WebRTC infrastructure: its own **Meetings REST API**, participants
and auth tokens, UI Kit and Core SDKs, participant roles and presets, plugins and webhooks. It
advertises "Recording and custom layouts", and "Transcription and summaries" using "Cloudflare
Workers AI for real-time and post-meeting transcription".

**Recording** (<https://developers.cloudflare.com/realtime/realtimekit/recording-guide/>, read
2026-09-20):

- **Composite recording** combines multiple participants' audio and video into one file, produced by
  "anonymous virtual bot users who join your meeting, record it, and then upload it". Video codecs:
  **H.264 and VP8**.
- **Track recording**
  (<https://developers.cloudflare.com/realtime/realtimekit/recording-guide/track-recording/>, read
  2026-09-20; changelog
  <https://developers.cloudflare.com/changelog/post/2026-05-28-realtimekit-track-recording/>,
  2026-05-28): **one WebM file per recorded participant**, started with `POST /recordings/track` and
  a meeting id. **"Only `audio` layers are recorded. Video track recording is in development."**
  Files land in "RealtimeKit's managed R2 bucket with zero-egress fees"; **download URLs expire after
  seven days**.
- Retention is **seven days** before deletion; maximum recording length **24 hours**, configurable
  down via `max_seconds`.
- Recordings can be transferred to Cloudflare R2, AWS S3, Azure, DigitalOcean or GCS
  (<https://developers.cloudflare.com/realtime/realtimekit/recording-guide/custom-cloud-storage/>).
- Every documented call is keyed by a **RealtimeKit meeting id**. **Nothing on these pages says
  recording can be pointed at a raw Realtime SFU session, and nothing says it cannot — unconfirmed,
  but the API shape makes it very unlikely.**

**Transcription** (<https://developers.cloudflare.com/realtime/realtimekit/ai/transcription/>, read
2026-09-20; GA changelog
<https://developers.cloudflare.com/changelog/post/2026-06-08-realtimekit-post-meeting-transcription-ga/>,
2026-06-08):

- **Real-time** captions use **Deepgram Nova-3**, enabled with `permissions.transcription_enabled`
  on a participant preset, streaming interim and final updates to the client SDK.
- **Post-meeting** transcripts use **Whisper Large v3 Turbo**, enabled with `transcribe_on_end`, and
  "processes each participant's audio separately" for speaker identification. Output in **CSV, JSON,
  SRT and VTT** with speaker attribution, timestamps and participant metadata. Available for **7
  days**.
- **`summarize_on_end: true`** generates a summary once the transcript is available.
- Cost is "standard model pricing via Workers AI".

**Pricing** (<https://developers.cloudflare.com/realtime/realtimekit/pricing/>, read 2026-09-20, page
last updated 2026-09-03):

- Audio/video participant **$0.002 / minute**; audio-only participant **$0.0005 / minute**.
- Export (recording, RTMP or HLS streaming) **$0.010 / minute**; audio-only export **$0.003 /
  minute**.
- Real-time transcription: standard Workers AI model pricing.

**What adopting it would cost us.** RealtimeKit brings its own meetings, participants, tokens, roles
and UI SDKs. Our meeting record, attendance, visibility-through-the-event authorization, the
`MeetingRoom` Durable Object, the SFU client and the whole meeting screen are built against the raw
SFU and would be replaced, and the UI would come from a vendor kit rather than
`@magna-carta/design-system`. It is the only managed path to **composite video** recording on
Cloudflare today, and that is the trade the owner would be deciding.

---

## 8. Memory-safe building blocks, if a container were ever needed

Not Cloudflare sources; recorded because golden rule 14 requires the alternative to be named before a
C/C++ dependency is proposed.

- **WebRTC in Rust.** `str0m` (<https://github.com/algesten/str0m>, <https://docs.rs/str0m/>) is a
  Sans-I/O WebRTC implementation with "no Rc, Mutex, mpsc, Arc, or other locks"; `webrtc-rs/rtc`
  (<https://github.com/webrtc-rs/rtc>, 0.3.0 announced 2026-01-04 at
  <https://webrtc.rs/blog/2026/01/04/announcing-rtc-v0.3.0.html>) is a second pure-Rust Sans-I/O
  stack. Either could subscribe to SFU tracks from a container without any C.
- **Lossless audio encoding in Rust.** `flacenc` (<https://crates.io/crates/flacenc>,
  <https://github.com/yotarok/flacenc-rs/>) is a pure-Rust FLAC encoder; `flac-io`
  (<https://github.com/elementmerc/flac-io>) advertises no unsafe code and no C dependency;
  `oxideav-flac` and `rusty_flac` are further pure-Rust implementations. Uncompressed WAV needs no
  encoder at all — it is framing over the PCM the adapter already emits.
- **The gap is video.** There is **no production-grade pure-Rust decoder or encoder for VP8, VP9,
  H.264 or H.265**. `rav1e` encodes AV1 in Rust but does not decode the codecs a browser publishes,
  and the mature decoders (libvpx, openh264, dav1d) are all C. **Compositing meeting video into a
  playable recording therefore cannot be done memory-safely today**, which is the consent question
  the design surfaces rather than answers. JPEG is the exception: the SFU's 1 FPS JPEG egress can be
  decoded and re-encoded entirely in Rust with the `image` crate the raster conversion engine already
  uses.

---

## 9. What this note did not establish

Carried into the design as named unknowns, every one of them to be settled by experiment or by asking
Cloudflare before the code that depends on it is written:

1. How the SFU authenticates to the WebSocket endpoint it dials, and whether query parameters on
   `endpoint` survive.
2. Whether `outputCodec` accepts a compressed codec. A 48× egress difference rides on this.
3. The concurrent-adapter cap per Realtime application.
4. The exact Workers AI WebSocket client call for `@cf/deepgram/nova-3` (the feature page 404s).
5. Whisper's real input-size ceiling, beyond the tutorial's 1 MB working figure.
6. Whether Stream's AI caption generation is billed, and whether it reaches live recordings.
7. Whether RealtimeKit recording can be pointed at a raw SFU session (very likely not).
8. Whether a Stream recording can be delivered straight into R2.
