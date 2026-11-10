---
category: Added
audience: public
---

**Meeting recording, the server half: the sink and the consent mechanism.** Three per-firm tables by
one additive migration — `meeting_recording`, `meeting_recording_track` and `meeting_recording_notice`
— with every stay named by kind and by value so a guest is on the record exactly as a member is, a
nullable `breakout_id` on the recording, and a new `meetings:record` key seeded to the seats that hold
`meetings:host`. Four routes in `routes/meetings.ts`: `POST` and `DELETE /api/v1/meetings/{id}/recording`
to start and stop, `GET .../recordings` to list, and `GET .../recordings/{recordingId}/notices` for the
consent record. Stopping is the key or a live grant on the meeting, labelled `host`. Ending a meeting
stops its recording in the end's own batch. `MeetingSummary` gains `recordingState`,
`recordingConfigured` and `captionsAvailable`.

**The announcement is the consent mechanism, with a record.** The room broadcasts a `recording` frame
to every welcomed socket, guests included and never the lobby, the instant a start or stop commits; a
socket welcomed while a recording runs is told on its welcome; and the room writes a notice row for
every stay it told, one batch per fan-out with one audit row carrying the count. The room is told
before any audio is captured.

**The sink.** A `MeetingRecorder` Durable Object per recording receives each audio track from the media
routing service's WebSocket adapter, decodes the envelope with a hand-written reader, folds it to mono,
writes silence for frames that never arrived, and stages it in the firm's own bucket in uniform 8 MiB
parts. It reconciles against the room every few seconds — admitting late tracks, refusing past the
firm's track ceiling with a `lost` row, closing tracks of people who left — and stops itself when every
track is lost. The routing service dials `/internal/meeting-audio/<token>`, outside the chokepoint,
on a signed per-track token, refusing any request that carries an Origin. Recording stays off — the
start route answers 503 `meeting-recording-not-configured` — until a firm switches it on and the
deployment holds `MEETING_SINK_SIGNING_KEY`, which waits on proving the routing service keeps the sink
address intact. Composing and filing the recording are the next slice.

## Public

**Record a meeting, and everybody is told.** Where your firm has turned recording on, a member who may
record can press Record in a meeting on a matter. Everybody in the room — guests included — is told the
moment it starts, and anybody who joins while it runs is told as they arrive; the firm keeps a record
of who was told and when. Stopping it is announced the same way.
