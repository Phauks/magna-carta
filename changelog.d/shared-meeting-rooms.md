---
category: Added
audience: public
---

**Shared rooms, and renaming a room.** `meeting_personal_room` gains `kind` (`personal` or `shared`), `title` and `retired_at`, and the one-room-per-member index becomes partial on `personal`. A member who may host sets up a shared room ("Red Room", "Large Conference Room") on the Meetings page. Anybody who may host opens it at `/room/<name>` (`POST /api/v1/meetings/rooms/{linkCode}/open`), and the meeting goes on the opener's calendar under the room's name. Hosts can rename a shared room, change its waiting room and audio-call settings, and remove it (`/api/v1/meetings/shared-rooms`). A member can rename their own room from My Room's "..." menu, and Use My Name puts it back. A room's link follows its name, so renaming moves the link and the old one stops working.

## Public

The Meetings page now has Shared Rooms: rooms the firm keeps for a place, such as a conference room. Anyone who can host meetings can set one up, open it, rename it or remove it. You can also rename your own room from the "..." menu on My Room. A room's link follows its name.
