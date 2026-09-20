# Meetings

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Meetings -->

- id: meetings
  name: Meetings
  scope: In-app video conferencing — a meeting started from a calendar event, media browser-to-Cloudflare Realtime SFU, signaling through a per-meeting Durable Object, attendance recorded on the event.
  status: partial
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: Slice 1 built and reviewed — packages/meetings, apps/api-worker/src/meetings, apps/api-worker/src/routes/meetings.ts, apps/web/src/lib/meetings, apps/web/src/routes/(app)/meetings (the Meetings page and the room), and a Communications group in the sidebar; guests, recording, dial-in and larger rooms are ahead.
  audience: public
  public-summary: Meet your colleagues by video from the calendar, share a screen, and keep a record of who attended — without a separate conferencing subscription.
  notes: The owner's ruling of 2026-09-18 — bundled into the product so a firm runs fewer tools; a Zoom/Teams port may exist later, never as the default.

- id: meetings.record
  name: Meeting record and attendance
  scope: One meeting per calendar event (matter or firm), status scheduled/live/ended, an attendance row per join with joined and left instants, audit rows of identifiers and instants only.
  status: shipped
  surface: internal
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: packages/meetings (service, statements, validation) and the meeting + meeting_attendance tables in packages/database/src/per-firm-schema.ts.

- id: meetings.signaling
  name: Signaling room and SFU client
  scope: A MeetingRoom Durable Object per meeting brokering each browser's session with the Cloudflare Realtime SFU over hibernating WebSockets; the app secret never reaches a browser.
  status: shipped
  surface: internal
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: apps/api-worker/src/meetings/meeting-room.ts, meeting-room-protocol.ts, sfu-client.ts; MEETING_ROOM binding in apps/api-worker/wrangler.jsonc.

- id: meetings.api
  name: Meetings API
  scope: Create-or-return for an event, summary, the live/upcoming/recent list, join, leave, end, paged attendance, and the socket upgrade — under the chokepoint with meetings:host and meetings:join.
  status: shipped
  surface: internal
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: apps/api-worker/src/routes/meetings.ts; the two keys in packages/access-control/src/registry.ts.

- id: meetings.screen
  name: Meeting screen
  scope: Tile grid, microphone/camera/screen-share/leave controls, End for a host, a roster rail; Start or Join from the calendar event; the Meetings page under the sidebar's Communications group listing what is live, ahead and recently ended.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: apps/web/src/lib/meetings/meeting-client.svelte.ts, apps/web/src/routes/(app)/meetings/+page.svelte and apps/web/src/routes/(app)/meetings/[id]/.
  audience: public
  public-summary: Start a meeting from any calendar event and join it in one click.

- id: meetings.screen-share
  name: Screen sharing
  scope: A second local video track from getDisplayMedia, published to the SFU like any other track.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: shareScreen() in apps/web/src/lib/meetings/meeting-client.svelte.ts.

- id: meetings.audio-calls
  name: Audio calls
  scope: A meeting whose medium is audio alone — chosen at start, enforced by the room (video and screen tracks refused), started from the calendar as Start call, shown on the Meetings page with its own glyph.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: The medium column on meeting in packages/database/src/per-firm-schema.ts, the track-kind check in apps/api-worker/src/meetings/meeting-room.ts, and Start Call in apps/web/src/lib/meetings/meeting-entry-action.svelte.
  audience: public
  public-summary: Start a voice call from any calendar event when a camera is more than the conversation needs.

- id: meetings.guests
  name: External guests
  scope: A signed one-time join link for a Directory entity on the event (client, opposing counsel, expert) — the tokenized-link assurance tier — ahead of the portal grant model.
  status: designed
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: No code; sequenced as slice 2 in the spec. Depends on nothing in the portal, and the portal grant model will subsume the link when it lands.
  audience: public
  public-summary: Invite a client or another party to a meeting with a one-time link.

- id: meetings.recording
  name: Recording
  scope: Server-side capture of a meeting into the matter file through the untrusted-file pipeline into R2; every participant is told "Recording in progress" when it starts and on arrival, audibly and on screen, and a recording mark stays on every screen for as long as it runs.
  status: not-started
  evidence: No code. Needs a media-processing container, which is a memory-safety consent conversation.
  notes: The owner's ruling of 2026-09-20 — the announcement and the persistent indicator are the consent mechanism, on the precedent every conferencing product uses, so recording no longer waits on the jurisdiction-profile machinery. Late arrivals get the announcement too, and stopping is announced the same way.

- id: meetings.large-rooms
  name: Large rooms (300 participants)
  scope: The cap lifted to 300 — simulcast cameras, a subscription policy that pulls only the tiles shown and the people talking, roster deltas instead of full broadcasts, relayed speaking presence, a paged gallery, speaker view and pin.
  status: in-build
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: MAX_MEETING_PARTICIPANTS in packages/meetings/src/types.ts; the policy in apps/web/src/lib/meetings/subscription-policy.ts; roster-delta and presence frames in apps/api-worker/src/meetings/meeting-room-protocol.ts; stream docs/active-work/claude/focused-edison-ylxfiy.md.
  audience: public
  public-summary: Hold a meeting of up to three hundred people, with the gallery showing who is talking.
  notes: The owner's target of 2026-09-20 is the capacity Zoom sells on its Business tier.

- id: meetings.host-controls
  name: Host controls
  scope: Mute one or all, remove a participant, lock the room, hand hosting to a co-host, spotlight a participant for everyone.
  status: designed
  spec: docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md
  evidence: No code; the room has one host act today (End) and no per-participant act.
  audience: public
  public-summary: Run a large meeting from the front — mute the room, remove a participant, spotlight the speaker.

- id: meetings.waiting-room
  name: Waiting room
  scope: Arrivals held in a lobby until a host admits them, one by one or all; the door for external guests and late joiners. One lobby per meeting, because a firm holds several meetings at once.
  status: designed
  spec: docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md
  evidence: No code; join admits anyone the event admits. Sequenced with external guests, whose door it is.
  notes: The owner's ruling of 2026-09-20 — meetings run concurrently, so the lobby belongs to the meeting, never to the firm.

- id: meetings.reactions
  name: Raise hand and reactions
  scope: A raised hand the host sees in order, and a small closed set of reactions, relayed as presence rather than stored.
  status: not-started
  evidence: No code; the presence frame large rooms add carries speaking and muted only.

- id: meetings.chat
  name: In-meeting chat
  scope: Text between participants during a meeting, kept on the record as the meeting's first stored content — filed under the event with the attendance.
  status: not-started
  evidence: No code.
  notes: The owner's ruling of 2026-09-20 — chat is kept on the record. The meeting therefore stores content for the first time, which means the chat rows carry the same redaction, retention and PII treatment as a filed email, and the audit row still carries identifiers only.

- id: meetings.breakout-rooms
  name: Breakout rooms
  scope: A host splits the room into smaller rooms and brings them back; each is a room of its own under the same meeting.
  status: not-started
  evidence: No code; one meeting is one room.

- id: meetings.polls
  name: Polls and questions
  scope: A host asks the room a question and sees the answers; a question queue the host works through.
  status: not-started
  evidence: No code.

- id: meetings.whiteboard
  name: Whiteboard and annotation
  scope: A shared drawing surface, and annotation over a shared screen.
  status: not-started
  evidence: No code; a collaborative surface is a second subsystem, sequenced last among the in-meeting tools.

- id: meetings.transcription
  name: Live captions and transcript
  scope: Captions during the meeting and a transcript afterwards, in the meeting's language and translated, behind the same consent gate as recording.
  status: not-started
  evidence: No code; the audio never reaches a Worker today. Needs an audio leg from the routing service to a speech model.
  notes: Sequenced with recording, under the same announcement-and-indicator consent mechanism the owner ruled for recording on 2026-09-20 — captions are announced as recording is.

- id: meetings.summary
  name: Meeting summary
  scope: A summary and action items after a meeting, filed to the event, produced by Magnus from the transcript.
  status: not-started
  evidence: No code; depends on meetings.transcription.

- id: meetings.backgrounds-and-noise
  name: Backgrounds and noise suppression
  scope: A blurred or replaced background and microphone noise suppression, both in the browser.
  status: not-started
  evidence: No code; both run on the local track before it is published, in TypeScript or Rust-to-WASM, never a native library.

- id: meetings.webinars
  name: Webinars
  scope: A meeting where a few present and many watch — registration, view-only attendees, a panel — for a firm's seminars and client briefings.
  status: not-started
  evidence: No code; every participant can publish today.

- id: meetings.live-streaming
  name: Live streaming
  scope: A meeting broadcast to a streaming destination.
  status: not-started
  evidence: No code.

- id: meetings.scheduling
  name: Scheduling
  scope: A member schedules a meeting or call from the product — picks the people (members and Directory contacts), the time and the medium, and the event and its meeting are created with invitations sent; availability read from the calendar; confirmation and reminders.
  status: not-started
  evidence: No code; the calendar's event form and the intake desk's consultation scheduling are the seams.
  notes: High priority by the owner's direction of 2026-09-20 — sequenced directly behind host controls and the waiting room. Staff schedule as well as clients (2026-09-20).

- id: meetings.scheduling.booking-pages
  name: Booking pages
  scope: A member's booking page a client picks a time on, creating the event and its meeting or call the same way a member's own scheduling does.
  status: not-started
  evidence: No code.

- id: meetings.personal-room
  name: A member's standing room
  scope: A room a member always has, joined by a stable link, not tied to a calendar event.
  status: not-started
  evidence: No code.
  awaiting-owner: Does a standing room fit a record that hangs every meeting from a calendar event, or does every meeting stay an event so the matter file stays complete?

- id: meetings.end-to-end-encryption
  name: End-to-end encryption
  scope: Media the routing service cannot read — keys agreed between browsers, frames encrypted before they leave.
  status: not-started
  evidence: No code; media is encrypted hop by hop today (DTLS-SRTP to and from the routing service). Insertable streams and a key exchange are the mechanism; recording and transcription cannot coexist with it.

- id: meetings.usage-reporting
  name: Meetings usage and quality
  scope: How much the firm meets, by member and matter, and how the connections held up — in Reports and Firm Usage.
  status: not-started
  evidence: No code; attendance rows exist, no report reads them.

- id: meetings.dial-in
  name: Dial-in by phone
  scope: A PSTN leg into a meeting through the telephony port.
  status: not-started
  evidence: No code; blocked on the communications layer's voice port, which has no adapter yet.

- id: meetings.external-provider-port
  name: Conferencing port (Zoom, Teams)
  scope: A ConferencingPort under packages/integrations whose adapter places a vendor's meeting link on a calendar event, for firms that keep a vendor.
  status: not-started
  evidence: No code; no port defined. Optional by the owner's 2026-09-18 ruling — the built-in meeting is the default.
