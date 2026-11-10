---
slug: a-meeting-recording-is-audio-only-and-video-is-the-owners-question
status: Proposed
area: Meetings
date: 2026-10-02
summary: "Meeting recording is audio only. Video cannot be recorded memory-safely today — Stream does not record WHIP inputs, the SFU's only video egress is roughly one JPEG a second, and every production VP8/VP9/H.264/H.265 decoder and encoder is C — so the three ways to get it are priced in the recording design and the choice is the owner's: audio only permanently, adopt RealtimeKit for meetings, or a consented, network-isolated container with a C codec (recommended against)."
---

**A meeting recording is the meeting's audio, and video is a question for the owner.**

**Context:** [`docs/research/2026-09-20-meeting-recording-paths.md`](../../research/2026-09-20-meeting-recording-paths.md) establishes that the SFU's only video egress is approximately one JPEG frame a second,
that Stream does not record a WHIP input, and that there is no production-grade pure-Rust decoder or
encoder for any codec a browser publishes. The design is [`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../../specs/2026-09-20-meetings-recording-and-transcription-design.md).

**Decision.** The recording slices build audio only. Three ways to video are priced and none is built:
(1) audio only, permanently — what ships; (2) adopt RealtimeKit for meetings, the only managed
composite-video recorder on Cloudflare, at the cost of replacing the meeting stack; (3) a container
subscribing with a pure-Rust WebRTC stack and decoding with a C/C++ codec — explicit owner consent under
golden rule 14, on the clamd precedent, and recommended against unless the second is also refused.

**Consequences.** The `meetings.recording` ledger node carries the question as `awaiting-owner`. A
one-frame-a-second visual record decoded and re-encoded with the pure-Rust `image` crate is recorded as
an option and not proposed.
