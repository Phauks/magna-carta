---
category: Changed
audience: public
---

**Join, Start and Open go straight to a meeting's nine-digit address.** `meetingRoomAddress` (`apps/web/src/lib/meetings/meeting-tab.ts`) builds `/meeting/482-917-305` from the meeting's join code, and the personal and shared room open answers and the room-at-link answer now carry `joinCode` so a room's Open and Join can use it. The long `/meetings/<id>` address is only the fallback for a meeting with no code.

## Public

Joining or starting a meeting now opens its short nine-digit address straight away, such as /meeting/482-917-305, rather than a long one that changed after the room opened.
