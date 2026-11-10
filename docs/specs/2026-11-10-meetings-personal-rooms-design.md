# Meetings — personal rooms, design

**Status:** Draft, 2026-11-10. Shaped with the owner on 2026-11-10 (section 9); one question remains open.
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

**Optionally, about a matter.** The Open control offers "About a matter" with the matter picker. When a matter is chosen the event is a matter event on that matter instead of a firm event, which is the only difference, and it matters for one reason: a recording is filed into a matter, so a meeting on a firm event cannot be recorded (`recording-service.ts`). Without a matter, the Record control explains that and offers **Move to a matter** (below).

**Moving a session onto a matter, during or after it** (owner ruling, 2026-11-10). A session opened without a matter can be moved onto one by its owner or a live host, while it runs or at any time after it ended. The move is one batch:

1. A matter event on the chosen matter, carrying the firm event's title, times, time zone and participants.
2. The meeting re-pointed: `event_kind = 'matter'`, `matter_event_id` set, `firm_event_id` cleared. The meeting's handle does not change, so its attendance, chat, polls, questions and guest stays move with it untouched.
3. The firm event deleted, guarded on it still having this meeting and no other reference.
4. An audit row `meetings.meeting.movedToMatter` with both event handles and the matter's.

The move is refused (`meeting-move-refused`) when the caller may not see the matter, when the meeting is already on a matter, or when the firm event was anything but a personal-room session (an ordinary firm event is the calendar's to edit, not this route's). It is one-way: a session filed on the wrong matter is the calendar's ordinary correction, not an undo here. A live session moved onto a matter can be recorded from that moment.

**Anybody else on the link while the room is closed** sees "{owner} is not in their room yet" and the page waits, refreshing when the room opens. Nobody but the owner can open it, so an owner's room is never in use without them.

**Arriving while it is open.** A member who follows the link is added as a participant of the session's event (so the event appears on their calendar and the visibility rule admits them), then joins through the existing join path, which puts them at the door when the lobby is on. A member who cannot see the matter of a matter session gets the same refusal as on any walled meeting.

**Guests.** A session is a meeting, so its host invites people from outside the firm from the Guests panel exactly as on any meeting, with a signed link per session. Section 4a widens who that can be.

**Ending.** Ending the meeting by any existing path (the host's End, the room emptying past the grace sweep) also, in the same batch: sets the event's end to the end instant in the event's own zone, sets its status to `occurred`, and clears `live_meeting_id`. A session that ended is history; the next Open writes a new event.

## 4a. A guest who is not in the Directory yet

The owner's ruling of 2026-11-10: most guests are somebody in the Directory, but the product must not force it. This changes the guest rule for every meeting, not only personal rooms.

**What stays the same:** the record still names a Directory entity for every guest, because the conflicts check reads the Directory and a meeting with a stranger in it is exactly what that check exists for.

**What changes:** the host no longer has to find or create the Directory entry first. In the Guests panel they can type a name and an email address instead of picking somebody. The invitation then matches the address to a Directory person, or creates one marked **needs review**. This is the booking pages' precedent (`2026-09-24-meetings-scheduling-and-booking-pages-design.md`): a person created that way is real enough to be on the record and the conflicts corpus, and a reviewer later keeps, merges or discards them. The guest experiences nothing different.

## 5. Routes

| Route                                              | What it does                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/meetings/personal-room`               | The caller's room (created on first read): link code, medium, lobby, and the live session's meeting id when one is open. |
| `PATCH /api/v1/meetings/personal-room`             | Medium and lobby defaults.                                                                                               |
| `POST /api/v1/meetings/personal-room/link`         | Replace the link code. Audited.                                                                                          |
| `POST /api/v1/meetings/personal-room/open`         | Open a session (body: optional `matterId`). Returns the meeting summary; idempotent while one is open.                   |
| `GET /api/v1/meetings/rooms/{linkCode}`            | What the link shows: the owner's name, and the live meeting id or `closed`.                                              |
| `POST /api/v1/meetings/rooms/{linkCode}/arrive`    | Add the caller to the live session's event, then answer with the meeting id to join.                                     |
| `POST /api/v1/meetings/{meetingId}/move-to-matter` | Move a personal-room session onto a matter (body: `matterId`), during or after it.                                       |

Every one is behind sign-in and firm-scoped. An unknown link code and a room whose owner has left the firm are one answer, `meeting-room-unknown`.

## 6. The screen

- **Communications › Meetings** gains a **My room** card at the top: the link with a copy button, **Open my room**, the medium and lobby defaults, and **Get a new link**.
- The link opens `/meetings/rooms/{linkCode}`: the waiting message while closed, the existing meeting screen while open.
- Built in `apps/web` through the design system, reviewed on the deployed site.

## 7. Audit and the record

Identifiers and instants, as the rest of meetings: `meetings.personalRoom.created`, `.linkReplaced`, `.settingsChanged`, `.opened` (with the event and meeting handles) and `.arrived`. The event and meeting carry their own existing audit rows. `meeting_personal_room.owner_user_id` is `retain-under-matter` personal data like the meeting's own user columns.

## 8. Not in this design

- Moving an ordinary firm event onto a matter. Only a personal-room session moves here; a general "move event to matter" belongs to the calendar.
- A room shared by a team (a "conference room" link). Same shape, a different owner kind; not asked for.
- End-to-end encryption needs nothing from this design: a session is an ordinary meeting.

## 9. Owner questions

1. **Where a personal-room meeting is recorded.** Settled 2026-11-10: a calendar event written as the room opens (sections 1 and 4), and a session can be moved onto a matter during or after it (section 4).
2. **Guests outside the Directory.** Settled 2026-11-10: allowed, not forced. A guest typed by name and address is matched to the Directory or created there as needing review (section 4a).
3. **A standing link for people outside the firm.** Open. With section 4a, a standing outside link is possible: anybody holding it reaches the door, types a name and address, and the host decides at the door; a Directory person is matched or created as on an invitation. The risk is that the link is forwarded and strangers queue at the door. Recommended: allow it, off by default per room, replaceable like the member link.
