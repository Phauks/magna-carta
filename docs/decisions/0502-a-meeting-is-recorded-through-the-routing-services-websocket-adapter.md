---
number: 502
slug: a-meeting-is-recorded-through-the-routing-services-websocket-adapter
status: Proposed
date: 2026-10-02
area: Meetings
summary: "A meeting's audio is recorded by having the Cloudflare Realtime SFU's WebSocket adapter stream each audio track, as 16-bit PCM, into a Durable Object we run (MeetingRecorder, one per recording); each track is staged as mono PCM in the firm's own R2 bucket, composed into one WAV off the hot path, and filed into the matter through the untrusted-file pipeline. Rejected with evidence: Stream Live over WHIP (Stream does not record WHIP inputs), RTMPS/SRT into Stream Live (nothing in the stack speaks it without a C codec), RealtimeKit's managed recording (a different application layer that replaces the meeting stack), and a recording container (unnecessary for audio, and no pure-Rust video codec exists). The sink the SFU dials is authenticated by a short-lived HMAC token per track carried in the address path, refusing any Origin; whether the SFU preserves that path is an owner experiment outstanding before recording is switched on."
---

**A meeting's audio leaves the routing service through its WebSocket adapter into a Durable Object
we run, and nothing else.**

**Context:** the meetings ledger's recording, transcription and summary nodes were all blocked on one
question — can a meeting's media get out of the Realtime SFU into something Cloudflare runs without a
media-processing container and therefore without a C/C++ consent conversation under golden rule 14.
The evidence is [`docs/research/2026-09-20-meeting-recording-paths.md`](../research/2026-09-20-meeting-recording-paths.md); the design is [`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../specs/2026-09-20-meetings-recording-and-transcription-design.md).

**Decision.** The SFU's WebSocket adapter — the only media transport adapter it documents — converts
each audio track to 16-bit little-endian PCM at 48 kHz and dials a `wss://` address we name. A
`MeetingRecorder` Durable Object per recording (keyed `firmId:recordingId`, non-hibernating, one socket
per track) receives the frames, decodes the three-field protobuf envelope with a hand-written reader
(no protobuf dependency), folds stereo to mono, writes silence for every frame the sequence numbers say
never arrived, and stages each track as a multipart upload of uniform 8 MiB parts in the firm's own
bucket. A queue consumer composes the tracks into one WAV off the hot path and files it into the matter
through the same `initiateUpload` / `completeUploadSession` / `files-ingest` path every uploaded
document takes, so the recording is scanned, hashed and status-gated like any other file.

**The sink's authentication** is invented here, because the adapter documents none: the address is
`/internal/meeting-audio/<token>`, a token on the Worker's one signed-token format with its own `typ`
and its own secret (`MEETING_SINK_SIGNING_KEY`), naming the firm, the recording and the track and
expiring with the longest recording plus a margin. The route refuses any request carrying an Origin
(the mirror of the meeting socket's foreign-origin rule), verifies the token without a database read,
and then asks the record that the recording is still running and the track still open.

**Rejected.** Stream Live over WHIP — Stream states recording is not supported for WHIP inputs.
RTMPS/SRT into Stream Live — unreachable without our own encoder and muxer, a C codec. RealtimeKit —
real, managed, and a different application layer whose meetings, participants, tokens and UI kit
replace ours. A recording container — adds operational surface for audio the adapter already decodes,
and does not help video, for which no pure-Rust decoder exists.

**Consequences.** Audio is recorded end to end with no C/C++ in our deployment. Egress is priced at the
adapter's $0.05/GB on PCM, the whole of the recording cost. **Outstanding owner action:** the
adapter's handling of the endpoint's path is unconfirmed; it must be proved against the live Realtime
application before `MEETING_SINK_SIGNING_KEY` is set, and until it is the start route answers 503
`meeting-recording-not-configured`.
