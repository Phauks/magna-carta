# Meetings

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Meetings -->

- id: meetings
  name: Meetings
  scope: In-app video conferencing — a meeting started from a calendar event, media browser-to-Cloudflare Realtime SFU, signaling through a per-meeting Durable Object, attendance recorded on the event.
  status: partial
  spec: docs/specs/2026-09-18-meetings-design.md
  evidence: Slice 1 built and reviewed — packages/meetings, apps/api-worker/src/meetings, apps/api-worker/src/http/routes/communications/meetings.ts, apps/web/src/lib/meetings, apps/web/src/routes/(app)/meetings (the Meetings page and the room), and a Communications group in the sidebar; guests, recording, dial-in and larger rooms are ahead.
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
  evidence: apps/api-worker/src/http/routes/communications/meetings.ts; the two keys in packages/access-control/src/registry.ts.

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
  scope: Server-side capture of a meeting into the matter file, through the untrusted-file pipeline into R2, behind a consent gate on the jurisdiction profile.
  status: not-started
  evidence: No code. Needs a media-processing container, which is a memory-safety consent conversation, and the jurisdiction consent machinery the call log also waits on.
  notes: Sequenced after guests; a recording of a client meeting is privileged content and gets the full pipeline, not a shortcut.

- id: meetings.large-rooms
  name: Larger rooms
  scope: Active-speaker layout, simulcast layer selection, bandwidth adaptation beyond the slice-1 cap of twelve participants.
  status: not-started
  evidence: No code; MAX_MEETING_PARTICIPANTS = 12 in packages/meetings/src/types.ts is the cap it lifts.

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
