# Meetings — personal rooms, design

**Status:** Draft, 2026-11-10. One owner question is open (section 9); the draft builds on the recommended answer.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) covers the meeting record, the `MeetingRoom` Durable Object, the lobby, hosting and the screen. Nothing here rebuilds any of it.
**Ledger:** the `meetings.personal-room` node in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md).

## 1. What this settles

A personal room is a room a member always has, reached by a link that does not change, so a colleague can be told "come to my room" without anybody first creating a calendar event. The owner allowed them on 2026-11-09. The ledger left one question open: every other meeting hangs from a calendar event, so how does a meeting held in a personal room reach the record?

**This design's answer: the room is a standing link, and each time it opens it writes an ordinary calendar event and an ordinary meeting.** Nothing downstream learns a new kind of meeting. Attendance, the lobby, hosting, chat, polls, guests, recording, captions and summaries all work on a personal-room meeting because it is a normal meeting on a normal event.

## 2. Why not a meeting without an event

The meeting design holds that a meeting carries no title, time or participant list of its own, because those are the event's (meetings design, section 3, "Where a meeting hangs"). A meeting with no event would need its own answer to all three, plus a second branch through every read that joins the event: the access gate (`visibleEventClause`), the three meeting lists, the summary, and the recording's "is there a matter to file into" check. It would also leave the calendar silent about a meeting that happened, which is the one record a firm reads to answer "when did we speak to them".

Writing an event costs one row per session and keeps the calendar honest.

## 3. The room

```
meeting_personal_room
  id                  text pk            -- personalRoom_ handle
  owner_user_id       text not null -> member.user_id, UNIQUE
  link_code           text not null UNIQUE   -- 10 characters, unambiguous alphabet
  medium              text not null default 'video'   -- 'video' | 'audio' (CHECK), what a session opens with
  lobby               text not null default 'on'      -- 'off' | 'on' (CHECK)
  live_meeting_id     text null -> meeting.id         -- the session open now, if any
  link_replaced_at    text null          -- instant
  created_at, updated_at
```

- **One room per member, made the first time it is asked for.** The read of "my room" creates it when it does not exist, under the unique index on `owner_user_id`; two first reads racing end with one row, the same find-or-return shape as one meeting per event.
- **Having a room needs `meetings:host`**, because opening it starts a meeting. A member without the key has no room and sees no entry for one.
- **The link code is not a secret.** It is an address inside the firm, behind sign-in, like a matter's URL. It is still replaceable ("Get a new link"), because a code pasted into the wrong email is a nuisance worth one click to end. Replacing it ends nothing already running.
- **The lobby defaults on.** A standing link is passed around more freely than an event invitation, so the owner sees who is at the door before they come in. The owner can turn it off for their room, and a host can still change it per session, as on any meeting.

## 4. A session

**Only the room's owner opens it.** Pressing **Open my room** (or joining their own link) runs one batch:

1. A firm event: title "{owner's display name}'s room", `audience = 'participants'`, starting on the owner's civil date and wall-clock time now, in the owner's time zone (the profile zone, falling back to the hosting office's, as the event form does), with no end yet. The owner is its first participant.
2. The meeting on it, through the existing `openMeetingOnEvent`, with the room's medium and lobby.
3. A live host grant for the owner, as every Start writes.
4. `live_meeting_id` set, guarded on it being null, so two tabs pressing Open at once end in one session (the loser reads the winner's).

**Optionally, about a matter.** The Open control offers "About a matter" with the matter picker. When a matter is chosen the event is a matter event on that matter instead of a firm event, which is the only difference, and it matters for one reason: a recording is filed into a matter, so a meeting on a firm event cannot be recorded (`recording-service.ts`). Without a matter, the Record control explains that and points at the picker for next time.

**Anybody else on the link while the room is closed** sees "{owner} is not in their room yet" and the page waits, refreshing when the room opens. Nobody but the owner can open it, so an owner's room is never in use without them.

**Arriving while it is open.** A member who follows the link is added as a participant of the session's event (so the event appears on their calendar and the visibility rule admits them), then joins through the existing join path, which puts them at the door when the lobby is on. A member who cannot see the matter of a matter session gets the same refusal as on any walled meeting.

**Guests.** A session is a meeting, so its host invites people from outside the firm from the Guests panel exactly as on any meeting: a Directory entity, a signed link per session. A standing outside link is not in this design (section 9).

**Ending.** Ending the meeting by any existing path (the host's End, the room emptying past the grace sweep) also, in the same batch: sets the event's end to the end instant in the event's own zone, sets its status to `occurred`, and clears `live_meeting_id`. A session that ended is history; the next Open writes a new event.

## 5. Routes

| Route                                           | What it does                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/meetings/personal-room`            | The caller's room (created on first read): link code, medium, lobby, and the live session's meeting id when one is open. |
| `PATCH /api/v1/meetings/personal-room`          | Medium and lobby defaults.                                                                                               |
| `POST /api/v1/meetings/personal-room/link`      | Replace the link code. Audited.                                                                                          |
| `POST /api/v1/meetings/personal-room/open`      | Open a session (body: optional `matterId`). Returns the meeting summary; idempotent while one is open.                   |
| `GET /api/v1/meetings/rooms/{linkCode}`         | What the link shows: the owner's name, and the live meeting id or `closed`.                                              |
| `POST /api/v1/meetings/rooms/{linkCode}/arrive` | Add the caller to the live session's event, then answer with the meeting id to join.                                     |

Every one is behind sign-in and firm-scoped. An unknown link code and a room whose owner has left the firm are one answer, `meeting-room-unknown`.

## 6. The screen

- **Communications › Meetings** gains a **My room** card at the top: the link with a copy button, **Open my room**, the medium and lobby defaults, and **Get a new link**.
- The link opens `/meetings/rooms/{linkCode}`: the waiting message while closed, the existing meeting screen while open.
- Built in `apps/web` through the design system, reviewed on the deployed site.

## 7. Audit and the record

Identifiers and instants, as the rest of meetings: `meetings.personalRoom.created`, `.linkReplaced`, `.settingsChanged`, `.opened` (with the event and meeting handles) and `.arrived`. The event and meeting carry their own existing audit rows. `meeting_personal_room.owner_user_id` is `retain-under-matter` personal data like the meeting's own user columns.

## 8. Not in this design

- Moving a finished firm-event session onto a matter afterwards. Choosing the matter at Open covers the recording case; a general "move event to matter" belongs to the calendar.
- A room shared by a team (a "conference room" link). Same shape, a different owner kind; not asked for.
- End-to-end encryption needs nothing from this design: a session is an ordinary meeting.

## 9. Owner questions

1. **Where a personal-room meeting is recorded.** Asked 2026-11-10; recommended: a calendar event written as the room opens (sections 1 and 4).
2. **A standing link for people outside the firm.** Not yet asked. Today a guest is always a Directory entity invited to one meeting, so the record names somebody the firm knows and the conflicts check can see them. A standing outside link would let anybody holding it reach the door and type a name, which breaks that rule. Recommended answer: no standing outside link; invite guests per session from the Guests panel.
