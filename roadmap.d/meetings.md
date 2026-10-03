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
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-20-meetings-external-guests-design.md
  evidence: Both halves built. The server half — meeting_guest_invitation and meeting_guest_stay in packages/database/src/per-firm-schema.ts (migration 20260924T182332); packages/meetings/src/guest-types.ts, guest-statements.ts, guest-service.ts and guest-removal.ts, with presence unioned over both stay tables through MEETING_STAY_TABLES in meeting-statements.ts; the chokepoint's guest lane (guestLane in apps/api-worker/src/contracts/route-meta.ts, step 0 in chokepoint/chokepoint.ts, makeGuestLane in chokepoint/ports.ts); the credentials in apps/api-worker/src/meetings/guest-token.ts over src/signed-token.ts; the four host routes and six guest routes in apps/api-worker/src/routes/meetings-guest.ts; guest sockets redacted per viewer in apps/api-worker/src/meetings/room/. Tests: test/guest-lane.test.ts, test/guest-token.test.ts, test/guest-invitation-mail.test.ts, test/meetings-guest-routes.test.ts, the guest block in test/meeting-room.test.ts, and packages/meetings/test/guests.test.ts.
  notes: The web half is the arrival page at apps/web/src/routes/join/[token]/ outside the application shell, apps/web/src/lib/meetings/guest-meeting.svelte, guest-arrival.svelte, guest-api.ts and meeting-guests-panel.svelte, the guest mark in the lobby panel, and the guest page's own crash screen; nothing yet seen in a browser. The portal grant model will subsume the link when it lands.
  audience: public
  public-summary: Invite a client or another party to a meeting with a one-time link.

- id: meetings.recording
  name: Recording
  scope: Server-side capture of a meeting into the matter file through the untrusted-file pipeline into R2; every participant is told "Recording in progress" when it starts and on arrival, audibly and on screen, and a recording mark stays on every screen for as long as it runs.
  status: partial
  surface: screen
  spec: docs/specs/2026-09-20-meetings-recording-and-transcription-design.md
  evidence: Slice R1's server half built — the meeting_recording, meeting_recording_track and meeting_recording_notice tables (stays named by kind and value, so a guest is on the consent record exactly as a member is) and the meetings:record key seeded to the hosting seats in 20261002T183316_meeting-recording-and-who-was-told; packages/meetings recording-types/recording-statements/recording-service, settings.ts (all four switches, default off) and pcm-frame.ts (the hand-written envelope reader); the MeetingRecorder Durable Object in apps/api-worker/src/meetings/meeting-recorder.ts staging each track as mono PCM in the firm's own bucket; the announcement and the notice record in apps/api-worker/src/meetings/room/room-recording.ts with the recording frame and the welcome's recording field in packages/meeting-protocol; the start, stop, list and notices routes in apps/api-worker/src/routes/meetings.ts; and the sink the routing service dials in apps/api-worker/src/routes/meeting-sink.ts. Slice R2's server half is built too — the pure mixer and WAV header in packages/meetings/src/pcm-mix.ts and wav.ts, the compose consumer on the meeting-recording-compose queue in apps/api-worker/src/meetings/recording-compose-consumer.ts (a bounded window per message, the cursor on the recording row from 20261002T223719_meeting-recording-compose-cursor, filed onto the matter through initiateUpload, completeUploadSession and the ingest queue unchanged), and the recording sweep on the ten-minute cron in apps/api-worker/src/meetings/recording-sweep.ts (a recording whose recorder stopped working is abandoned, a stalled compose is handed on and failed after three attempts, staged tracks are released after their window). The transcript's server half is built under meetings.transcription; captions and the summary are not built.
  notes: The owner's ruling of 2026-09-20 — the announcement and the persistent indicator are the consent mechanism, on the precedent every conferencing product uses, so recording no longer waits on the jurisdiction-profile machinery. Late arrivals get the announcement too, and stopping is announced the same way. Audio only — video cannot be recorded memory-safely today, and the three ways to get it are priced in the design. OWNER ACTION OUTSTANDING before recording is switched on anywhere: the design's sink experiment has not been run, because it needs the live Cloudflare Realtime application — prove the routing service's WebSocket adapter dials the endpoint with its path intact (the sink token rides the path, never a query string), confirm the envelope's field numbers (1, 2 and 5), then set MEETING_SINK_SIGNING_KEY with wrangler secret put and add the /internal/\* zone route to this Worker. Until all of that exists the start route answers 503 meeting-recording-not-configured and no Record control is offered; a firm must also switch meetings.recordingEnabled on. The first slice is built on both halves — the server half above, and the web half in apps/web/src/lib/meetings/client/recording.svelte.ts, screen/recording-mark.svelte and screen/recording-notice.svelte (the announcement by tone, voice, banner and live region; the mark on the room, guest page, Meetings list and calendar entry; Record with its confirmation; the recordings list and who was told). Composing the tracks and filing them to the matter is built on the server (slice R2: one mono WAV per recording, filed and scanned like any upload, the staged tracks kept until the recording's transcript settles, since the transcript reads them); the transcript's web half, captions and the summary are the slices still to build, in the stream at docs/active-work/claude/focused-edison-ylxfiy.md. Deploying R2 needs the meeting-recording-compose queue and its dead-letter queue created on the account.
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
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md
  evidence: Server half built — the meeting_host table with its two partial unique indexes plus meeting.locked_at and meeting_attendance.ended_reason in packages/database/src/per-firm-schema.ts, the hosting trio in packages/meetings (hosting-types/hosting-statements/hosting-service, with requireHostGrant as the one authority chokepoint), the four host frames and room-state in packages/meeting-protocol/src/frames.ts, apps/api-worker/src/meetings/room/room-hosting.ts, and apps/api-worker/src/routes/meeting-hosting.ts. The per-tile menu, the Host controls band and the spotlight's subscription band are the web half and are not built. Stream docs/active-work/claude/focused-edison-ylxfiy.md.
  audience: public
  public-summary: Run a large meeting from the front — mute the room, remove a participant, spotlight the speaker.
  notes: Open — the signaling socket outlives the session and the permission that opened it. Authority is read once at the upgrade and the socket then runs for the length of the meeting, so a session revoked elsewhere, a suspended member or a withdrawn meetings-join key changes nothing until that browser reconnects. The hosting half is already covered (a withdrawn grant binds on the next frame, because the routes rewrite the stored record); the rest wants a bounded socket lifetime or a revalidation, and the shape is an owner question recorded in the amendments of docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md.

- id: meetings.waiting-room
  name: Waiting room
  scope: Arrivals held in a lobby until a host admits them, one by one or all; the door for external guests and late joiners. One lobby per meeting, because a firm holds several meetings at once.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md
  evidence: Server half built — meeting.lobby plus meeting_attendance.waiting_from / admitted_at and their partial index in packages/database/src/per-firm-schema.ts, the lobby trio in packages/meetings (lobby-types/lobby-statements/lobby-service, with MAX_MEETING_LOBBY at the door and the room's own capacity guard moved onto the admission), the two presence predicates as single exported fragments in meeting-statements.ts, the lobby/admitted/waiting frames and the two refusal reasons in packages/meeting-protocol/src/frames.ts, the waiting: storage prefix in apps/api-worker/src/meetings/room/room-lobby.ts, and apps/api-worker/src/routes/meeting-lobby.ts. The waiting screen, the host's lobby sheet and the lobby switch at Start are the web half and are not built. Stream docs/active-work/claude/focused-edison-ylxfiy.md.
  audience: public
  public-summary: Hold arrivals in a lobby and let them in when you are ready.
  notes: The owner's ruling of 2026-09-20 — meetings run concurrently, so the lobby belongs to the meeting, never to the firm. Guests always wait regardless of the setting; the signed one-time link is its own slice and nothing here mints one.

- id: meetings.diagnostics
  name: Diagnosability
  scope: A per-meeting structured event stream through the standard telemetry pipeline correlated by firm, meeting and stay; the browser's own connection sample reported to the room and kept only as the latest; an operator's inspect call into one live room behind the platform-operator guard; and a load harness that drives three hundred fake clients against the room so the fan-out cost is a number.
  status: partial
  surface: internal
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: Both halves shipped. Browser — apps/web/src/lib/meetings/client/connection-quality.ts and client/diagnostics.svelte.ts with the marks in screen/meeting-connection.ts. Room — the meetings.room.\* event family in packages/telemetry/src/events.ts, apps/api-worker/src/meetings/room/room-diagnostics.ts wired at one call per act, the diagnostic-report frame in packages/meeting-protocol/src/frames.ts, apps/api-worker/src/meetings/room/room-inspect.ts behind apps/api-worker/src/routes/meeting-inspect.ts, and the harness in apps/api-worker/test/support/meeting-room-load.ts. Partial because nothing READS the stream yet: the operator console page over inspect, and a dashboard over the events, are the remaining halves.
  notes: The harness falsified a design claim on its first run — every deferred presence transition armed the alarm through the full reconciliation, two roster-wide reads on the frame a large room sends most, measured at 1.2 storage lists per frame against a design that claims one. Arming for the known deadline instead took the same pass to 0.4.

- id: meetings.reactions
  name: Raise hand and reactions
  scope: A raised hand the host sees in order, and a small closed set of reactions, relayed as presence rather than stored.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-20-meetings-reactions-and-polls-design.md
  evidence: Both halves built. The server half — the hand and the reaction on the wire in packages/meeting-protocol (hand and handRaisedAt on RosterParticipant, the reaction and lower-hands client frames, the reaction and reactions room frames, MEETING_REACTIONS, SIGNAL_INTERVAL_MILLISECONDS and the rate-limited refusal), the stamp and the lowering in apps/api-worker/src/meetings/room/room-presence.ts, the relay and the per-second bucket in room/room-reactions.ts, the flush on the room's own alarm in room/room-lifecycle.ts, and meetings.room.reactionsRelayed in packages/telemetry/src/events.ts. The load harness measures a whole room reacting at once at one frame per socket per second and no roster read per reaction. Nothing reaches the record: no table, no migration, no audit row and no personal-data registration. The web half — the concern in apps/web/src/lib/meetings/client/reactions.svelte.ts (a press always lands: a hand the browser paces out is owed and stated when the window passes), the control-bar menu of six in screen/meeting-reactions.svelte, the one name-to-glyph table and the rising mark in screen/meeting-reaction-mark.svelte, the large-room counts strip in screen/meeting-reaction-counts.svelte, the host's ordered queue in screen/meeting-hands-panel.svelte, and the rise recipe in packages/design-system with reduced motion keeping the dwell and dropping the travel.
  notes: Unverified in a browser: the rise animation, the hand mark on tile and roster, the counts strip and the reduced-motion fallback have only been rendered under the test DOM. A lowered hand does not tell the member who lowered it (no hands-lowered frame; hands travel on roster deltas) — an open call for the owner.

- id: meetings.chat
  name: In-meeting chat
  scope: Text between participants during a meeting, kept on the record as the meeting's first stored content — filed under the event with the attendance.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: The meeting_message table in packages/database/src/per-firm-schema.ts, the chat trio in packages/meetings (chat-service, chat-statements, chat-types, chat-validation), the three routes in apps/api-worker/src/routes/meeting-chat.ts, and the chat panel in apps/web/src/lib/meetings. The RELAY now exists beside the record — apps/api-worker/src/meetings/room/room-chat.ts broadcasts a copy of the committed row to every welcomed socket as the message and message-redacted frames, and the list route carries a redacted array so a reader that missed a frame converges on what a forward-only walk cannot reach.
  notes: The owner's ruling of 2026-09-20 — chat is kept on the record. The meeting therefore stores content for the first time, which means the chat rows carry the same redaction, retention and PII treatment as a filed email, and the audit row still carries identifiers only. The route is the record and the room stores nothing about a message; a browser that misses a frame is caught up by the read. Open — the transcript is readable by any member who can see the matter event, including one who never joined the meeting and one added to the matter afterwards; posting needs an open stay but reading inherits the event's visibility. Whether the read should narrow to the people who were in the room is an owner question recorded in the amendments of docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md.

- id: meetings.breakout-rooms
  name: Breakout rooms
  scope: A host splits the room into smaller rooms and brings them back; each is a room of its own under the same meeting.
  status: designed
  spec: docs/specs/2026-09-24-meetings-breakout-rooms-design.md
  evidence: No code; designed 2026-09-24 — each breakout is a MeetingRoom of its own keyed under the meeting, routes call only the main room which forwards, a move keeps the browser's session and closes tracks across the boundary, placement is a table closed with the stay, assignment is always a host's explicit list, chat stays one transcript carrying the breakout it was said in.
  notes: Sequenced after the guest slice lands, because both touch the stay-closing paths, the socket route and the room modules. Recording inside a breakout is deferred to the recording node with two requirements stated in the design.

- id: meetings.polls
  name: Polls and questions
  scope: A host asks the room a question and sees the answers; a question queue the host works through.
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-20-meetings-reactions-and-polls-design.md
  evidence: Both halves built. The server half — six tables in packages/database/src/per-firm-schema.ts (meeting_poll, meeting_poll_option, meeting_poll_respondent, meeting_poll_answer, meeting_question, meeting_question_upvote) by one additive per-firm migration, the poll and question trios in packages/meetings, the twelve routes in apps/api-worker/src/routes/meeting-polls.ts and meeting-questions.ts, the six room frames in packages/meeting-protocol, and the relay in apps/api-worker/src/meetings/room/room-polls.ts over the per-second bucket the reactions now share (room/room-coalescing.ts). The screen is the web half, in flight. The web half — the concern in apps/web/src/lib/meetings/client/polls.svelte.ts and questions.svelte.ts, the Polls and Q&A panels in screen/meeting-polls-panel.svelte and meeting-questions-panel.svelte opened from the control bar with count badges, the six frame handlers in client/signaling.ts, and the once-only toast on the room page. Nothing yet seen in a browser.
  notes: The meeting's second stored content after chat, so the poll question, the option labels and a question's body carry a filed message's retention, redaction and personal-data treatment, and no audit row ever carries which option was chosen. Member routes only — a guest's stay can be named on every row, and the guest lane for answering and asking is not built.

- id: meetings.whiteboard
  name: Whiteboard and annotation
  scope: A shared drawing surface, and annotation over a shared screen.
  status: designed
  spec: docs/specs/2026-09-24-meetings-whiteboard-and-annotation-design.md
  evidence: No code; designed 2026-09-24 — an append-only log of typed operations the room numbers, coordinates on a fixed board, chunked room storage under the one-list-per-frame rule, four client and three room frames inside the existing budget, filed as an SVG from a typed builder and a pure-Rust PDF page through the upload pipeline, annotation placed relative to the shared picture and composed only in each browser, a Canvas surface in the design system rather than tldraw or Excalidraw.
  awaiting-owner: Erased marks are not kept — the filed board is the board as it stands, unlike chat which keeps a redacted row; the alternative of filing the operation log too is in the design. Non-Latin text is a replacement mark in the PDF and exact in the SVG.

- id: meetings.transcription
  name: Live captions and transcript
  scope: Captions during the meeting and a transcript afterwards, in the meeting's language and translated, behind the same consent gate as recording.
  status: partial
  surface: awaiting-screen
  spec: docs/specs/2026-09-20-meetings-recording-and-transcription-design.md
  evidence: The transcript of record's server half is built — every filed recording gets one, begun in the batch that files the audio (meeting_transcript and meeting_transcript_segment in 20261003T003618_meeting-transcript) and made on the recording's own queue as a second kind of message by apps/api-worker/src/meetings/transcript-consumer.ts — each track's staged audio cut into speech spans by energy (packages/meetings/src/speech-spans.ts), downsampled behind an anti-alias filter (resample.ts), sent through InferencePort.transcribe, assembled with gap lines into reading order (transcript-assembly.ts), filed beside the audio as WebVTT (webvtt.ts) through the upload pipeline, and the staging released when it settles; the read is GET /api/v1/meetings/{meetingId}/recordings/{recordingId}/transcript. The transcript panel on the web, live captions and translation are not built.
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
  status: partial
  surface: screen
  spec: docs/specs/2026-09-20-meetings-media-effects-design.md
  evidence: Slice one built — apps/web/src/lib/meetings/client/media-effects.ts asks the browser for noise suppression, echo cancellation and gain control as plain booleans (never exact, so a device that cannot honour one is not a member with no microphone), reads back what the track reports as true, false or not reported, probes the platform's own background blur and draws no control that cannot act, and the MediaEffects seam sits between capture and publish with a pass-through stage; the remembered preference in meeting-effects-preference.svelte.ts and the Effects popover in the control bar. Slices two and three, the picture and the sound in Rust, are not started. The design sequences three slices: the browser's own capture constraints and the media-effects seam first, then a Rust-to-WASM segmentation path measured against a TypeScript-and-WebGL fallback, then nnnoiseless in an AudioWorklet. The research behind it is docs/research/2026-09-20-browser-media-effects.md.
  awaiting-owner: Asked only if both memory-safe segmentation runtimes miss the frame budget. Every off-the-shelf way of blurring a background in a browser — MediaPipe, ONNX Runtime Web, Transformers.js, the TensorFlow.js wasm backend — is C++ compiled to WebAssembly, which golden rule 14 says needs explicit consent. Do we adopt MediaPipe for background blur alone if the Rust and the TypeScript-and-WebGL paths both fall short, or ship without background blur and keep the audio effects, which need no such dependency? Media effects design, flag M1.
  notes: The noise-suppression half raises no such question: nnnoiseless is RNNoise's network in safe Rust, on the same Rust-to-WASM precedent the PDF, decryption, email and seven-zip cores already take.

- id: meetings.webinars
  name: Webinars
  scope: A meeting where a few present and many watch — registration, view-only attendees, a panel — for a firm's seminars and client briefings.
  status: designed
  spec: docs/specs/2026-09-24-meetings-webinars-and-live-streaming-design.md
  evidence: No code; designed 2026-09-24 — a meeting with a webinar child row, a panel of up to fifty in the room, attendees as a third kind of stay served by sharded audience Durable Objects of one hundred each with no roster, no chat and no reactions, registration by member, Directory entity or public registrant on a signed page behind human verification, and a new meetings:openRegistration permission for Owner and Admin.
  awaiting-owner: How a public registrant, who is deliberately not a Directory entity, is anchored for a data-erasure request — the design deletes registrant addresses thirty days after the meeting and keeps a hash; and the per-application ceiling to ask Cloudflare about before the one-thousand attendee limit moves.

- id: meetings.live-streaming
  name: Live streaming
  scope: A meeting broadcast to a streaming destination.
  status: designed
  spec: docs/specs/2026-09-24-meetings-webinars-and-live-streaming-design.md
  evidence: No code; designed 2026-09-24 — recommended only as a webinar overflow lane of up to two thousand viewers through Cloudflare Stream's WHIP ingest of one host browser's uncomposed track with the panel's audio mixed in that browser, viewers on signed WHEP links who still hold an attendance socket; third-party destinations need composition and encoding with no memory-safe path.
  awaiting-owner: Streaming to a third-party destination (RTMP or SRT) is the same decision as video recording — RealtimeKit, or a C/C++ codec in a container — and is deferred to the owner; broadcasting an ordinary meeting is not built because it would leave no record of who watched.

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
  status: shipped
  surface: screen
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: The Meeting choice in apps/web/src/lib/calendar/record-event-dialog.svelte over event-draft.ts and firm-event-draft.ts; the meeting field and its scheduling helpers in apps/api-worker/src/routes/calendar.ts; the invitation topic in packages/calendar/src/notifications.ts with the meetings.meeting.scheduled type and the named-members audience in packages/notifications; availability in apps/web/src/lib/calendar/member-availability.ts; New Meeting on apps/web/src/routes/(app)/meetings/+page.svelte.
  audience: public
  public-summary: Choose Video meeting or Audio call when you record an event, and the room is there the moment it is saved.
  notes: Firm events raise no invitation yet — notification_event.subject_kind is a SQLite CHECK with no firmEvent value, and widening it rebuilds a table notification_recipient points at. Reminders and Directory-guest invitations are the remaining halves.

- id: meetings.scheduling.booking-pages
  name: Booking pages
  scope: A member's booking page a client picks a time on, creating the event and its meeting or call the same way a member's own scheduling does.
  status: designed
  spec: docs/specs/2026-09-24-meetings-scheduling-and-booking-pages-design.md
  evidence: No code; designed 2026-09-24 — a public page at a signed address, a visitor proves their mailbox before becoming anybody, a held slot for fifteen minutes, a Directory person matched or created needing review with Keep, Merge or Discard, a firm event titled with the page heading, the slot computation as a pure function over instants, and a booking lane beside the guest lane at the chokepoint. What a visitor holds is an appointment in code, because booking already means a resource held for an event.

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
  evidence: No code; researched 2026-09-24 in docs/research/2026-09-24-meetings-end-to-end-encryption.md (research, not yet a design) — the routing service forwards SFrame-encrypted frames intact on Cloudflare's own precedent, VP8 only, keys per sender sent to each participant encrypted to that participant alone so the room relays ciphertext, replaced when anybody leaves, a cap of fifty until MLS, WebCrypto only. Recording, transcription, captions, the summary, dial-in and everything on the WebSocket adapter stop working while it is on.
  awaiting-owner: Build it as an opt-in fixed at the meeting's start after recording and dial-in exist and after the two experiments (simulcast layer switching with encrypted frames, and the key-replacement cost at fifty), or defer; whether a firm may forbid it; the honest threat model — it does not protect against a malicious deploy of our own JavaScript, and an active malicious room could swap keys unless participants compare a security code.

- id: meetings.usage-reporting
  name: Meetings usage and quality
  scope: How much the firm meets, by member and matter, and how the connections held up — in Reports and Firm Usage.
  status: designed
  spec: docs/specs/2026-09-24-meetings-usage-reporting-design.md
  evidence: No code; designed 2026-09-24 — minutes from the attendance rows as the firm's own record with no rollup table, in-room time from admission, days in the firm's default office zone with a stay split at midnight, quality from dropped-connection stays and a per-room connection tally with no person on any row and hidden under five people, the existing reports:operational key, a report at reports/meetings-usage and a Firm Usage section.
  awaiting-owner: The per-room connection tally makes the guide's sentence that nothing about a member's connection is recorded true per person but not per room; sign off on that wording change, or the tally is dropped and quality comes only from dropped connections in the attendance record.

- id: meetings.dial-in
  name: Dial-in by phone
  scope: A PSTN leg into a meeting through the telephony port.
  status: designed
  spec: docs/specs/2026-09-24-meetings-dial-in-design.md
  evidence: No code; designed 2026-09-24 — Telnyx terminates the call and streams uncompressed audio over its media WebSocket, a MeetingPhoneBridge Durable Object per call joins it to the meeting through the routing service's WebSocket adapter in both directions and mixes up to four recent speakers for the caller in TypeScript, a twelve-digit per-meeting PIN stored as a keyed hash, every caller waits at the door, a phone stay is a member or guest stay with a channel column, and a TelephonyPort in a new @magna-carta/telephony package. No container and no C/C++.
  awaiting-owner: Whose carrier account (platform-managed or per firm); whether to build the bridge now or wait for Cloudflare's own phone gateway into Realtime, which is drafted but not generally available; if the adapter goes away a container bridge needs an Opus codec, a young pure-Rust one or libopus under consent; whether a member's PIN skips the lobby when the lobby is off; local or toll-free numbers and how many per firm.

- id: meetings.external-provider-port
  name: Conferencing port (Zoom, Teams)
  scope: A ConferencingPort under packages/integrations whose adapter places a vendor's meeting link on a calendar event, for firms that keep a vendor.
  status: not-started
  evidence: No code; no port defined. Optional by the owner's 2026-09-18 ruling — the built-in meeting is the default.
