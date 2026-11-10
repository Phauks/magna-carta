---
category: Added
audience: public
---

**Meeting recording, the server half of the transcript.** Every filed recording now has a transcript,
begun in the batch that files the audio (`meeting_transcript` and `meeting_transcript_segment`, migration
`20261110T000004_meeting-transcript`) and made on the existing `meeting-recording-compose` queue as a
second kind of message, so a deployment needs no new queue. The transcript reads each track's own staged
audio — the compose no longer deletes the staging when it files — finds where its speaker was talking
from the audio's energy against the track's own noise floor (`packages/meetings/src/speech-spans.ts`),
cuts each span at thirty seconds at a pause where there is one, downsamples to 16 kHz behind an
anti-alias filter (`resample.ts`) and sends each piece to the platform's speech model with the tail of
the previous piece's words as its prompt. A window is a bounded number of model calls, claimed on the
row so two deliveries never send the same audio twice. Lines are attributed to the track they came from
— a guest's to the guest's stay — merged into reading order, and a gap line says where a speaker was
lost, refused at the ceiling, or missing. The finished transcript is filed beside the audio on the same
matter as `Meeting transcript — <event title> — <start in the event's zone>.vtt` through the upload
pipeline, with each speaker's name in every cue. The staged tracks are released when the transcript
settles, ready or failed; a model that will not answer fails it with an Error ID after three deliveries,
and the recording sweep hands a stalled transcript on and fails it after three attempts so the staging
is still released. New read: `GET /api/v1/meetings/{meetingId}/recordings/{recordingId}/transcript`
(the header and cursor-paged lines), and each recording-list entry carries `transcript`.

## Public

**A recorded meeting now has a written transcript beside its audio.** Once a recording is filed, its
transcript is made from each participant's own microphone, so every line is attributed to the person who
said it, guests included, and it says plainly where somebody could not be heard. The transcript is filed
on the matter next to the recording as a captions file any media player can show. A transcript that cannot be finished is marked as failed with a reference you can
give to support; the recording itself is never affected.
