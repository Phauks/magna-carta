---
category: Added
audience: public
---

**Meeting recording, the server half of compose and file.** A stopped recording's staged tracks are
mixed into one mono 48 kHz WAV by a queue consumer on the new `meeting-recording-compose` queue
(`apps/api-worker/src/meetings/recording-compose-consumer.ts`): ten one-minute parts per message, each
track at its first frame's offset, summed in 32 bits and clamped once (`packages/meetings/src/pcm-mix.ts`),
the 44-byte header at the head of the first part (`packages/meetings/src/wav.ts`), about 40 MB of working
memory per invocation whatever the length or track count. The cursor is five added columns on
`meeting_recording` (migration `20261110T000102_meeting-recording-compose-cursor`). The finished recording
is filed through the upload pipeline unchanged — `initiateUpload` on the recording's matter,
`completeUploadSession`, the ingest queue — named `Meeting recording — <event title> — <start in the
event's zone>.wav`; the recording moves to `filed` with its file and version, and the staged tracks are
deleted. A sweep on the ten-minute cron (`recording-sweep.ts`) abandons a recording whose recorder has
stopped reconciling (the recorder's new `heartbeat` and `abandon`), hands a stalled compose on and fails
it with an Error ID after three attempts, and releases staged audio after seven days for a failed or
abandoned recording. `MeetingRecordingSummary` gains `failureErrorId`, and `stoppedBy` is emitted as the
actor or null. Also from the first slice: the track ceiling counts participants rather than tracks, a
guest's announcement no longer carries the recording's handle, a recording is announced once however
many requests carry its start, and ending or cancelling a meeting whose recording stopped at the same
moment no longer answers a server error.

## Public

**A recorded meeting is filed on the matter as one audio file.** When a recording stops, everybody's
audio is mixed into a single WAV file and filed among the matter's documents, named after the meeting and
the time it started, and checked like any other upload before it can be opened. A recording that cannot
be finished is marked as failed with a reference you can give to support. Recording stays switched off
until your firm turns it on.
