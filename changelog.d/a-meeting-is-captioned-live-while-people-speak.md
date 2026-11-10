---
category: Added
audience: internal
---

**Live captions, server half.** A host turns captions on for the room with a `captions` frame
(refused `captions-unavailable` where the firm's `meetings.captionsEnabled` is off or the deployment
cannot route meeting audio, `not-host` to anybody not running the meeting), and the room state carries
`captions: { by, at }` to every socket and every welcome, absent while off. A new Durable Object,
`MeetingCaptioner` (one per meeting, binding `MEETING_CAPTIONER`, migration tag
`v12-meeting-captioner`), opens a caption session for somebody only while the room's `speaking`
presence says they are talking — a routing-service adapter on their microphone dialling back through
the existing sink address on a caption token of its own `typ`, and a stream to `@cf/deepgram/nova-3`
through the new `InferencePort.openCaptionStream` (the catalog's `captioning` slot, platform-fixed,
off the firm roster; `websocket: true` on the AI binding) — and closes it three seconds after they
stop. No recording is needed. Interim and final words reach every welcomed socket as `caption` frames
naming the speaker (a guest's copy carries no firm identifier), interims coalesced to one per speaker
per half second inside a room-wide budget of ten a second, finals never held. Nothing a caption says is
stored anywhere. A caption model that fails mid-meeting closes that speaker's session and touches the
recording not at all. The AI-processing eligibility is not asked, as for the transcript of record — an
owner decision assumed and recorded in the recording design (A86). Captions are configured exactly
when recording is, so they wait on the same sink experiment and signing key. The caption strip is the
web half.
