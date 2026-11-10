---
slug: a-transcript-names-a-speaker-by-their-track-not-by-diarization
status: Proposed
area: Meetings
date: 2026-10-02
summary: "Speaker attribution in a meeting transcript comes from the track name, not from diarization. The recorder stages every participant's audio as a separate track named by their stay, so the transcript consumer transcribes each participant's speaking spans on their own track and the speaker of every segment is a fact rather than a model's guess; Whisper's segmentation and Nova-3's diarize both produce numbered speakers nobody can put a name to, in a record that has to name people."
---

**A transcript names its speakers by the track they spoke on.**

**Context:** the recording design ([`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../../specs/2026-09-20-meetings-recording-and-transcription-design.md)) records each participant's audio as a separate track, because
the routing service's adapter is one adapter per track and mixes nothing.

**Decision.** Attribution is the track: the track name is the participant's stay, and the stay is a
member or a named guest. The transcript is produced per track over the spans the room's speaking
presence marks, and merged chronologically; a lost or refused track contributes a `gap` segment naming
the span rather than silence that reads as nobody speaking.

**Consequences.** Staged tracks are kept until the transcript settles, not only until the compose
does. Diarization is not used.
