---
slug: the-announcement-and-the-mark-are-the-consent-mechanism-and-the-server-records-who-was-told
status: Proposed
area: Meetings
date: 2026-10-02
summary: "The owner's ruling of 2026-09-20 made the announcement and the persistent indicator the consent mechanism for meeting recording, so they are built as a mechanism with a record. The room broadcasts a `recording` frame (started or stopped) to every welcomed socket — guests included, never the lobby — the instant the route commits the transition; a socket welcomed while a recording runs is told on its welcome in the same vocabulary; and for every stay the frame was delivered to the room writes a meeting_recording_notice row (start, arrival or stop) naming the stay by kind and by value, in one batch per fan-out with one audit row carrying the count. Start and stop are routes, never frames. The room announces before any adapter is opened, so nobody's voice is captured before they were told."
---

**The announcement and the mark are the consent mechanism, and the record is what the server
announced to whom.**

**Context:** the owner ruled on 2026-09-20 that "Recording in progress" — to everybody at the start and
to every late arrival, audibly and on screen, with a mark for as long as it runs — is the consent
mechanism, and that recording no longer waits on the jurisdiction-profile machinery. The design is [`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../../specs/2026-09-20-meetings-recording-and-transcription-design.md).

**Decision.**

1. **One room frame, `recording`**, `{ state, recordingId, by, at }`, broadcast to every welcomed
   socket the instant the route has committed a start or a stop. A guest's copy names the actor by
   display name with `by.userId: null`; a stop nobody made (every track lost) carries `by: null`.
2. **The welcome carries the running recording** (`recording`, absent when nothing is recorded), so an
   arrival is told in exactly the vocabulary the room was told in.
3. **A notice row per stay per fan-out** — `meeting_recording_notice`, reason `start`, `arrival` or
   `stop` — written by the room in one batch with one `meetings.recording.noticed` audit row carrying
   the count. A reconnect is another arrival and another row. The stay is named by kind and by value
   (`participant_kind` member | guest | attendee, `participant_id`, `user_id` nullable), on
   `meeting_message`'s precedent, so a guest or a phone caller is on the consent record exactly as a
   member is.
4. **Start and stop are routes, never frames**, so the authorization, the audit row and the recording
   row are at the chokepoint. **The room is told before the recorder opens anything**, and a start the
   room could not announce is failed rather than recorded.

**Consequences.** The evidence of consent is what the server delivered, independent of what any
browser rendered; the browser's tone, speech and banner are the rendering. The notices read is a host's
read.
