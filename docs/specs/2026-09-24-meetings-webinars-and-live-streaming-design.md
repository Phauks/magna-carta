# Meetings — webinars and live streaming, design

**Status:** Design, 2026-09-24. Three slices in this order: the webinar (panel, audience, registration by members and Directory entities, the question queue, the host's webinar controls), then the public registration page, then the broadcast lane. The second half of this document settles live streaming, and settles it narrowly.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — the meeting record, the signaling room, the routes, the screen, large rooms, the structure for growth, diagnosability and the frame budget. Nothing there is restated; where a rule of that design decides something here it is named and used.
**Beside:** [`2026-09-20-meetings-host-controls-and-waiting-room-design.md`](2026-09-20-meetings-host-controls-and-waiting-room-design.md) (the host grant, the lobby, the rule that decides which acts are routes and which are frames), [`2026-09-20-meetings-external-guests-design.md`](2026-09-20-meetings-external-guests-design.md) (the signed link, the guest lane at the chokepoint, the rule that a guest is a Directory entity), [`2026-09-20-meetings-reactions-and-polls-design.md`](2026-09-20-meetings-reactions-and-polls-design.md) (the question queue this design reuses), and [`2026-09-20-meetings-recording-and-transcription-design.md`](2026-09-20-meetings-recording-and-transcription-design.md) (the audio-only recording path, and the finding that composing video has no memory-safe path on the server today).
**Research:** [`docs/research/2026-09-20-meeting-recording-paths.md`](../research/2026-09-20-meeting-recording-paths.md) is the home of the Cloudflare facts about the WebSocket adapter, Stream's WHIP input and RealtimeKit. This design re-read four pages on 2026-09-24 and cites them where it relies on them (section 4 and section 16).
**White paper:** _Communications layer_; _Client portal_ (the `PortalGrant` model the attendee link is deliberately smaller than); _Authentication, access control & encryption_; _Performance & concurrency model_.
**Ledger:** the `meetings.webinars` and `meetings.live-streaming` nodes in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md). This document edits neither; section 21 says what the implementing stream moves them to.

## 1. What this settles

A webinar is a meeting where a few present and many watch: a firm's seminar on a change in the law, a client briefing to forty people at the client, an internal training for every associate in the firm. A meeting today is a room where everybody may publish, everybody sees the roster, and the ceiling is three hundred. None of those three is right for a webinar, and the design changes all three without rebuilding the room.

Fourteen decisions carry the design.

1. **A webinar is a meeting with a `meeting_webinar` row.** The format is chosen when the meeting is opened and never changes, for the reason the medium never changes. The row's existence is the whole of the format; there is no second column saying the same thing.
2. **The room is the panel.** In a webinar, the existing `MeetingRoom` holds only the people who present — the host, co-hosts, named panelists and any guest invited by the guests design's link. Its ceiling in a webinar is `MAX_WEBINAR_PANELISTS = 50`, passed to the same guarded admission the room already has.
3. **An attendee is a third kind of stay in a table of its own**, `meeting_webinar_attendance`, and never a row in `meeting_attendance`. `meeting_attendance` is not touched at all: not a column, not a CHECK.
4. **Every attendee holds a registration.** A registration is how the record says who was expected, and it is the one thing an attendee's link is minted against. There are three kinds: a firm member, a Directory entity, and a public registrant.
5. **A public registrant is not a Directory entity, and that is the one place this design departs from the guests design's rule — deliberately and narrowly.** The guests design requires a Directory entity because a guest speaks into a firm's conversation. A public registrant publishes nothing, is never admitted to the room, cannot be promoted into it, and is admitted only to webinars on **firm** events, never matter events. Putting five hundred seminar attendees into the Directory would put five hundred people who are party to nothing into the conflicts corpus, which is exactly why the calendar's `external` participant kind exists. Section 6 draws the line and names the personal-data question it leaves for the owner.
6. **An attendee publishes nothing, structurally.** An attendee's socket speaks a separate audience protocol whose client union has no `publish`, no `presence`, no reaction and no host frame. A publish from an attendee is not refused by a rule; it does not parse.
7. **Attendees are served by sharded audience objects, not by the room.** A new Durable Object, `MeetingAudience`, holds at most `AUDIENCE_SHARD_CAPACITY = 100` attendee sockets and brokers their subscriptions to the panel's tracks. The room tells each shard what the panel is publishing (the **stage**); the shards fan it out. Section 4 is the arithmetic that forces this.
8. **The attendee ceiling is `MAX_WEBINAR_ATTENDEES = 1,000` on the realtime lane**, a starting value measured by the load harness before it moves, and the routing service is not what binds it. With the broadcast lane (section 16) a further `MAX_WEBINAR_BROADCAST_ATTENDEES = 2,000` watch through Cloudflare Stream.
9. **No attendee sees another attendee.** No frame in the audience protocol carries an attendee, a count of attendees, or a question an attendee asked unless a host published it — and a published question carries no asker's name. The panel sees the count; a host reads the list.
10. **Attendees do not chat and do not react.** The question queue from the polls-and-questions design is the attendee's one voice, and a host decides which questions the audience sees.
11. **Being a panelist is a grant on the webinar**, `meeting_webinar_panelist`, shaped like a host grant: a row with an interval, closed and never deleted. A host grant implies it; a guest link in a webinar is a panelist invitation.
12. **The public registration page is an unauthenticated surface built on the guest lane's shape**: a signed page token refused flatly before any read, a human-verification challenge that must be configured before a page can be opened at all, a per-address throttle on the mail it sends, one answer for every address so the page cannot be used to learn who registered, and no matter identifier anywhere because it can only exist for a firm event.
13. **Live streaming to a third-party destination (a video platform's RTMP or SRT ingest) is not built and is carried to the owner**, because it needs a composed, encoded video stream, and the recording design already established that composing video has no memory-safe path on the server. It is the same question as video recording and gets the same answer.
14. **What is built is the broadcast lane: option (b), one browser publishing to a Cloudflare Stream live input over WHIP**, video uncomposed (one track — the shared screen or one camera), with one stated extension: the panel's audio mixed in that browser's own Web Audio graph. It serves the audience beyond the realtime ceiling through signed WHEP playback, and it is part of the webinar, never a way to put an ordinary meeting on a public link. Section 16 records the trade.

## 2. What it is not

- **Not a second subsystem.** A webinar is the same record, the same event, the same room for the panel, the same host grant, the same lobby for the panel's guests, the same chat for the panel, the same recording path. What is new is the audience beside the room, and the registration in front of it.
- **Not a lobby of a thousand.** The lobby is one host deciding about one named person, bounded at a hundred (`MAX_MEETING_LOBBY`). An audience is admitted by holding a registration and by the host opening the audience door, never one by one.
- **Not a way into the room.** An attendee credential cannot open the room's socket: it is a different token type, on a different chokepoint lane, addressed to a different Durable Object class. A member attendee reaches the room only through promotion (section 12), which is a host's audited act.

## 3. Schema (per-firm lineage, additive)

Four new tables for the first slice and one for the third, one hand-written migration per slice, the snapshot refreshed in the same commit, `pnpm run migration-bundles` in the same commit. **No existing table gains a column in the first two slices, and no CHECK is widened anywhere.** `meeting` is a parent table and its vocabularies grow by adding a column when they grow at all (`packages/database/CLAUDE.md`); this design does not need even that, because the format is a child row.

```
meeting_webinar                                   -- one per webinar; its existence IS the format
  id                              text pk         -- meetingWebinar_ handle
  meeting_id                      text not null -> meeting.id
  attendee_capacity               integer not null default 1000   -- CHECK between 1 and 1000
  audience_shard_count            integer not null                -- ceil(attendee_capacity / 100), fixed at creation
  questions_enabled               integer not null default 1      -- 0 | 1 (CHECK)
  audience_opened_at              text null       -- instant the practice session ended and the audience was let in
  audience_opened_by_user_id      text null -> member.user_id
  audience_locked_at              text null       -- instant the audience door was shut to new arrivals
  audience_locked_by_user_id      text null -> member.user_id
  public_page_version             integer not null default 0      -- 0: no page has ever been opened
  public_page_opened_at           text null       -- null while the page is closed
  public_page_opened_by_user_id   text null -> member.user_id
  created_at, updated_at          text not null
  UNIQUE (meeting_id)
  CHECK (audience_opened_at IS NULL) = (audience_opened_by_user_id IS NULL)
  CHECK (audience_locked_at IS NULL) = (audience_locked_by_user_id IS NULL)
  CHECK (public_page_opened_at IS NULL) = (public_page_opened_by_user_id IS NULL)
  CHECK public_page_opened_at IS NULL OR public_page_version >= 1

meeting_webinar_panelist                          -- who may present; a grant with an interval
  id                              text pk         -- meetingWebinarPanelist_ handle
  webinar_id                      text not null -> meeting_webinar.id
  user_id                         text not null -> member.user_id
  named_by_user_id                text not null -> member.user_id
  named_at                        text not null
  withdrawn_at                    text null
  withdrawn_by_user_id            text null -> member.user_id
  created_at, updated_at
  UNIQUE (webinar_id, user_id) WHERE withdrawn_at IS NULL
  CHECK (withdrawn_at IS NULL) = (withdrawn_by_user_id IS NULL)

meeting_webinar_registration                      -- who was expected
  id                              text pk         -- meetingWebinarRegistration_ handle
  webinar_id                      text not null -> meeting_webinar.id
  registrant_kind                 text not null   -- 'member' | 'entity' | 'public'  (CHECK)
  member_user_id                  text null -> member.user_id
  entity_kind                     text null       -- 'person' | 'organization'  (CHECK)
  entity_id                       text null       -- directoryPerson_/directoryOrganization_ handle, by value
  directory_email_id              text null       -- which contact point the link went to, by value
  registered_name                 text not null   -- frozen at registration: the member's, the Directory's, or what the public registrant typed
  public_organization             text null       -- what a public registrant typed, <= 120 characters
  public_email                    text null       -- a public registrant's address, <= 254 characters; nulled by the sweep
  public_email_hash               text null       -- SHA-256 of the normalized address, hex; outlives the address
  token_secret_hash               text null       -- SHA-256 of the attendee link's secret; null for a member, who uses a session
  secret_version                  integer not null default 1
  link_expires_at                 text null       -- instant; null for a member
  arrival_count                   integer not null default 0
  last_link_sent_at               text null       -- the per-address mail throttle reads this
  confirmed_at                    text null       -- a public registration is unconfirmed until its link is first spent
  registered_at                   text not null
  registered_by_user_id           text null -> member.user_id   -- the host who added it; null for a self registration
  withdrawn_at                    text null
  withdrawn_by_user_id            text null -> member.user_id   -- null with a set withdrawn_at: the registrant withdrew themselves
  address_scrubbed_at             text null
  created_at, updated_at
  CHECK the kind's shape: member => member_user_id set, entity and public columns null;
        entity => entity_kind, entity_id set, member and public columns null;
        public => public_email_hash set, member and entity columns null
  CHECK (token_secret_hash IS NULL) = (registrant_kind = 'member')
  CHECK length(registered_name) between 1 and 120
  CHECK address_scrubbed_at IS NULL OR public_email IS NULL
  UNIQUE (webinar_id, member_user_id)    WHERE member_user_id IS NOT NULL AND withdrawn_at IS NULL
  UNIQUE (webinar_id, entity_id)         WHERE entity_id IS NOT NULL AND withdrawn_at IS NULL
  UNIQUE (webinar_id, public_email_hash) WHERE public_email_hash IS NOT NULL AND withdrawn_at IS NULL
  INDEX (webinar_id, registered_at, id)

meeting_webinar_attendance                        -- an attendee's stay; the third kind of stay
  id                              text pk         -- meetingWebinarAttendance_ handle
  meeting_id                      text not null -> meeting.id
  registration_id                 text not null -> meeting_webinar_registration.id
  confirmed_name                  text not null   -- what the attendee typed at arrival, <= 80 characters
  lane                            text not null   -- 'realtime' | 'broadcast'  (CHECK)
  audience_shard                  integer not null
  joined_at                       text not null
  left_at                         text null
  ended_reason                    text null       -- 'left' | 'socket-lost' | 'removed' | 'promoted'  (CHECK)
  created_at, updated_at
  UNIQUE (registration_id) WHERE left_at IS NULL
  INDEX (meeting_id, left_at)
  INDEX (meeting_id, joined_at, id)
  CHECK (ended_reason IS NULL OR left_at IS NOT NULL)
  CHECK (left_at IS NULL OR left_at >= joined_at)
```

The third slice adds one table:

```
meeting_webinar_broadcast
  id                              text pk         -- meetingWebinarBroadcast_ handle
  webinar_id                      text not null -> meeting_webinar.id
  stream_live_input_id            text not null   -- the Stream live input's own identifier; not a credential
  started_at                      text not null
  started_by_user_id              text not null -> member.user_id
  stopped_at                      text null
  stopped_by_user_id              text null -> member.user_id   -- null with a set stopped_at: the meeting ended it
  created_at, updated_at
  UNIQUE (webinar_id) WHERE stopped_at IS NULL
```

**Why a child row and not a `format` column on `meeting`.** A column would be a second answer to "is this a webinar" beside the settings row the webinar needs anyway, and `meeting` is a parent table whose vocabularies are expensive to touch. `MeetingSummary` gains `format: 'meeting' | 'webinar'`, **derived** by a left join on `meeting_webinar` in `meeting-statements.ts` exactly as `locked` is derived from `locked_at`. No route deletes a webinar row; the format is as permanent as the medium.

**Why the attendee's stay is its own table, and why it is not in `MEETING_STAY_TABLES`.** Three reasons, the first decisive. `meeting_attendance.user_id` is NOT NULL, and a public registrant has no user id; relaxing it is the rebuild the guests design already refused. Second, the attendee is not in the room: every composer of `MEETING_STAY_TABLES` — the live count, the room's ceiling, the door's ceiling, the roster read, the lobby list — is a question about the room, and an attendee must answer none of them. Third, an attendee never waits at the door and is never admitted by a host one at a time, so the table carries neither `waiting_from` nor `admitted_at`. That last fact is also what keeps the guests design's fitness test honest: it identifies a stay table by `meeting_id`, `joined_at`, `waiting_from`, `admitted_at` and `left_at`, so it does not mistake this table for a room stay. The test is widened (section 19) so that every table carrying `meeting_id`, `joined_at` and `left_at` must appear in exactly one of two lists — `MEETING_STAY_TABLES` (the room) or the new `WEBINAR_AUDIENCE_STAY_TABLES` (the audience) — and a fourth kind of stay added without choosing fails it.

**Ending a meeting still ends it once.** `endMeeting` composes a third sibling statement, `closeAllWebinarAttendanceStatement`, into the same batch as the member and guest statements, so every stay of every kind — panelist, guest, attendee — carries one `left_at`.

**The registration is the record of who was expected; the attendance is the record of who came.** Both hang from the meeting, which hangs from the event, which is how "filed under the event" is already answered for every meeting.

**Identifiers** (`packages/identifiers`, types plus registry): `meetingWebinar`, `meetingWebinarPanelist`, `meetingWebinarRegistration`, `meetingWebinarAttendance`, and `meetingWebinarBroadcast` in the third slice.

**Personal-data registry** (`packages/data-access/src/pii-registry.ts`):

- `meeting_webinar_panelist.user_id`, `named_by_user_id`, `withdrawn_by_user_id`; `meeting_webinar.audience_opened_by_user_id`, `audience_locked_by_user_id`, `public_page_opened_by_user_id`; `meeting_webinar_registration.member_user_id`, `registered_by_user_id`, `withdrawn_by_user_id`; `meeting_webinar_broadcast.started_by_user_id`, `stopped_by_user_id` — `retain-under-matter`, on the line `meeting.created_by_user_id` already sits on.
- `meeting_webinar_registration.entity_id`, `directory_email_id`, `registered_name` for the entity kind, and `meeting_webinar_attendance.confirmed_name` — `retain-under-matter`, on the line `meeting_guest_invitation.entity_id` and `meeting_guest_stay.confirmed_name` sit on.
- `meeting_webinar_registration.public_email`, `public_organization`, and `registered_name` for the public kind — `anonymize`, subject key `self`, and the note carries the open question in section 6.3.

**Audit** (`domainAuditStatement`, identifiers and instants only, never a name, an address, a token or a question body): `meetings.webinar.created`, `.panelistNamed`, `.panelistWithdrawn`, `.registrationAdded`, `.registrationWithdrawn`, `.linkRotated`, `.publicPageOpened`, `.publicPageClosed`, `.publicPageRotated`, `.audienceOpened`, `.audienceLocked`, `.audienceUnlocked`, `.attendeeArrived`, `.attendeeLeft`, `.attendeeRemoved`, `.attendeePromoted`, `.questionPublished`, `.broadcastStarted`, `.broadcastStopped`. A public registrant's own acts (registering, confirming, arriving, withdrawing) carry a null actor, on the precedent `meetings.guest.arrived` already sets.

## 4. The ceiling, and why the room cannot serve the audience

### 4.1 What the routing service says (read 2026-09-24)

The Realtime SFU limits page (<https://developers.cloudflare.com/realtime/sfu/limits/>, last updated 2026-09-22) publishes limits **per session**: "API requests per session | 50 requests per second", "Tracks added in one API request | Up to 64", and "Tracks in a session | No fixed upper bound. Endpoint and connection capacity impose practical limits". It publishes **no** limit on concurrent sessions per application, on subscribers per track, or on participants. The pricing page (<https://developers.cloudflare.com/realtime/sfu/pricing/>, last updated 2026-09-22) is unchanged: $0.05 per GB of egress, the first 1,000 GB a month free and shared with TURN, and "Traffic between Realtime TURN and Realtime SFU or Cloudflare Stream WHIP/WHEP is not charged twice."

So the architecture's own premise holds for a webinar: an attendee is a session that pulls the panel's tracks and publishes none, and the routing service forwards whatever it is asked for. **What the routing service does not publish is an application-wide ceiling**, and the whole fleet's meetings share one Realtime application. That is a question for Cloudflare rather than for the owner, and it is asked before `MAX_WEBINAR_ATTENDEES` moves past 1,000 (section 22).

### 4.2 What binds first is ours

The Durable Objects limits page (<https://developers.cloudflare.com/durable-objects/platform/limits/>, last updated 2026-06-01) and the state API page (<https://developers.cloudflare.com/durable-objects/api/state/>) give the numbers that matter: an object is single-threaded with a **soft limit of 1,000 requests per second**; each invocation has **6 simultaneous outgoing connections**; the hibernation API allows **32,768 WebSocket connections per object**, "but the CPU and memory usage of a given workload may further limit the practical number". Sockets are not the constraint. **Calls to the routing service are.**

An attendee arriving costs three calls: open a session, add the stage's tracks as remote (one call — up to 64 tracks per request covers the whole stage), and apply the browser's answer. A change to the stage — a panelist starts sharing a screen — costs every attendee two more: add the new track, renegotiate. Taking the upstream call at an assumed 100 ms (an assumption, not a measurement) and six in flight, one object clears about sixty calls a second:

| Audience served by one object | Arrival burst (three calls each) | One stage change reaches the last attendee |
| ----------------------------- | -------------------------------- | ------------------------------------------ |
| 100                           | about 5 seconds                  | about 3 seconds                            |
| 1,000                         | about 50 seconds                 | about 33 seconds                           |

A screen share that takes half a minute to reach the back row is not a webinar. And the room would spend that minute unable to serve the panel, because it is the same single thread.

**The room has a second reason it cannot carry the audience, found in reading it for this design.** `sessionFor` in `apps/api-worker/src/meetings/room/room-media.ts` holds `blockConcurrencyWhile` across the network call that opens a routing session. That is correct for its stated purpose — two frames must not open two sessions for one participant — and it means session creation is **serialized across the whole room**: three hundred members arriving at the top of the hour open their sessions one at a time. For a room of three hundred that is a known, bounded cost; for an audience of a thousand it is the arrival queue. The shard must not copy the shape: it marks a session as being opened on the attendee's stored record inside the gate, releases the gate, makes the call, and writes the result back under the gate, so two frames from one attendee still cannot open two sessions while different attendees' calls run in parallel. Whether the room itself should adopt the same shape is recorded in section 22 rather than changed here.

### 4.3 So: shards

`MeetingAudience`, a Durable Object keyed `${firmId}:${meetingId}:${shardIndex}`, holds at most `AUDIENCE_SHARD_CAPACITY = 100` realtime attendees. A webinar of the default capacity has ten. The count is fixed on the webinar row at creation (`audience_shard_count`) so that a reconnect finds the same shard and the room knows how many to tell. The arrival statement assigns the shard with the fewest open realtime stays, ties to the lowest index, computed in the insert's own `SELECT`, so a burst of arrivals spreads evenly rather than by whoever read the counts first. With ten shards the table above becomes the first row for everybody, in parallel.

**The first number is 1,000, and the load harness is what moves it.** `apps/api-worker/test/support/meeting-audience-load.ts` drives a panel of five and an audience at the configured size against real shard objects in the test pool, and reports routing calls per arrival, per stage change, and frames per socket per second. The rows above become numbers there, not arguments.

### 4.4 What the three hundred becomes

`MAX_MEETING_PARTICIPANTS = 300` is unchanged and still means what it means: the room's ceiling. In a webinar the room is the panel, and its admission is passed `MAX_WEBINAR_PANELISTS = 50` as the capacity instead — the guarded admission statement already takes the capacity as a bound value (`?5` in `insertAttendanceUnderCapStatement`), so this is a different argument to the same statement, not a second statement. Fifty because an audience's stage draws at most nine panel tiles (section 13) and a panel of more than fifty is a meeting that should have been a meeting. The audience has its own ceilings, counted over its own table and guarded in its own insert: `MAX_WEBINAR_ATTENDEES = 1,000` on the realtime lane and `MAX_WEBINAR_BROADCAST_ATTENDEES = 2,000` on the broadcast lane. Registrations are bounded separately at `MAX_WEBINAR_REGISTRATIONS = 5,000`, because more people register for a seminar than come to it.

### 4.5 What an attendee costs

An attendee pulls the stage and nothing else: one camera at the full layer or a shared screen, up to four panel cameras at the half layer, and the audio of whoever on the panel is speaking. At an assumed 1.5 to 3 megabits a second that is 0.68 to 1.35 GB an attendee-hour — **$0.034 to $0.068 per attendee-hour past the free tier**, and a single hour of a thousand attendees (680 to 1,350 GB) is past the free tier on its own. The broadcast lane's WHEP delivery is $1 per 1,000 minutes, **$0.06 per viewer-hour**, billed from 2026-10-15 (<https://developers.cloudflare.com/stream/pricing/>, last updated 2026-09-08). The two lanes cost about the same, so cost does not choose between them; the record and the control do (section 16). Both lines go into [`docs/operating-costs.md`](../operating-costs.md) with the slice that incurs them.

## 5. Who presents: the panel

**A panelist is a grant on the webinar.** `meeting_webinar_panelist` is shaped like `meeting_host` and for the same reason: a question a firm asks of a webinar afterwards is who was presenting when, which is a question about an interval. The row is closed, never deleted.

**Who may enter the room of a webinar:** a member holding a live host grant (a host or co-host presents), a member holding a live panelist row, and a guest on a guest link (the guests design's link, unchanged — in a webinar it is how an external speaker is invited, and the guest still waits in the lobby). Everybody else who presses Join on a webinar is an attendee. The join path refuses a member with none of the three with a new refusal, `meeting-not-a-panelist` (409, "You are attending this webinar rather than presenting in it"), and the screen takes that as its cue to open the audience view rather than showing an error. The condition is also a predicate on the insert — `DOOR_ADMITS_DIRECTLY_PREDICATE` gains "the meeting is not a webinar, or the arriving member holds a live panelist row or host grant" — so a panelist withdrawn in the instant before their arrival lands does not land. The waiting insert gets the same predicate, so a member with no panelist row cannot queue at the room's door either.

**Withdrawing a panelist takes effect at their next arrival.** A panelist already in the room is not turned out by the withdrawal, on the rule the lock already follows; a host who wants somebody off the stage now uses Remove. There is no demotion to attendee (section 22 says why).

**The host grant implies presenting**, so the starter of a webinar is its first panelist without a row. A member handed hosting is a panelist for as long as the grant stands.

## 6. Who watches: registration

### 6.1 The three kinds

- **A member.** A firm member registers by joining: the audience join route writes their registration and their stay in one batch if they hold neither. A host may also register members ahead of time. No link, no secret, no mail — a member arrives through their session.
- **A Directory entity.** A host registers a person or organization from the Directory. The entity need not be on the event's participant list — a client briefing to forty people at the client names forty Directory people, and making each of them an event participant would put forty rows on a calendar entry nobody reads that way. The registration mints a personal attendee link and sends it through the `sendEmail` port to the Directory contact point, exactly as the guests design sends its invitation. This is the only kind a **matter** webinar admits besides members.
- **A public registrant.** Somebody who registered themselves on the public page (slice two). Only for a webinar on a **firm** event, and only while a host has the page open.

### 6.2 Why the public registrant is not a Directory entity

The guests design's first decision is that a guest is a Directory entity, never a free address, "so the record always names somebody the firm knows and the conflicts corpus can see". This design keeps that rule for everybody who can speak in a meeting and draws the line at speaking:

- A guest publishes audio and video into a conversation that may be privileged, chats on the record, and is admitted by a host who is looking at their name. A public registrant publishes nothing, never enters the room, does not chat, and cannot be promoted into the room by any path (promotion is for members alone, section 12).
- A webinar with a public page hangs from a firm event, so there is no matter for the registrant to be adverse to and no matter corpus they could reach. The statement that opens a page carries `meeting.event_kind = 'firm'` in its own WHERE, guarded, so this is held by the database rather than by a service check that a later caller could skip.
- The calendar already made this call once. `matter_event_participant` has an `external` kind precisely because forcing a judge or a court reporter into the Directory "would pollute the conflicts corpus with people who are party to nothing". Five hundred seminar attendees are the same case at a larger scale.

What makes the line hold is that crossing it is a deliberate act with a known cost. A host who decides a registrant belongs in the Directory — a prospective client who attended the seminar and called afterwards — uses **Add to Directory** on the registration, which opens the Directory's own create form prefilled with the registered name and address, on the guests design's precedent for an external event participant. Nothing creates a Directory entity as a side effect of registering.

### 6.3 The personal-data question this leaves open, for the owner

`packages/data-access/src/pii-registry.ts` states that a data subject resolves to one of two anchors, a Directory entity or a firm member, and that "the Directory IS the registry". A public registrant is neither. Their row holds a name, an organization and an address that the erasure orchestrator has no anchor to find. This design contains the exposure rather than resolving the anchor:

- **The address lives only as long as it is needed.** It is what the attendee link and the reminder are sent to. `WEBINAR_REGISTRANT_ADDRESS_RETENTION_DAYS = 30` after the meeting ends, a daily sweep nulls `public_email` and stamps `address_scrubbed_at`; the hash stays, so the uniqueness rule and a later "was this address registered" question still have an answer without a second copy of a stranger's address.
- **The registry entry is `anonymize`, subject key `self`.** Scrubbing the name, organization and address leaves the row, so the counts in the record stay honest.
- **The anchor is the owner's question** (section 22): whether `SubjectRef` gains a third kind for somebody who is in the firm's records without being in the Directory, or whether an erasure request from a registrant is answered by the address hash alone.

### 6.4 The attendee link

The link is the guests design's credential shape, reused: a row that holds the SHA-256 of a 256-bit secret, and a token on the shared signed-token format (`apps/api-worker/src/signed-token.ts`) with its own `typ`, `meeting-webinar-attendee-link`, carrying `{ firmId, webinarId, registrationId, secretVersion, exp, secret }`. It names the **webinar row**, never the meeting or the event, so nothing an attendee holds can be turned into a meeting identifier.

- **Lifetime.** `link_expires_at = min(mint + WEBINAR_LINK_MAX_DAYS, max(eventEndInstant, mint) + GUEST_LINK_GRACE_HOURS)`, with `WEBINAR_LINK_MAX_DAYS = 90` rather than the guest link's fourteen: people register for a seminar weeks ahead, and the reminder resends the same link rather than minting a new one. An event with no end time takes the end of its day in its own zone, the guests design's rule and its helper (`eventEndInstant` in `apps/api-worker/src/meetings/guest-invitation-mail.ts`).
- **Arrival.** Spending the link opens the attendee's stay, sets `confirmed_at` if it was unset, increments `arrival_count` (capped at `MAX_AUDIENCE_ARRIVALS = 20`) and mints an **attendance grant**, `typ: "meeting-webinar-attendance-grant"`, carrying the stay and no secret, living `min(link_expires_at, mint + 12 hours)`. A spend while a stay is open returns that stay with a fresh grant; the partial unique index on `(registration_id) WHERE left_at IS NULL` holds it under a race, and the shard's one-socket-per-stay rule (newest wins, the older refused `superseded`) does the rest.
- **The name at arrival.** The arrival page asks the attendee's name, prefilled with `registered_name`, and stores what they type as `confirmed_name` beside it. A host reading the attendee list sees both, which is what a forwarded link leaves behind — the guests design's two-names rule, for the same reason.
- **Rotation and withdrawal** are host acts with their own routes and audit rows; a withdrawn registration refuses its link at once, and an attendee on it is removed through the removal path. A **registrant may withdraw themselves** from the link's own page, which is also the unsubscribe the mail offers.
- **A removal bars the registration for the life of the meeting**, on the barred-entry rule the room already has: the arrival route refuses a registration holding a stay closed `removed`.

## 7. The chokepoint: an audience lane beside the guest lane

An attendee who is not a member holds no session, on exactly the terms a guest holds none. The guests design gave the chokepoint a step-zero lane for that; this design adds a **second, separate lane** rather than widening the first, for the reason that design gave for not widening `resolveFirmContext`: two lanes cannot be confused, and one lane with a third value can.

**`RouteMeta` gains `audienceLane?: "page" | "registration" | "attendance"`.** Registration refuses, at startup:

- a route declaring both `guestLane` and `audienceLane`;
- an `audienceLane` route that names a permission, declares `authenticated: true`, or sits on any `resource` but `"firm"`;
- `"registration"` or `"attendance"` anywhere but `surface: "app"`, and `"page"` anywhere but `surface: "public"`.

**`AudienceLanePort<FirmContext>`** asks the lane's three questions in the guest lane's order, each only if the one before answered: does the credential verify (a signature this worker made, the lane's own `typ`, not expired) — a null is the **flat refusal**, the reserved 404, answered after spending the limiter on the client address and before any read; does its firm resolve (`resolveAudienceFirmContext`, never a flag on another method); is the row it names live — the webinar row for a page (open, version current, meeting not ended), the registration row for a link or a grant (not withdrawn, version current, hash matches under a constant-time comparison, not expired, meeting not ended). A refusal at the third question is specific, because only somebody the firm sent a signed credential to can present one.

**What is stashed:** `chokepointAudienceCredential` (lane, firm, webinar, registration and stay where present), `chokepointFirmId`, `chokepointFirmContext`. Never a user id and never a permission set, so a member handler pointed at an audience route throws on its first `requireChokepointUserId`, and a guest handler throws on its first `requireChokepointGuestGrant`.

**Where the credential rides.** The `x-meeting-audience` header on an ordinary request; the `audience` query parameter on the shard socket's upgrade and nowhere else; the `x-webinar-registration-page` header for a page token. An audience credential presented to a route that did not declare the lane gets the reserved 404 before a session is looked for, as a guest credential does today.

**Rate-limit keys.** The page lane is keyed by the client address always — everybody holds the same page token, so a key on the token would be one bucket for the whole internet. The registration and attendance lanes are keyed `audience:${registrationId}`, so one forwarded link is one bucket however many people hold it.

**Buckets added** (`apps/api-worker/src/chokepoint/rate-limiter.ts`): `audience-arrival` (20 per 60 seconds, the guest arrival's numbers and reasoning) and `webinar-registration` (5 per 600 seconds). The limiter is per isolate and in memory, and its own header says so; that is why the public page does not rely on it alone (section 17).

## 8. Routes

All under the chokepoint, `resource: "firm"`, `idempotency: "required"` on every write, audited. "Host + grant" means `meetings:host` and a live grant resolved through `requireHostGrant`, the host-controls design's one authority chokepoint.

### 8.1 The members' side (`apps/api-worker/src/routes/meeting-webinar.ts`, new)

| method | path                                                                    | permission                          | does                                                                                                                                  |
| ------ | ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/meetings/{meetingId}/webinar`                                  | `meetings:join`                     | the settings, both doors, the page's state, and three counts: registered, confirmed, attending                                        |
| POST   | `/api/v1/meetings/{meetingId}/webinar/settings`                         | host + grant                        | body `{ questionsEnabled }`                                                                                                           |
| POST   | `/api/v1/meetings/{meetingId}/webinar/panelists`                        | host + grant                        | body `{ userId }`; names a panelist                                                                                                   |
| POST   | `/api/v1/meetings/{meetingId}/webinar/panelists/{userId}/withdrawal`    | host + grant                        | withdraws a panelist; takes effect at their next arrival                                                                              |
| GET    | `/api/v1/meetings/{meetingId}/webinar/registrations`                    | `meetings:host`                     | cursor-paged: kind, registered name, entity for the entity kind, confirmed, withdrawn; the address only to a caller holding the grant |
| POST   | `/api/v1/meetings/{meetingId}/webinar/registrations`                    | host + grant                        | body `{ kind: "member", userId }` or `{ kind: "entity", entityKind, entityId }`; the entity kind mints and mails a link               |
| POST   | `/api/v1/meetings/{meetingId}/webinar/registrations/{id}/rotation`      | host + grant                        | a new secret and a fresh mail                                                                                                         |
| POST   | `/api/v1/meetings/{meetingId}/webinar/registrations/{id}/withdrawal`    | host + grant                        | withdraws; an attendee on it is removed                                                                                               |
| GET    | `/api/v1/meetings/{meetingId}/webinar/attendance`                       | `meetings:host`                     | cursor-paged on `(joined_at, id)`: registration, registered and confirmed names, lane, joined, left, reason                           |
| POST   | `/api/v1/meetings/{meetingId}/webinar/audience`                         | host + grant                        | body `{ open: true }`; ends the practice session. One way only — an audience is not sent back out                                     |
| POST   | `/api/v1/meetings/{meetingId}/webinar/audience/lock`                    | host + grant                        | body `{ locked }`; the audience door, separate from the room's lock                                                                   |
| POST   | `/api/v1/meetings/{meetingId}/webinar/attendees/{attendeeId}/remove`    | host + grant                        | closes the stay `removed`, refuses the socket, bars the registration                                                                  |
| POST   | `/api/v1/meetings/{meetingId}/webinar/attendees/{attendeeId}/promotion` | host + grant                        | a member attendee only: closes the stay `promoted`, names them panelist, tells their audience socket                                  |
| POST   | `/api/v1/meetings/{meetingId}/webinar/audience/join`                    | `meetings:join`                     | a member's own attendance: writes the registration if absent and the stay; `{ attendeeId, lane, iceServers, socketUrl }`              |
| POST   | `/api/v1/meetings/{meetingId}/webinar/audience/leave`                   | `meetings:join`                     | closes the member's own attendee stay                                                                                                 |
| GET    | `/api/v1/meetings/{meetingId}/webinar/audience/socket`                  | `meetings:join`                     | WebSocket upgrade to the member's shard; requires an open attendee stay; same-origin as the room's                                    |
| POST   | `/api/v1/meetings/{meetingId}/webinar/public-page`                      | `meetings:openRegistration` + grant | body `{ open }`; opening answers with the page URL                                                                                    |
| POST   | `/api/v1/meetings/{meetingId}/webinar/public-page/rotation`             | `meetings:openRegistration` + grant | increments the page version; every earlier page URL stops verifying                                                                   |

`POST /api/v1/meetings` gains `format` (`meeting` | `webinar`, default `meeting`) beside `medium` and `lobby`, read only when the request opens the room — one meeting per event, so the first Start decides. The event form's `meeting` field gains the same `format`, so scheduling a webinar is recording an event with a medium and a format on it, as scheduling a meeting already is. A webinar is always `medium: video`; `format: webinar` with `medium: audio` is 422 `meeting-format-refused`, because an audience watching a call watches nothing.

**The public-page key is new, `meetings:openRegistration`**, seeded to Owner and Admin only. The argument is the recording design's for `meetings:record`: opening a public page is a different act with a different consequence from convening a room — it publishes a form in the firm's name that anybody on the internet can submit and that sends mail to whatever address is typed into it. Unlike `meetings:record` there is no existing behaviour to preserve, so the seed is narrow and a firm widens it.

**The registration list's address is shown only to a grant holder.** The list rides `meetings:host` so the record is readable after the meeting when no grant stands; a public registrant's address inside the retention window is narrower, because it is the one column here that is a stranger's contact point.

### 8.2 The audience lane (`apps/api-worker/src/routes/meetings-audience.ts`, new)

No meeting identifier in any path: the webinar is a fact of the credential.

| method | path                                       | lane           | does                                                                                                                       |
| ------ | ------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/audience/webinar`                 | `registration` | the reduced summary; writes nothing, spends nothing                                                                        |
| POST   | `/api/v1/audience/arrivals`                | `registration` | body `{ confirmedName }`; opens the stay, confirms, answers `{ attendeeId, lane, iceServers, attendanceGrant, playback? }` |
| POST   | `/api/v1/audience/registration/withdrawal` | `registration` | the registrant withdraws themselves; the mail's unsubscribe                                                                |
| GET    | `/api/v1/audience/socket`                  | `attendance`   | WebSocket upgrade to the stay's shard                                                                                      |
| POST   | `/api/v1/audience/departures`              | `attendance`   | closes the attendee's own stay                                                                                             |
| POST   | `/api/v1/audience/questions`               | `attendance`   | body `{ body }`; asks one                                                                                                  |
| GET    | `/api/v1/audience/questions`               | `attendance`   | the attendee's own questions and the published ones, paged on `(asked_at, id)` with `since`                                |

The reduced summary is a distinct schema, `AudienceWebinarSummary = { firmName, title, startsOn, startsAtTime, endsAtTime, timeZone, status, audienceOpen, registeredName }`, never `MeetingSummary` with fields nulled — a nulled field is a field somebody restores.

### 8.3 The public page (`apps/api-worker/src/routes/webinar-public-registration.ts`, new, slice two)

| method | path                                   | lane   | does                                                                                                   |
| ------ | -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/public/webinar-registration`  | `page` | `{ firmName, title, startsOn, startsAtTime, endsAtTime, timeZone, registrationOpen }` and nothing else |
| POST   | `/api/v1/public/webinar-registrations` | `page` | body `{ name, email, organization? }` plus the human-verification header; always 202                   |

Section 17 is the whole of how these are defended.

### 8.4 Problem types added

`meeting-not-a-panelist` (409), `meeting-format-refused` (422), `webinar-audience-full` (409), `webinar-audience-locked` (409), `webinar-registration-full` (409), `webinar-registration-closed` (409), `webinar-registrant-is-panelist` (409 — a Directory entity already holding a guest link on this meeting), `webinar-attendee-removed` (409), `webinar-public-page-needs-firm-event` (422), `webinar-public-page-not-protected` (503), `meeting-questions-disabled` (409), `audience-link-expired` (410), `audience-link-withdrawn` (410), `audience-link-rotated` (410), `audience-link-exhausted` (409). The four link refusals are one table, `apps/api-worker/src/meetings/audience-refusals.ts`, read by the lane and the routes alike — the `guest-refusals.ts` shape, so one condition says one sentence. The third slice adds `meetings-broadcast-not-configured` (503), `webinar-broadcast-already-running` (409), `webinar-broadcast-not-running` (409) and `webinar-broadcast-needs-presenter-in-room` (409).

## 9. The audience protocol

A separate protocol in the protocol package, `packages/meeting-protocol/src/audience-frames.ts`, with its own version, `MEETING_AUDIENCE_PROTOCOL_VERSION = 1`, its own client union and its own list of shard frame types. **Separate rather than added to `MeetingClientFrame`** because the point of the attendee is what it cannot send: a union that contained `publish` for the room's sake would have to be narrowed for the audience by a rule, and a rule is what a later frame forgets. The fitness function in `packages/meeting-protocol/test/frames-have-handlers.test.ts` is extended to the second protocol, naming the shard and the audience client as its two ends.

The frame ceiling, the frame budget (`FRAME_BUDGET_PER_SECOND`, `FRAME_BUDGET_BURST`) and the keepalive pair are the room's own constants, imported rather than restated.

Client to shard:

| type                | fields                                                | shard does                                                                                   |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `subscribe`         | `tracks[{ sessionId, trackName, preferredRid? }]`     | refuses a pair not on the shard's stage (`unknown-track`); `tracks/new` remote; `subscribed` |
| `renegotiate`       | `sessionDescription`                                  | `PUT renegotiate`; `renegotiated`                                                            |
| `close`             | `mids[]`                                              | `tracks/close`; `closed`                                                                     |
| `layer`             | `tracks[{ sessionId, trackName, mid, preferredRid }]` | the room's layer rule, including the check that the mid is one the shard subscribed for it   |
| `leave`             | —                                                     | releases the session, closes the socket 1000                                                 |
| `diagnostic-report` | `sample`                                              | the room's rule: one per window, dropped otherwise, last sample kept                         |
| `ping`              | —                                                     | `pong`, byte-exact                                                                           |

Shard to client:

| type                                              | fields                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `audience-welcome`                                | `attendeeId`, `stage`, `audienceState`, `recording \| null` (from the recording slice, when built) |
| `stage`                                           | the stage, whole                                                                                   |
| `stage-presence`                                  | `speaking: participantId[]`, `at` — at most once a second                                          |
| `audience-state`                                  | `open`, `locked`, `questionsEnabled`                                                               |
| `subscribed`, `renegotiated`, `closed`, `layered` | the room's shapes, through the room's builders                                                     |
| `question-published`                              | `questionId`, `body`, `publishedAt`, `answered` — never an asker                                   |
| `question-updated`                                | the caller's own question, or a published one, answered or redacted                                |
| `promoted`                                        | `at` — a member attendee was made a panelist; the browser moves to the room                        |
| `ended`                                           | `endedAt`                                                                                          |
| `refused`                                         | `reason`, `errorId?`                                                                               |
| `pong`                                            | —                                                                                                  |

**The stage is the panel as the audience may see it**: `{ panel: [{ participantId, displayName, kind, sfuSessionId, tracks[{ trackName, kind }], muted }], spotlight: participantId | null }`. No `userId` for anybody — an attendee sees names, as a guest does, and never a firm's user identifiers. No `hostRole`, no hand, no presence beyond `muted`. Sent **whole**, because the panel is at most fifty and the frame changes only when somebody on it arrives, leaves, publishes or stops; the thing that changes many times a second, who is speaking, travels separately as `stage-presence`, coalesced to one frame a second per shard.

**Refusal reasons** are the room's closed vocabulary where they mean the same thing (`frame-too-large`, `binary-unsupported`, `malformed-frame`, `unknown-frame`, `unknown-track`, `rate-limited`, `sfu-unavailable`, `not-a-participant`, `superseded`, `removed`, `meeting-ended`), declared once and imported. One is added: `audience-not-open`, sent to a subscribe that arrives before the host has ended the practice session, socket kept open.

**Room additions, additive, `MEETING_PROTOCOL_VERSION` unchanged.** One room frame, `audience { open, locked, attending, at }`, to welcomed room sockets at most once a second; `welcome` gains `audience: { open, locked, attending } | null`, null for an ordinary meeting. No client frame is added to the room: every webinar act is a route.

## 10. The shard

`apps/api-worker/src/meetings/audience/` mirrors the room's split so each concern is a module taking an explicit context, and `MeetingAudience` is an orchestrator:

- `meeting-audience.ts` — the Durable Object: accepts the upgrade, builds the context, dispatches; three RPC methods the room calls (`stageChanged(stage)`, `stagePresence(speaking, at)`, `audienceStateChanged(state)`), and five the routes call after their writes commit (`attendeeRemoved`, `attendeePromoted`, `questionPublished`, `questionUpdated`, `meetingEnded`).
- `audience-state.ts` — storage (`attendee:<stayId>`, the stage copy, the ended marker, the shard's identity) and the socket attachment (`{ firmId, meetingId, webinarId, stayId, registrationId, shardIndex, frameBudgetTokens, frameBudgetAt, welcomed }`, all server-derived).
- `audience-stage.ts` — the stage copy, the `stage` and `stage-presence` fan-out, and `namesOnlyStageTracks`, the audience's twin of `namesOnlyRosterTracks`.
- `audience-media.ts` — the attendee's routing session (opened without holding the gate across the call, section 4.2), subscribe, renegotiate, close, layer, and release.
- `audience-lifecycle.ts` — arrival and supersede, the per-person socket-loss grace (sixty seconds, the room's constant, closing the stay through the firm-scoped data-access layer with `socket-lost`), the one alarm and its deadlines, the end.
- `audience-frames.ts` — parse, budget, identify, refuse, dispatch, in the room's order.
- `audience-diagnostics.ts` — the `meetings.audience.*` family.

**A shard holds no roster of attendees to send and no frame to send one in.** It holds its own sockets' records because it has to release their sessions and time their graces; nothing it can emit carries another attendee. That is the audience's structural guarantee, on the waiting prefix's model: an attendee is not filtered out of a list, there is no list.

**The room owns the stage and the shards copy it.** `apps/api-worker/src/meetings/room/room-stage.ts` (new) projects the room's roster into the stage whenever the roster changes in a webinar, and calls every shard's `stageChanged` with bounded concurrency (`STAGE_FANOUT_CONCURRENCY = 4`, a lane width that is only the room's and stays out of the protocol package). Presence is not forwarded per transition: the room keeps a one-second stage-presence deadline on its existing alarm, like the reaction bucket, and sends each shard the speaking set when it fires. A shard that was not reachable is recorded and caught up by the next change; a shard that wakes with no stage copy asks the room once (`stageOf()`), and never more than once a second.

**The panel never learns who is watching, only how many.** Each shard reports its open realtime and broadcast counts to the room when they change, debounced to once a second (`audienceCountChanged(shardIndex, realtime, broadcast)`); the room sums them and sends `audience` to its own sockets. The number is the room's transient state, and the record's number is the attendance read.

## 11. The question queue, reused

The polls-and-questions design's `meeting_question` and `meeting_question_upvote` are the webinar's Q&A. Nothing is re-invented; three things are added, and the first must be decided before that slice's migration lands.

1. **`participant_kind` on `meeting_question` and `meeting_question_upvote` takes three values: `member`, `guest`, `attendee`.** Both tables carry the stay by value precisely so that a new kind of stay does not need a foreign key; this design is the third kind. `meeting_question` is a parent (`meeting_question_upvote` points at it), so a CHECK written with two values is a CHECK that cannot be widened afterwards. **If that migration lands with two values, the attendee's question is carried by a nullable `attendee_stay_id` column added beside the pair with a CHECK that exactly one of the two names the asker**, the parent-table rule in `packages/database/CLAUDE.md` — never a rebuild. The same applies to the poll respondent and answer tables if attendee polls are ever built (section 22).
2. **Publishing to the audience.** `meeting_question` gains `published_at` and `published_by_user_id`, added by this design's migration as two nullable columns with their pair CHECK — additive, on a parent table, which is the one kind of change a parent takes freely. A host publishes or unpublishes with `POST /api/v1/meetings/{meetingId}/questions/{questionId}/publication` body `{ published }` (host + grant, audited `meetings.webinar.questionPublished`), and the room calls every shard's `questionPublished`.
3. **An attendee asks through the audience lane** (section 8.2), which composes the same `askQuestion` service with the attendee's open stay as the asker, and the same ceiling (`MAX_MEETING_QUESTIONS = 500`). The panel sees the question through the polls design's own `question-asked` room frame, with the asker's confirmed name; an attendee's own question comes back to their socket as `question-updated` when answered.

**What an attendee sees of the queue:** their own questions, and the questions a host published — the body, whether it was answered, and **no asker's name**. That is not anonymity from the product (the row keeps the stay, the panel sees the name, the record holds both); it is the audience never seeing who else is in the audience, which is decision nine. Attendees do not upvote in this design (section 22).

`questions_enabled = 0` refuses an attendee's question with `meeting-questions-disabled` (409) and removes the control from the attendee's screen.

## 12. The host's webinar controls

Every one is a route with an audit row, by the host-controls design's rule — each is a fact somebody could later ask about. None is a frame.

- **The practice session and opening the audience.** A webinar starts closed to its audience: panelists arrive, check their sound and share screens, and attendees who arrive are held on the shard in a pre-show state — their stay is open and recorded, their socket receives `audience-welcome` with `open: false` and the stage withheld (`panel: []`), and every subscribe is refused `audience-not-open`. **Open to attendees** writes `audience_opened_at`, the room tells every shard, and each shard sends `audience-state` and then the real `stage`. One way only: an audience that has watched is not sent back out, and a host who needs a private word uses the room's chat or a breakout.
- **The audience door.** Lock and unlock refuse new attendee arrivals (`webinar-audience-locked`) and touch nobody already watching, the room's lock rule applied to the audience. It is separate from the room's lock, which still governs the panel.
- **Panelists.** Name and withdraw, section 5.
- **Remove an attendee.** Closes the stay `removed`, bars the registration, and the shard refuses the socket `removed` and closes it.
- **Promote a member attendee.** One batch: close the attendee stay `promoted`, write a panelist row. The route then calls the shard's `attendeePromoted`, which sends `promoted` and closes the socket normally; the browser joins the room through the ordinary join route, which now admits them. **Only a member can be promoted.** A Directory-entity attendee who should speak is invited as a guest panelist through the guests design's link, which sends them to the lobby where a host reads both names; a public registrant can never be promoted, which is what keeps decision five true.
- **Publish a question**, section 11.
- **Settings**: questions on or off.
- **The public page**: open, close, rotate (slice two).
- **The broadcast**: start and stop (slice three).
- **End the webinar** is End, unchanged: it closes every stay of every kind at one instant, and the room calls every shard's `meetingEnded` before it closes its own sockets.

The room's own host controls — mute, mute everybody else, ask to unmute, spotlight, remove, lock, hand over, the lobby — act on the panel exactly as they act on any room. **The spotlight is also what the audience sees first**: the stage carries it, and the audience policy puts it on the large tile.

## 13. The screens

### 13.1 An attendee's screen

The attendee page reuses the meeting client's negotiation and subscription modules and **none of its capture**: the audience client is constructed without the capture seams at all, so nothing on an attendee's page can light a camera or microphone indicator — not a rule a screen remembers, a seam that is not there.

- **The stage.** A shared screen large with up to four panel cameras in a strip beside it; with nothing shared, the spotlit panelist large and the speakers after them, up to nine tiles. A pure function, `apps/web/src/lib/meetings/audience/audience-policy.ts`, decides it from the stage and the speaking set — the full layer for the large tile, the half layer for the strip, audio for every unmuted panelist up to the gallery policy's own `MAX_AUDIO_SUBSCRIPTIONS` (twenty-four, imported from `client/subscription-policy.ts` rather than restated), and a subscribe that names the whole plan in one frame.
- **Names only.** Panel names on the tiles; no roster, no attendee count, no chat, no reactions, no raise hand, no attendees list.
- **Controls:** playback volume and mute (local, on the audio element — nothing reaches the shard), full screen, **Questions** where questions are enabled, and Leave.
- **Before the host opens it:** the title, the day and time, "The webinar will begin shortly", and Leave. No media is pulled.
- **Removed, ended, withdrawn:** the removed and ended screens in the register the guest and member pages already use, with no rejoin offered where the rejoin would be refused.
- **Questions:** a `Sheet` with a composer (the thousand-character ceiling counted down) and two lists — "Your questions" and "Answered for everyone" — never another attendee's name.

A member attendee sees the same component inside the application's own meeting route, which branches on `format` and on the join answer; a non-member sees it at `/attend/<token>`, outside `(app)`, on the guest page's terms: no shell, no session bootstrap, `credentials: "omit"` on every call, nothing that links into the application.

### 13.2 The panel's and the host's screen

The room screen, unchanged for a panelist, plus one **Webinar** band in the header: "Practice session — attendees cannot see or hear you yet" until the audience is opened, then the attending count off the `audience` frame. For a host, a **Webinar** menu beside Host controls: Open to attendees (behind an `ActionDialog`, because it cannot be undone), Lock the audience door, Attendees (a `Sheet` over the paged attendance read, with Remove and, for a member, Make panelist), Registrations (a `Sheet` with add, rotate, withdraw and, for a public registrant, Add to Directory), Panelists, Public page (slice two) and Broadcast (slice three). The Q&A sheet from the polls design gains **Publish to attendees** on each question for a host.

### 13.3 Before the webinar

The calendar's entry action and the event form's Meeting choice gain **Webinar** beside Video meeting and Audio call. The Meetings page draws a webinar row with its own glyph (Lucide `presentation`) and, for a host, the registered count.

## 14. Interplay

**The lobby.** It governs the room, which in a webinar is the panel, and it is unchanged: a guest panelist always waits in it, a host who turns it on holds member panelists too. **Attendees never enter the lobby**: a lobby is a host deciding about one named person and is bounded at a hundred; the audience's door is the registration, the practice session and the audience lock. A locked room refuses panelists; a locked audience door refuses attendees; neither touches the other.

**Guests.** A guest link on a webinar is a panelist invitation and works exactly as the guests design built it. A Directory entity may hold a guest link or a registration on one meeting, never both (`webinar-registrant-is-panelist`), so one person is never in the room and in the audience at once. The two credentials are different `typ`s on different lanes addressed to different objects, so neither can be spent as the other.

**Recording.** The recording design records the audio tracks on the room's roster, which in a webinar is the panel, so **nothing an attendee does is recorded, because an attendee publishes nothing.** The announcement still reaches the audience: the room calls every shard with the recording state and each shard sends the recording design's `recording` frame, unchanged in shape, through the audience protocol; `audience-welcome` carries it for a late arrival. Two requirements land on the recording node rather than here, both free while that migration is unlanded and a rebuild afterwards: `meeting_recording_notice` must name the told stay **by value with a kind** (the chat precedent) rather than as a foreign key to `meeting_attendance`, or attendees can be told but never recorded as told; and live captions, when built, are relayed by the shards as display and stored by none of them. The recording design's track ceiling is measured against the panel, which in a webinar is at most fifty.

**Chat.** The panel's chat is the room's chat, unchanged, and it reaches welcomed room sockets only. Shards are separate objects, so no chat line can reach an attendee by any broadcast; that is structural, not filtered. Attendees do not chat.

**Reactions and hands.** The room's reactions and hands stay in the room; the panel's applause is not relayed to the audience, and the audience cannot react or raise a hand.

**Host controls.** Section 12. The grant is the room's, one per meeting, and every webinar act composes `requireHostGrant`.

**Scheduling and notifications.** A webinar scheduled on a matter event notifies its member participants through the existing `calendar.event.meetingScheduled` topic with the medium as its one fact; the format is added as a second closed label. Registrations are not notifications: members registered by a host are told by the same topic's audience, and everybody else by the link mail.

**End-to-end encryption.** As for any meeting: the routing service reads the media, which the audience depends on.

## 15. Security

### 15.1 The attendee credentials

Everything the guests design says of its credentials holds for the attendee link and the attendance grant: 256 bits of CSPRNG secret through `@magna-carta/identifiers/random`, only its SHA-256 at rest, HMAC-SHA-256 over `AUTH_SECRET` for the envelope with a `typ` that no other token shares, every comparison constant-time (`apps/api-worker/src/constant-time.ts`), and **no credential in a log, a telemetry field, an audit row, a problem detail or an error payload**. The grant rides the shard socket's address on the upgrade alone; the request log records route templates, and the fitness assertion over the request-logging path that the guests design asks for covers the `audience` parameter too.

### 15.2 The line between a flat refusal and a useful one

A credential whose signature does not verify — page, link or grant — gets the reserved 404, indistinguishable from any other absent path, after spending the client-address limiter and before any read. A credential whose signature verifies but whose row refuses it gets a specific sentence, because only somebody the firm sent it to can hold it. That is the guests design's line, applied to three new token types.

### 15.3 No matter identifier, ever, on either unauthenticated surface

- The page token and the attendee link name the **webinar row** and the registration, never the meeting, the event or the matter.
- The public page can exist only for a firm event: the statement that opens a page carries `event_kind = 'firm'` in its WHERE and is guarded.
- The reduced summaries are distinct schemas with no `matterId`, `eventId` or `meetingId` field, and the route tests assert over the response bodies, not the schemas, that none of those identifiers appears.
- The mail carries the firm's name, the event's title, its start in its own zone and the link. For a matter webinar the title is disclosed on the guests design's reasoning — registering somebody for this briefing discloses it — and nothing else about the matter travels.

### 15.4 What an attendee can reach

A signaling socket to one shard that speaks a union with no publish; a subscription to tracks on the stage and nothing else, checked against the shard's copy before the routing service is asked (the routing service would honour a subscription to any session in the fleet); the questions routes with their own ceiling; and their own departure. No attendee credential reaches the room, the roster, the chat, the lobby, the attendance read or any member route.

## 16. Live streaming

### 16.1 What is and is not memory-safe

Broadcasting a meeting to a streaming destination means producing **one** stream a destination can ingest: one video picture, one audio mix, encoded, and pushed over RTMP(S) or SRT to a video platform, or over WHIP to Cloudflare Stream. Our meeting has no such stream anywhere. The routing service forwards N separate tracks and composes nothing; its only egress adapter delivers audio as PCM and video as roughly one JPEG a second.

- **Composing and encoding video on the server** — laying the panel's cameras into one picture and encoding it — requires decoding VP8 or H.264 and encoding the result. There is no production-grade pure-Rust decoder or encoder for those codecs; libvpx, openh264 and dav1d are C. The recording design established this and priced the three ways around it; it is not re-argued here.
- **RTMP or SRT from a browser** is not possible: no browser speaks either. RTMP(S) or SRT therefore means a server-side encoder and muxer — the C/C++ consent case under golden rule 14 — or RealtimeKit, whose export includes RTMP and HLS livestreaming at $0.010 a minute and which replaces our meeting stack to get it (research note, section 7).
- **WHIP from a browser** is supported by Stream: "a complete, no-dependency example of going live from a browser" (<https://developers.cloudflare.com/stream/webrtc-beta/>, last updated 2026-09-01). The browser encodes with its own WebRTC encoder, as it does for every meeting today; this platform ships no codec, so the path adds no C/C++ to our deployment.
- **But a WHIP input goes nowhere else.** The same page, read 2026-09-24: "Recording and live HLS playback are not yet supported"; "Simulcasting (restreaming via RTMP/SRT) is not supported"; "Live viewer counts are not supported". A WHIP input is watched through WHEP and only through WHEP, with "less than 500 milliseconds of latency" and "no fixed concurrent viewer limits". Playback can be protected: the WebRTC beta supports signed URLs through a signing key (<https://developers.cloudflare.com/changelog/post/2025-04-14-webrtc-beta-signed-urls/>), an RS256 token minted locally with the key, the `/token` endpoint "does not support Live WebRTC" (<https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/>, last updated 2026-05-07).

So option (b) cannot reach YouTube, LinkedIn or any platform's ingest at all. What it reaches is a Cloudflare-hosted viewing link.

### 16.2 The three options, and the recommendation

- **(a) Defer to an owner decision.** Right for **third-party destinations**, because the decision is the one already on the `meetings.recording` node: move meetings onto RealtimeKit to get composition managed, or consent to a C/C++ codec in a network-isolated container on the clamd precedent. Answering it for recording answers it for streaming; asking it twice would be two answers to one question.
- **(b) Stream Live over WHIP, one publisher, uncomposed.** Right for **the webinar's own audience beyond the realtime ceiling**, and recommended, with the trade below.
- **(c) Not built.** Right for **broadcasting an ordinary meeting** to a link. A meeting has no audience, no registration and no record of who watched; putting one on a URL would be a gathering whose attendance the firm cannot state, which is the one thing the meeting record exists to state. A member who wants a meeting watched schedules a webinar.

**Recommendation: (b), inside the webinar, as the broadcast lane; (a) for third-party destinations, carried to the owner beside the video-recording question; (c) for ordinary meetings.** The ledger's `meetings.live-streaming` node is re-scoped to the broadcast lane and carries the destination question as `awaiting-owner` (section 21).

### 16.3 The broadcast lane (slice three)

**Who publishes.** A host or co-host in the room presses **Start broadcast** and their own browser becomes the broadcaster. The route creates a Stream live input with `requireSignedURLs: true` and answers the caller — and only the caller — with the input's WHIP URL. **The WHIP URL is a publish credential**: it is never stored, never logged, never put on the room's wire and never sent to anybody but the browser that asked; the row keeps only the live input's identifier. Stopping deletes the live input, which is what kills the URL. A broadcaster who reloads presses Resume, and the route reads the input back and answers the URL again to a caller holding the grant.

**What is published: one picture, uncomposed, and one mixed sound.** A second peer connection in the broadcaster's browser, to the WHIP endpoint, with two senders:

- **Video: one track, never composed.** The shared screen if anybody is sharing, otherwise the spotlit panelist's camera, otherwise the broadcaster's own. The broadcaster's browser is already receiving that track from the routing service (or capturing it), and hands it to the second connection; a change of subject is `RTCRtpSender.replaceTrack`, which needs no renegotiation. The browser re-encodes what it re-sends, with its own encoder.
- **Audio: the panel's sound, mixed in the browser's Web Audio graph.** Every panel microphone the broadcaster is pulling and their own, each a `MediaStreamAudioSourceNode`, summed into one `MediaStreamAudioDestinationNode`. This is the one extension to option (b) as posed, and it is stated rather than slipped in: a single publisher's own microphone would make every other panelist silent to the broadcast, which is useless for a panel. Mixing is addition over PCM inside the browser's own audio engine, driven from TypeScript; it composes no video, decodes nothing we ship, and adds no dependency.
- The rule that decides the video source is a pure function, `apps/web/src/lib/meetings/client/broadcast-source.ts`, from the room state and the roster; the mixing graph is `client/broadcast-mix.ts`, a seam on `MeetingClientSeams` so it is testable without an `AudioContext`.

**Who watches.** An attendee whose arrival finds the realtime lane full — or every attendee, where a host chose broadcast for the whole audience — is answered `lane: "broadcast"` and a `playback` object with a signed WHEP URL. The token is RS256 over `{ sub: liveInputId, kid, exp, nbf }`, minted in the Worker with WebCrypto from the signing key (`STREAM_SIGNING_KEY_JWK`), `exp = min(grant expiry, now + 2 hours)`. **The attendee still holds a shard socket**, for the audience state, the questions and the end; the shard makes no routing-service call for them, so a broadcast attendee costs a shard one socket and a share of each fan-out. That is also what keeps the record precise: a broadcast attendee has a stay with a `joined_at` and a `left_at` like everybody else, because the socket is what the stay is timed by. Stream reports no viewer count; the record does not need it.

**Bindings**, all optional, beside the Realtime ones: `STREAM_ACCOUNT_ID`, `STREAM_API_TOKEN`, `STREAM_CUSTOMER_SUBDOMAIN`, `STREAM_SIGNING_KEY_ID`, `STREAM_SIGNING_KEY_JWK`. Absent, the Broadcast control is not drawn and the routes answer 503 `meetings-broadcast-not-configured`, the `meetings-not-configured` precedent. The client is `apps/api-worker/src/meetings/broadcast/stream-live-client.ts`, which takes `fetch` as a parameter for the same reason the routing client does and never echoes an upstream body.

### 16.4 The trade, recorded

What (b) costs, in the order a firm would feel it:

- **One browser carries it.** If the broadcaster's machine sleeps, loses its network or closes the tab, the broadcast stops for every broadcast attendee until somebody with a grant presses Resume or Start. Their screen says "The broadcast is paused" rather than freezing, driven by the shard's `audience-state`. The realtime lane is unaffected. Background tabs are throttled by browsers; the broadcaster's screen says to keep the tab in front.
- **The broadcaster's machine does a second encode** of whatever it re-sends, on top of its own camera. A panelist on a weak laptop is not the right broadcaster, and the control says so.
- **Not recorded, no HLS, no restream**, per Stream's own page. The recording design's audio recording is the record either way.
- **A signed playback URL can be forwarded until it expires.** Per-viewer revocation is not available on a shared live input; a removal closes the attendee's stay and socket, and their token dies at its expiry, at most two hours later. For a matter webinar this is the one place a forwarded credential outlives a removal, and the host's Broadcast control on a matter webinar carries that sentence.
- **Cost is not the reason, and not a reason against.** About $0.06 a viewer-hour against $0.034 to $0.068 on the realtime lane (section 4.5).

What (b) buys: an audience three times the realtime ceiling at under half a second of latency, with no C/C++, no container, no composition on any server, and with every viewer still a registration and a stay on the firm's record.

## 17. The public registration page (slice two)

The page is an unauthenticated surface that writes to a firm's database and sends mail to an address a stranger typed. Every property below is required; none is a hardening pass for later.

- **Where.** `/register/<pageToken>` on the app origin, outside `(app)`, on the guest page's four reasons — the static assets serve it, the API rides `/api/*`, no zone route or `run_worker_first` change, and it holds no cookie. `credentials: "omit"` on every call.
- **The token.** `typ: "meeting-webinar-registration-page"`, `{ firmId, webinarId, pageVersion, exp }`, with `exp` the event's end plus the link grace. A rotation increments `public_page_version` and every earlier page URL stops verifying; closing the page refuses the next submission with `webinar-registration-closed`.
- **The flat refusal.** A page token that does not verify is the reserved 404 before any read, so guessing at the route cannot learn whether a firm or a webinar exists.
- **A page cannot be opened in a deployment that cannot tell a person from a script.** Opening a page is refused 503 `webinar-public-page-not-protected` unless the human-verification verifier is configured (`resolveHumanVerificationPort` answers a live verifier). The submission calls `enforceHumanVerification` from its handler, after the limiter, as the two existing anonymous writes do. The existing gates stay dormant until a secret exists; this one refuses to exist without one, because the rate limiter is per isolate and in memory and a page that mails any typed address is exactly what a mail-bombing script looks for.
- **Rate limits.** The `webinar-registration` bucket on the client address; a per-address throttle, `PUBLIC_REGISTRATION_RESEND_MINUTES = 10`, read off `last_link_sent_at` on the registration the address hash finds, so resubmitting an address mails it at most once in the window; and the registration ceiling, `MAX_WEBINAR_REGISTRATIONS`, in the insert's own WHERE, guarded.
- **One answer for every address.** A new registration, an address already registered, an address inside its resend window and an address that previously withdrew all answer **202 `{ status: "check-your-email" }`** and nothing more, so the page cannot be used to learn who registered for a firm's seminar. A new registration is written and mailed; an existing one is re-mailed if outside its window; a withdrawn one is reinstated only by the registrant spending the fresh link, never by the form.
- **The mail echoes nothing the registrant typed.** No name, no organization: "Hello," and then the firm's name, the event's title and time, the link, and "If you did not register for this, you can ignore this message; you will not be sent another." A form that put typed text into mail to an arbitrary address would be a way to send anybody anything under the firm's name. `messageClass: "meeting-webinar-registration"` so telemetry counts it without touching the body.
- **Confirmation is the first spend of the link.** A public registration is written unconfirmed; the link in the mail goes to a page that spends nothing on open (the joining-mail precedent, pinned by `apps/api-worker/test/joining-mail.test.ts`), and the first POST from it confirms. Unconfirmed registrations are shown to a host as such and are not counted as registered.
- **Input.** Name 1 to 120 characters and organization up to 120, whitespace-normalized, rendered as text and never as markup, never written over any Directory name; the address normalized (trimmed, lowercased domain) and length-bounded at 254, hashed for uniqueness. The body is JSON; the page holds no cookie, so there is no session for a cross-site request to ride.
- **Indexing.** The page carries `noindex`: a firm's seminar page appearing in search results under this product's origin is a decision about the firm's public presence, and it is not taken here (section 22).

## 18. Telemetry

Two families in `packages/telemetry/src/events.ts`, one allowlist builder per act, correlated by `firmId`, `meetingId` and, where the act is about one attendee, `stayId`. **There is no declared field for a name, an address, an organization, a token, a question body or a WHIP URL**, so none can be added at a call site.

- `meetings.webinar.*`: `registered` (kind), `registrationRefused` (reason; the flat refusal is counted with reason `unverified`), `linkMailed` (kind, whether throttled), `arrived` (lane), `audienceOpened`, `audienceLocked`, `attendeeRemoved`, `attendeePromoted`, `publicPageOpened`, `publicPageRefusedUnprotected`, `broadcastStarted`, `broadcastStopped` (reason), `broadcastTokenIssued` (count, once per minute per webinar rather than per viewer), `addressesScrubbed` (count, per sweep).
- `meetings.audience.*`, the room's family's twin, per shard: `joined`, `welcomed`, `subscribed` (requested, forwarded), `refused` (reason, sampled on the frame budget's terms), `socketLost`, `swept`, `superseded`, `stageFanout` (sockets reached, milliseconds), `stagePresenceFlushed`, `storageReadBudget` (sampled), `clientReport`, `alarmRan`.
- The room gains `meetings.room.stageSent` (shards reached, shards failed).

An operator's view of a shard is `inspect()` behind the platform-operator guard, audited to `auth_audit` on the room's own terms, at `GET /api/v1/meetings/{meetingId}/audience/{shardIndex}/inspect`: the socket count, the stage copy's size and age, the alarm, the storage size, the routing sessions — never a name.

## 19. Testing

**`packages/meetings/test/`** (`node:sqlite`, the service-test precedent):

- A webinar opens with its row in the same batch as the meeting and its starter's host grant; `MeetingSummary.format` reads `webinar`; `format: webinar` with `medium: audio` is refused.
- The room's admission in a webinar takes `MAX_WEBINAR_PANELISTS` and refuses the fifty-first panelist; a member with no panelist row and no grant is refused `meeting-not-a-panelist` at the join and at the waiting insert; a withdrawal racing an arrival rolls the arrival back.
- Registration: each kind's shape CHECK; one live registration per member, per entity and per address hash; the public kind is refused on a matter event by the guarded statement; `MAX_WEBINAR_REGISTRATIONS` refuses the next; a withdrawal and a re-registration.
- The attendee stay: arrival opens a stay, confirms a public registration and increments `arrival_count`; a second arrival while open returns the same stay; the twenty-first is refused; the audience door refuses and touches nobody watching; `MAX_WEBINAR_ATTENDEES` holds under a burst; the shard assignment spreads a burst evenly; a removal bars the registration.
- **Ending closes every stay of every kind at one instant** — panelist, guest, attendee.
- **The widened fitness test:** every table carrying `meeting_id`, `joined_at` and `left_at` is in exactly one of `MEETING_STAY_TABLES` and `WEBINAR_AUDIENCE_STAY_TABLES`, and the live count, the room ceiling and the lobby ceiling do not count an attendee.
- Promotion closes the attendee stay `promoted` and writes the panelist row in one batch, and is refused for an entity or public registrant.
- The address sweep nulls `public_email` past the retention window, keeps the hash, and leaves member and entity rows untouched.
- Every audit row carries identifiers and instants and nothing else, with the explicit cases that no address, name or question body reaches one.

**Token unit tests** — the three new `typ`s each refused on every other lane and on the guest lane, and the guest `typ`s refused here; tampered payload, expired, rotated version, withdrawn row, mismatched hash; constant-time comparison.

**`apps/api-worker/test/audience-lane.test.ts`** — the lane on the guest lane's list: no credential and a bad signature are the reserved 404 after the limiter and before any read; `loadPermissions` is never called and `chokepointUserId` never set; an audience credential on a member route or a guest route is the reserved 404; registration-time refusals for every illegal meta combination; the `audience` query parameter accepted on the upgrade alone.

**`apps/api-worker/test/meeting-webinar-routes.test.ts`** — host routes 403 `meeting-not-host` without a grant; the page routes 403 without `meetings:openRegistration`; opening a page on a matter webinar is 422 and without a verifier is 503; a walled matter's webinar is 404 on every route; the registration list hides the address from a caller without a grant.

**`apps/api-worker/test/webinar-public-registration.test.ts`** — **the unauthenticated surface**: a bad page token is the reserved 404 with no read (asserted through the fake firm database's call count); the same 202 body for a new, an existing, a throttled and a withdrawn address, asserted byte for byte; one mail per address per window; the mail body contains none of the typed fields, asserted against a name and organization chosen to be unmistakable; the human-verification refusal is 403; the ceiling holds; no response body anywhere on the surface contains a matter, event or meeting identifier.

**`apps/api-worker/test/meeting-audience.test.ts`** (against the fake routing client) — a `publish`, a `presence` and every host frame from an attendee socket is `unknown-frame`; a subscribe to a pair not on the stage is `unknown-track` and never forwarded; a subscribe before the audience opens is `audience-not-open`; no frame sent to any attendee socket contains another attendee's stay handle, name or a `userId` (asserted over every captured frame); the session is opened without holding the gate across the call, so two attendees' openings overlap and one attendee's two frames do not open two sessions; supersede, grace and sweep on the room's terms; `promoted` then a normal close; `meetingEnded` reaches every socket.

**`apps/api-worker/test/meeting-room.test.ts`** — in a webinar the room calls every shard's `stageChanged` on a panel change and `stagePresence` at most once a second; `audience` reaches welcomed room sockets only; no chat `message` frame ever reaches a shard.

**The load harness** — `test/support/meeting-audience-load.ts`, the fast variant (a panel of five, an audience of two hundred over two shards) in the ordinary suite asserting routing calls per arrival at three or fewer, per stage change at two or fewer, and zero roster reads per attendee frame; the full variant (`VITE_MEETING_AUDIENCE_LOAD_ATTENDEES=1000`) by hand, printing the table section 4.2 estimates.

**Contract** — the emitted OpenAPI snapshot and the generated client regenerated in the same commit; the conformance suite's operation list updated; the two reduced summaries asserted distinct from `MeetingSummary`.

**`apps/web/test/`** — `audience-policy.test.ts` (a shared screen wins the large tile, the spotlight next, speakers after, the half layer for the strip, one subscribe frame for the whole plan, a fifty-person panel); the audience client constructs with no capture seam and never calls one; the pre-show state pulls nothing; `promoted` moves a member to the room; the questions sheet never draws another attendee's name; the public page sends `credentials: "omit"`, carries the verification header, and shows the same sentence whatever the answer; `broadcast-source.test.ts` (screen, then spotlight, then self); the mixing graph against a fake audio context.

## 20. The files, split by agent

**The backend agent owns everything under `packages/` and `apps/api-worker/`, including the emitted contract, the generated client and the ledger and status fragments; the web agent owns everything under `apps/web/` and `docs/user/`.** No file appears on both lists. The contract is the handoff: the backend agent emits and regenerates first.

**The shared-surface risk is the chokepoint.** `apps/api-worker/src/chokepoint/chokepoint.ts`, `ports.ts`, `context-accessors.ts`, `rate-limiter.ts` and `apps/api-worker/src/contracts/route-meta.ts` are read by every route in the platform. The audience lane is additive — one optional field, one step that does not run when the field is absent, one new port — and lands in **one commit of its own, first**, as the guests design asked of its lane.

**Sequencing.** Slice one's question-queue half waits for the polls-and-questions slice's migration, and section 11's three-value CHECK is a requirement on that migration; if polls lands first with two values, the fallback column is added here. Everything else in slice one is independent of it.

### Slice one — the webinar

Backend:

- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts` — the four handles.
- `packages/database/src/per-firm-schema.ts`, `packages/database/drizzle/per-firm/<timestamp>_meeting-webinars.sql`, the snapshot under `packages/database/drizzle/per-firm/meta/`, `apps/api-worker/src/per-firm-migrations.ts` (generated) — the four tables, and `meeting_question.published_at` / `published_by_user_id` once that table exists.
- `packages/data-access/src/pii-registry.ts` — section 3's entries.
- `packages/access-control/src/registry.ts` and its seed — `meetings:openRegistration`, Owner and Admin.
- `packages/meetings/src/types.ts` — `MeetingSummary.format`, `MEETING_FORMATS`.
- `packages/meetings/src/validation.ts` — the refusal codes behind section 8.4.
- `packages/meetings/src/meeting-statements.ts` — `WEBINAR_AUDIENCE_STAY_TABLES`, the derived format, the panelist condition in both door predicates, `closeAllWebinarAttendanceStatement`.
- `packages/meetings/src/meeting-service.ts` — `openMeetingOnEvent` writes the webinar row; `joinMeeting` passes the panel's capacity; `endMeeting` composes the third close.
- `packages/meetings/src/webinar-types.ts`, `webinar-statements.ts`, `webinar-service.ts` (new) — the webinar row, the two doors, panelists, settings.
- `packages/meetings/src/registration-types.ts`, `registration-statements.ts`, `registration-service.ts` (new) — the three kinds, links, rotation, withdrawal, the address sweep.
- `packages/meetings/src/audience-types.ts`, `audience-statements.ts`, `audience-service.ts` (new) — arrival, shard assignment, departure, socket-loss close, removal, promotion.
- `packages/meetings/src/question-service.ts` — the attendee asker and publication (after polls lands).
- `packages/meetings/CLAUDE.md` — the third kind of stay, the two lists, the public registrant line.
- `packages/meetings/test/webinar-service.test.ts`, `registration-service.test.ts`, `audience-service.test.ts` (new); `packages/meetings/test/guests.test.ts` — the widened fitness test.
- `packages/meeting-protocol/src/audience-frames.ts` (new), `packages/meeting-protocol/src/types.ts` (the stage shapes), `packages/meeting-protocol/src/frames.ts` (the room's `audience` frame and the `welcome` field), `packages/meeting-protocol/CLAUDE.md`, `packages/meeting-protocol/test/frames-have-handlers.test.ts`, `packages/meeting-protocol/test/audience-frames.test.ts` (new).
- `packages/telemetry/src/events.ts` — the two families and `meetings.room.stageSent`.
- `apps/api-worker/src/chokepoint/chokepoint.ts`, `ports.ts`, `context-accessors.ts`, `rate-limiter.ts`, `apps/api-worker/src/contracts/route-meta.ts` — the audience lane and the two buckets (first, alone).
- `apps/api-worker/src/meetings/audience-token.ts`, `audience-refusals.ts`, `webinar-link-mail.ts` (new).
- `apps/api-worker/src/meetings/audience/meeting-audience.ts`, `audience-state.ts`, `audience-stage.ts`, `audience-media.ts`, `audience-lifecycle.ts`, `audience-frames.ts`, `audience-diagnostics.ts`, `audience-inspect.ts` (new).
- `apps/api-worker/src/meetings/room/room-stage.ts` (new); `room-state.ts` (`StoredRoom` gains the webinar's shard count and the audience counts); `room-lifecycle.ts` (the stage-presence deadline, the end reaching shards); `room-roster.ts` (the stage projection's call site); `apps/api-worker/src/meetings/meeting-room.ts` (the RPCs); `apps/api-worker/src/meetings/CLAUDE.md`.
- `apps/api-worker/src/routes/meeting-webinar.ts`, `meetings-audience.ts`, `meeting-audience-inspect.ts` (new); `apps/api-worker/src/routes/meetings.ts` (`format` on create and summary); `apps/api-worker/src/routes/calendar.ts` (`format` on the event's meeting field); `apps/api-worker/src/routes/meeting-questions.ts` (publication, after polls lands).
- `apps/api-worker/src/app.ts` (the `MEETING_AUDIENCE` binding and route bundles), `apps/api-worker/src/index.ts` (re-export the class, nothing else), `apps/api-worker/wrangler.jsonc` (the class and its migration entry).
- `apps/api-worker/openapi/openapi.json` (emitted), `packages/api-client` (generated).
- `apps/api-worker/test/audience-lane.test.ts`, `meeting-webinar-routes.test.ts`, `meeting-audience.test.ts`, `meeting-audience-load.test.ts`, `test/support/meeting-audience-load.ts` (new); `meeting-room.test.ts`, `meetings-routes.test.ts`.
- `roadmap.d/meetings.md`, `status.d/meetings.md`, `STATUS.md`, `STATUS.json`, `docs/now.md`, `changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md` (the audience lane; attendees as a third kind of stay; the public registrant line), `docs/operating-costs.md`.

Web:

- `apps/web/src/lib/meetings/audience/audience-client.svelte.ts`, `audience-policy.ts`, `audience-signaling.ts`, `audience-questions.svelte.ts` (new) — reusing `client/negotiation.ts` and `client/subscriptions.ts` unchanged.
- `apps/web/src/lib/meetings/audience/screen/audience-stage.svelte`, `audience-controls.svelte`, `audience-questions-panel.svelte`, `audience-waiting.svelte` (new).
- `apps/web/src/lib/meetings/meeting-webinar-menu.svelte`, `meeting-webinar-attendees.svelte`, `meeting-webinar-registrations.svelte`, `meeting-webinar-panelists.svelte` (new).
- `apps/web/src/lib/meetings/screen/meeting-controls.svelte` — the Webinar menu beside Host controls; `apps/web/src/lib/meetings/screen/meeting-questions-panel.svelte` — Publish to attendees (after polls lands).
- `apps/web/src/lib/meetings/client/signaling.ts`, `client/meeting-client.svelte.ts` — the room's `audience` frame and `welcome` field; `meeting-not-a-panelist` hands off to the audience view.
- `apps/web/src/lib/meetings/meetings-api.ts`, `apps/web/src/lib/meetings/audience-api.ts` (new), `apps/web/src/lib/api/socket-url.ts` (`audienceSocketUrl`, `memberAudienceSocketUrl`).
- `apps/web/src/routes/(app)/meetings/[id]/+page.svelte` — the format branch and the Webinar band; `apps/web/src/routes/attend/[token]/+page.svelte`, `+page.ts` (new).
- `apps/web/src/lib/meetings/meeting-entry-action.svelte`, `apps/web/src/lib/meetings/meeting-list-section.svelte`, `apps/web/src/lib/calendar/record-event-dialog.svelte` — Webinar as a choice, and the row glyph.
- `apps/web/src/lib/meetings/CLAUDE.md` — the audience directory and its no-capture rule.
- `apps/web/test/audience-policy.test.ts`, `audience-client.test.ts`, `meeting-webinar-menu.test.ts`, `attend-page.test.ts` (new); `meeting-client.test.ts`, `meeting-room-page.test.ts`.
- `docs/user/features/meetings.md` — running a webinar, attending one.

### Slice two — the public page

Backend: `apps/api-worker/src/routes/webinar-public-registration.ts` (new); `apps/api-worker/src/meetings/audience-token.ts` (the page `typ`); `apps/api-worker/src/meetings/webinar-link-mail.ts` (the public letter); `packages/meetings/src/registration-service.ts`, `registration-statements.ts` (the public kind, the throttle, the one-answer rule); `packages/meetings/src/webinar-service.ts` (open, close, rotate); `apps/api-worker/src/scheduled.ts` (the address sweep on the daily pass); `apps/api-worker/test/webinar-public-registration.test.ts` (new); the contract and client; the ledger and status fragments.

Web: `apps/web/src/routes/register/[token]/+page.svelte`, `+page.ts` (new); `apps/web/src/lib/meetings/audience/public-registration-form.svelte` (new); `apps/web/src/lib/meetings/meeting-webinar-public-page.svelte` (new); `apps/web/test/public-registration.test.ts` (new); `docs/user/features/meetings.md`.

### Slice three — the broadcast lane

Backend: `apps/api-worker/src/meetings/broadcast/stream-live-client.ts`, `stream-playback-token.ts` (new); `packages/meetings/src/broadcast-types.ts`, `broadcast-statements.ts`, `broadcast-service.ts` (new); the `meeting_webinar_broadcast` migration and snapshot; `apps/api-worker/src/routes/meeting-webinar.ts` (start, resume, stop); `apps/api-worker/src/routes/meetings-audience.ts` (the broadcast answer on arrival); `apps/api-worker/src/meetings/audience/audience-lifecycle.ts` (a broadcast attendee costs no routing call); `apps/api-worker/src/app.ts` and `wrangler.jsonc` (the optional Stream bindings); `apps/api-worker/test/meeting-broadcast.test.ts` (new); the contract and client; `docs/operating-costs.md`; the ledger and status fragments.

Web: `apps/web/src/lib/meetings/client/broadcast-source.ts`, `broadcast-mix.ts`, `broadcast-publisher.ts` (new); `apps/web/src/lib/meetings/meeting-webinar-broadcast.svelte` (new); `apps/web/src/lib/meetings/audience/audience-client.svelte.ts` (the WHEP playback path); `apps/web/test/broadcast-source.test.ts`, `broadcast-mix.test.ts` (new); `docs/user/features/meetings.md`.

## 21. The ledger, for the implementing stream

`meetings.webinars` moves to `designed` with this spec, then `in-build` and `shipped` by slice. `meetings.live-streaming` is re-scoped to "a webinar broadcast to a Cloudflare-hosted viewing link beyond the realtime audience", moves to `designed`, and carries `awaiting-owner`: _Should a webinar also be streamed to a third-party platform (an RTMP or SRT destination)? That needs a composed, encoded video stream, which has no memory-safe server-side path today — the same choice as video recording: RealtimeKit, or a C/C++ codec in an isolated container._ Two child nodes are worth adding: `meetings.webinars.public-registration` and `meetings.webinars.broadcast`.

## 22. What this does not settle

- **For the owner — third-party streaming destinations.** Section 16.2 and section 21. Not built until the video-recording question is answered, and answered by the same answer.
- **For the owner — the public registrant as a data subject.** Whether `SubjectRef` gains a third anchor for somebody in the firm's records who is not in the Directory, or an erasure request from a registrant is answered through the address hash alone (section 6.3).
- **For Cloudflare — the application-wide ceiling.** The routing service publishes per-session limits and no per-application one; the fleet shares one application. Asked before `MAX_WEBINAR_ATTENDEES` moves past 1,000, together with the recording design's open question about the adapter's concurrency cap.
- **The room's own session gate.** `sessionFor` serializes session creation across the room by holding the gate over the network call (section 4.2). The shard avoids the shape; whether the room adopts the shard's shape is a change to shipped code with its own test, and is left to the stream that owns `room-media.ts`.
- **Demoting a panelist to the audience.** The panel stay's departure vocabulary has no word for it, and `meeting_attendance.ended_reason`'s CHECK is not widened by this design. Withdrawing a panelist takes effect at their next arrival; Remove is the immediate act.
- **Attendee chat, reactions, raised hands and upvotes.** None costs a record the questions do not already cost, and each is a fan-in across shards that the room's coalescing does not yet do. Reactions are the likeliest next; each is a frame in the audience protocol and a count the room sums.
- **Polls for attendees.** The polls tables would need the same third participant kind section 11 asks of the questions tables.
- **Promoting a Directory-entity attendee in place.** They are invited as a guest panelist instead, through the lobby.
- **A webinar with more than one room** (breakout sessions for an audience), practice-session recording, and a post-webinar survey.
- **Search indexing of a public page**, a firm's own domain for it, and a branded page. The page is `noindex` on this product's origin.
- **Reminders.** A reminder mail before the webinar is the scheduling node's remaining half, and resends the same link rather than minting one.
- **Webinars on the desktop shell.** Parity holds: the attendee page is web, and the panel's screen is the room's.
- **The client portal.** When `PortalGrant` lands, a Directory-entity registrant is a portal principal with a grant carrying this capability, and the registration table's entity kind is what that migration absorbs, as the guest tables are.
