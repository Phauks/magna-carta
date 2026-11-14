---
category: Changed
audience: public
---

**Meetings have a nine-digit address, and personal rooms an address by name.** `meeting.join_code` (nine digits, partial unique index, backfilled) and `meeting_personal_room.address_name` (the owner's first name, then first-last, then a number; backfilled) are added columns with their own CHECKs. `GET /api/v1/meetings/by-code/{joinCode}` resolves a code to its meeting through the visibility gate, the meeting summary carries `joinCode`, and the room link routes read a room by its address name only. The web room is one screen (`meeting-room-screen.svelte`) at `/meeting/{code}` and `/meetings/{id}`, which shows the code address in place; `/room/{name}` replaces `/meetings/rooms/{linkCode}`, which is gone (no redirect, at the owner's word). My Room no longer offers Get a New Link.

## Public

Meeting links are shorter and easier to read out. A meeting's address now ends in nine digits, like /meeting/482-917-305, and your own room's address is your name, like /room/trevor.
