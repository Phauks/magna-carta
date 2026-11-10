---
category: Fixed
audience: internal
---

**Meeting transcripts: an outage is outlasted, the read follows the filed document, and the words are
kept out of every log by a scan.** From the adversarial review of the transcript's server half.

- A speech model that refuses for now no longer fails a transcript after about thirty seconds: each
  refusal is counted on the row (`meeting_transcript.model_failures`, reset by progress) and the window
  is sent again after a delay doubling from thirty seconds to fifteen minutes, ten in a row before it
  fails (`apps/api-worker/src/meetings/transcript-consumer.ts`). A failure a retry could get past — the
  model, or the sweep's stall — keeps the per-speaker staged audio for the seven-day retention a failed
  compose's has; only a refusal no retry can change releases it at once.
- `GET /api/v1/meetings/{meetingId}/recordings/{recordingId}/transcript` serves lines only while the
  transcript's filed WebVTT version exists, is not trashed and is not held by the scan, and answers
  `linesWithheld` (`removed`, `held`, `unavailable`) otherwise; it is now audited, one
  `meetings.transcript.read` row of identifiers per page of lines.
- Failures are guarded on the upload session they read and, for the sweep, on what it judged stalled; a
  redelivery that meets a live lease is retried when it runs out; a lost speaker whose audio is missing
  is said not to have been heard from their first frame; a track whose staging vanishes part-way is
  refused; ingest hand-ons are best effort after the filing.
- The model's answer: a segment past the piece it was sent is dropped; the language is taken from the
  first piece of eight seconds or more and sent as the hint after; audio sent is counted in
  milliseconds (`transcribed_milliseconds`, migration
  `20261110T000105_meeting-transcript-model-failures-and-milliseconds`). The recorder's own digital
  silence no longer drags the noise floor down, and the WebVTT document strips bidirectional and
  invisible characters with the filed audio name's own set.
- `packages/meetings/test/no-transcript-text-escape.test.ts` is the repo-wide fitness scan keeping
  transcript text, speaker names and the model's prompt out of loggers, audit builders and errors.
  Amendments A45 to A56 in the recording spec.
