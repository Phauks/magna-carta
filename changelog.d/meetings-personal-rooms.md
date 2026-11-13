---
category: Added
audience: public
---

**Personal meeting rooms.** A host has one standing room (`meeting_personal_room`: owner, a
ten-character link code, the medium and lobby its sessions open with), made on request and never by
a read. Opening it writes an ordinary firm event (or matter event) with the owner on it and an
ordinary meeting with `personal_room_id` set; a partial unique index holds one open session per
room, and a session everybody has left is ended at the last departure on the next open, its event
given an end time and marked occurred. A colleague's arrival by link puts them on the session's
event, so the room's own join admits them. A session on a firm event moves onto a matter during or
after it (`POST /api/v1/meetings/{meetingId}/move-to-matter`): a matter event is written with the
same participants, the meeting is re-pointed under a guard, and the firm event is deleted, so the
meeting keeps its handle. Eight routes under `meetings.*`; four new problem types; the meeting
summary gains `personalRoomSession`. The web gains the My Room card, the link page at
`/meetings/rooms/{linkCode}` and Move to a Matter in the room's header. Includes a per-firm
migration.

## Public

**Your own meeting room.** If you host meetings, the Meetings page now has a **My Room** card: a
link that stays the same, so colleagues can join you whenever you are in without anybody scheduling
a meeting first. Opening the room puts the meeting on your calendar, and **Move to a Matter** puts it
on the right matter during the meeting or afterwards.
