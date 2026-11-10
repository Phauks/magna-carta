---
category: Added
audience: public
---

**The meeting switches have a writer.** `meetings.recordingEnabled`, `meetings.captionsEnabled`,
`meetings.summariesEnabled` and `meetings.recordedTrackCeiling` were read by the recording start
route, the recorder and the summary consumer and written by nothing, so every firm's recording
answered `meeting-recording-not-configured` and every summary was refused `disabled`.
`GET`/`PATCH /api/v1/firm/meetings/settings` (`routes/meeting-settings.ts`,
`firmMeetingSettings.get` / `.update`) reads and writes all four: sparse, one idempotent batch with
one `firm.meeting_settings_updated` audit row, and an empty patch writes and audits nothing. The
ceiling is refused with a 422 outside 1 to `RECORDED_TRACK_CEILING_MAXIMUM` (11, the recorder's memory
arithmetic), never clamped. The read also reports two facts it never writes:
`recordingServiceConfigured`, from the same bindings check the start route's 503 reads, and
`aiProcessingEligible`, the gate a summary needs beside its own switch.

**A fourth meetings key.** `meetings:manageSettings` gates both verbs and is seeded to Owner/Admin
alone (`20261110T000008_seed-meeting-settings-permission`): recording one meeting is a practitioner's
act on `meetings:record`, deciding that every meeting may be recorded, captioned or summarized is the
firm's.

**Settings › Practice › Meetings** renders the four on the standard settings page over the shared
server-backed draft, through the generated client. The ceiling's row is composed from the read's
maximum, and a typed value outside it is refused at the Save button.

## Public

**Turn on recording, summaries and captions for your firm's meetings.** A new page in **Settings**,
under **Practice › Meetings**, is where a firm's owners and administrators decide whether meetings
can be recorded, whether recorded meetings are summarized, whether live captions may be shown, and
how many people one recording hears at once (up to eleven, as many voices as the recorder can hold in
memory). Every switch starts off. Each one says what it does: a recording is announced to everybody
in the meeting and its audio is added to the matter, and a summary also needs the firm's AI processing,
with a link to **AI and the Assistant** saying whether that is on. Where the platform's recording
service is not set up yet, the page says so beneath the recording switch, because no meeting can start
a recording until it is.
