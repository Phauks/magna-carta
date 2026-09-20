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
  evidence: apps/api-worker/src/meetings/meeting-room.ts over the concern modules in apps/api-worker/src/meetings/room, the Realtime clients in apps/api-worker/src/meetings/sfu, and the wire in packages/meeting-protocol; MEETING_ROOM binding in apps/api-worker/wrangler.jsonc.

- id: meetings.structure
  name: Structure for growth
  scope: The wire as one shared package imported by the room and the browser alike, with a fitness function holding that every frame has a handler at each end; the signaling room split into concern modules under an orchestrating Durable Object; the browser client split the same way, with a media-effects stage seamed in at capture.
  status: shipped
  surface: internal
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: packages/meeting-protocol (frames, types, and the frames-have-handlers fitness function), apps/api-worker/src/meetings/room and apps/api-worker/src/meetings/sfu under the orchestrating meeting-room.ts, and apps/web/src/lib/meetings/client and apps/web/src/lib/meetings/screen; area notes in both directories.

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
  evidence: apps/web/src/lib/meetings/client/meeting-client.svelte.ts with the tiles and controls in apps/web/src/lib/meetings/screen, apps/web/src/routes/(app)/meetings/+page.svelte and apps/web/src/routes/(app)/meetings/[id]/.
  audience: public
  public-summary: Start a meeting from any calendar event and join it in one click.

- id: meetings.screen-share
  name: Screen sharing
  scope: A second local video track from getDisplayMedia, published to the SFU like any other track.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: shareScreen() in apps/web/src/lib/meetings/client/meeting-client.svelte.ts, over the capture in apps/web/src/lib/meetings/client/capture.ts.

- id: meetings.audio-calls
  name: Audio calls
  scope: A meeting whose medium is audio alone — chosen at start, enforced by the room (video and screen tracks refused), started from the calendar as Start call, shown on the Meetings page with its own glyph.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: The medium column on meeting in packages/database/src/per-firm-schema.ts, the track-kind check in apps/api-worker/src/meetings/room/room-frames.ts, and Start Call in apps/web/src/lib/meetings/meeting-entry-action.svelte.
  audience: public
  public-summary: Start a voice call from any calendar event when a camera is more than the conversation needs.

- id: meetings.guests
  name: External guests
  scope: A signed one-time join link for a Directory entity on the event (client, opposing counsel, expert) — the tokenized-link assurance tier — ahead of the portal grant model.
  status: designed
  spec: docs/specs/2026-09-20-meetings-external-guests-design.md
  evidence: No code; designed 2026-09-20 — a Directory entity on the event, a signed expiring link, a narrow guest lane at the chokepoint and a guest stay of its own. Sequenced after the waiting room, whose lobby is the door; the portal grant model will subsume the link when it lands.
  audience: public
  public-summary: Invite a client or another party to a meeting with a one-time link.

- id: meetings.recording
  name: Recording
  scope: Server-side capture of a meeting into the matter file through the untrusted-file pipeline into R2; every participant is told "Recording in progress" when it starts and on arrival, audibly and on screen, and a recording mark stays on every screen for as long as it runs.
  status: designed
  spec: docs/specs/2026-09-20-meetings-recording-and-transcription-design.md
  evidence: No code. The design settles the path — the routing service's WebSocket adapter streams each audio track to a Durable Object we run, so no media-processing container and no C/C++ dependency is needed for audio.
  notes: The owner's ruling of 2026-09-20 — the announcement and the persistent indicator are the consent mechanism, on the precedent every conferencing product uses, so recording no longer waits on the jurisdiction-profile machinery. Late arrivals get the announcement too, and stopping is announced the same way. Audio only — video cannot be recorded memory-safely today, and the three ways to get it are priced in the design.
  awaiting-owner: Is audio alone the right record for a law firm, or is video needed — and if it is, is it worth moving meetings onto RealtimeKit to get it managed rather than taking a C/C++ codec dependency?

- id: meetings.large-rooms
  name: Large rooms (300 participants)
  scope: The cap lifted to 300 — simulcast cameras, a subscription policy that pulls only the tiles shown and the people talking, roster deltas instead of full broadcasts, relayed speaking presence, a paged gallery, speaker view and pin.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: MAX_MEETING_PARTICIPANTS in packages/meetings/src/types.ts; the policy in apps/web/src/lib/meetings/client/subscription-policy.ts; roster-delta and presence frames in packages/meeting-protocol/src/frames.ts.
  audience: public
  public-summary: Hold a meeting of up to three hundred people, with the gallery showing who is talking.
  notes: The owner's target of 2026-09-20 is the capacity Zoom sells on its Business tier.

- id: meetings.host-controls
  name: Host controls
  scope: Mute one or all, remove a participant, lock the room, hand hosting to a co-host, spotlight a participant for everyone — over a grant on the meeting rather than a permission key, so ending it needs one too.
  status: in-build
  surface: awaiting-screen
  spec: docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md
  evidence: Server half built — the meeting_host table with its two partial unique indexes plus meeting.locked_at and meeting_attendance.ended_reason in packages/database/src/per-firm-schema.ts, the hosting trio in packages/meetings (hosting-types/hosting-statements/hosting-service, with requireHostGrant as the one authority chokepoint), the four host frames and room-state in packages/meeting-protocol/src/frames.ts, apps/api-worker/src/meetings/room/room-hosting.ts, and apps/api-worker/src/routes/meeting-hosting.ts. The per-tile menu, the Host controls band and the spotlight's subscription band are the web half and are not built. Stream docs/active-work/claude/focused-edison-ylxfiy.md.
  audience: public
  public-summary: Run a large meeting from the front — mute the room, remove a participant, spotlight the speaker.

- id: meetings.waiting-room
  name: Waiting room
  scope: Arrivals held in a lobby until a host admits them, one by one or all; the door for external guests and late joiners. One lobby per meeting, because a firm holds several meetings at once.
  status: in-build
  surface: awaiting-screen
  spec: docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md
  evidence: Server half built — meeting.lobby plus meeting_attendance.waiting_from / admitted_at and their partial index in packages/database/src/per-firm-schema.ts, the lobby trio in packages/meetings (lobby-types/lobby-statements/lobby-service, with MAX_MEETING_LOBBY at the door and the room's own capacity guard moved onto the admission), the two presence predicates as single exported fragments in meeting-statements.ts, the lobby/admitted/waiting frames and the two refusal reasons in packages/meeting-protocol/src/frames.ts, the waiting: storage prefix in apps/api-worker/src/meetings/room/room-lobby.ts, and apps/api-worker/src/routes/meeting-lobby.ts. The waiting screen, the host's lobby sheet and the lobby switch at Start are the web half and are not built. Stream docs/active-work/claude/focused-edison-ylxfiy.md.
  audience: public
  public-summary: Hold arrivals in a lobby and let them in when you are ready.
  notes: The owner's ruling of 2026-09-20 — meetings run concurrently, so the lobby belongs to the meeting, never to the firm. Guests always wait regardless of the setting; the signed one-time link is its own slice and nothing here mints one.

- id: meetings.reactions
  name: Raise hand and reactions
  scope: A raised hand the host sees in order, and a small closed set of reactions, relayed as presence rather than stored.
  status: designed
  spec: docs/specs/2026-09-20-meetings-reactions-and-polls-design.md
  evidence: No code; designed 2026-09-20 — a hand on the presence frame and on the roster with the room stamping the instant, six named reactions drawn as Lucide glyphs, and a per-second coalescing bucket so a room of three hundred applauding costs one frame a second. Nothing reaches the record, so the slice adds no table and no personal-data registration. Sequenced after host controls, whose grant authorizes lowering the room's hands.

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
  status: designed
  spec: docs/specs/2026-09-20-meetings-reactions-and-polls-design.md
  evidence: No code; designed 2026-09-20 — four tables on chat's own terms, routes as the record with the room relaying the tallies, and an anonymous poll that splits what was chosen from who answered so the count stays honest without naming anybody. Sequenced after host controls, whose grant gates opening, closing and marking a question answered.
  notes: The meeting's second stored content after chat, so the poll question, the option labels and a question's body carry a filed message's retention, redaction and personal-data treatment, and no audit row ever carries which option was chosen.

- id: meetings.whiteboard
  name: Whiteboard and annotation
  scope: A shared drawing surface, and annotation over a shared screen.
  status: not-started
  evidence: No code; a collaborative surface is a second subsystem, sequenced last among the in-meeting tools.

- id: meetings.transcription
  name: Live captions and transcript
  scope: Captions during the meeting and a transcript afterwards, in the meeting's language and translated, behind the same consent gate as recording.
  status: designed
  spec: docs/specs/2026-09-20-meetings-recording-and-transcription-design.md
  evidence: No code; the audio never reaches a Worker today. The design names the audio leg — the routing service's WebSocket adapter — and the two speech models, both hosted on Cloudflare so the audio never leaves it.
  notes: Sequenced with recording, under the same announcement-and-indicator consent mechanism the owner ruled for recording on 2026-09-20 — captions are announced as recording is. Speaker attribution comes from the track name rather than diarization, so the transcript names people instead of numbering them.

- id: meetings.summary
  name: Meeting summary
  scope: A summary and action items after a meeting, filed to the event with the meeting's own visibility, written from the transcript through the one model seam the assistant uses.
  status: designed
  spec: docs/specs/2026-09-20-meetings-recording-and-transcription-design.md
  evidence: No code; depends on meetings.transcription.
  notes: Written through InferencePort rather than as an assistant conversation, so a privileged transcript is never copied into a conversation history; it runs on the on-Cloudflare model path by default and reaches a frontier model only where the firm's AI-processing eligibility allows.

- id: meetings.backgrounds-and-noise
  name: Backgrounds and noise suppression
  scope: A blurred or replaced background and microphone noise suppression, both in the browser, on the local track before it is published.
  status: designed
  spec: docs/specs/2026-09-20-meetings-media-effects-design.md
  evidence: No code. The design sequences three slices: the browser's own capture constraints and the media-effects seam first, then a Rust-to-WASM segmentation path measured against a TypeScript-and-WebGL fallback, then nnnoiseless in an AudioWorklet. The research behind it is docs/research/2026-09-20-browser-media-effects.md.
  awaiting-owner: Asked only if both memory-safe segmentation runtimes miss the frame budget. Every off-the-shelf way of blurring a background in a browser — MediaPipe, ONNX Runtime Web, Transformers.js, the TensorFlow.js wasm backend — is C++ compiled to WebAssembly, which golden rule 14 says needs explicit consent. Do we adopt MediaPipe for background blur alone if the Rust and the TypeScript-and-WebGL paths both fall short, or ship without background blur and keep the audio effects, which need no such dependency? Media effects design, flag M1.
  notes: The noise-suppression half raises no such question: nnnoiseless is RNNoise's network in safe Rust, on the same Rust-to-WASM precedent the PDF, decryption, email and seven-zip cores already take.

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
  status: partial
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: Scheduling from the calendar's own event form is in build (see the child node); booking pages are not started.
  audience: public
  public-summary: Schedule a video meeting or a call from the calendar, invite your colleagues, and see who is already busy at that hour.
  notes: High priority by the owner's direction of 2026-09-20 — sequenced directly behind host controls and the waiting room. Staff schedule as well as clients (2026-09-20).

- id: meetings.scheduling.from-the-calendar
  name: Scheduling from the event form
  scope: A Meeting choice on the one event form (None, Video meeting, Audio call) that writes the meeting row as the event is saved, invites the member participants through the notifications subsystem, reads each colleague's conflicting entries for the chosen hour, and adds New Meeting to the Meetings page.
  status: in-build
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: The Meeting choice in apps/web/src/lib/calendar/record-event-dialog.svelte over event-draft.ts and firm-event-draft.ts; the meeting field and its scheduling helpers in apps/api-worker/src/routes/calendar.ts; the invitation topic in packages/calendar/src/notifications.ts with the meetings.meeting.scheduled type and the named-members audience in packages/notifications; availability in apps/web/src/lib/calendar/member-availability.ts; New Meeting on apps/web/src/routes/(app)/meetings/+page.svelte; stream docs/active-work/claude/focused-edison-ylxfiy.md.
  audience: public
  public-summary: Choose Video meeting or Audio call when you record an event, and the room is there the moment it is saved.
  notes: Firm events raise no invitation yet — notification_event.subject_kind is a SQLite CHECK with no firmEvent value, and widening it rebuilds a table notification_recipient points at. Reminders and Directory-guest invitations are the remaining halves.

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
