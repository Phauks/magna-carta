---
category: Fixed
audience: internal
---

**An event held in one of the firm's rooms now appears on that room's calendar.** The owner: "when i set an event to be in a location, it did not populate in to that locations calendar" — and, separately, "location and booking a room seem duplicative of what should be the same functionality". They are the same defect seen from two sides.

The Location field stores TEXT, deliberately: a courthouse, a department number and opposing counsel's office are none of them records this product holds, so the picker offers the firm's offices and rooms and keeps anything else that is typed. A room's own calendar, meanwhile, reads BOOKINGS. Nothing joined the two, so choosing "Boardroom" from the picker wrote the string "Boardroom" and the Boardroom's calendar stayed empty — while Book a Room, on the event's Rooms tab, did the real thing. Two ways to say one thing, and only one of them true.

`room-location.ts` matches the location text back to an active resource of the `room` kind, and the two record forms book it. The column stays free text — nothing dangles when a room is renamed, and a place the firm has no record of is still just typed — so what changed is only that where the text does name a room the firm has, the booking is made.

The match is exact on a trimmed, case-folded name, which is what the picker actually writes. Anything looser books a room off a guess: "Boardroom 2" is not "Boardroom", and a courthouse whose name happens to contain a room's name has not booked that room.

The booking is a second write, because it needs the event's id. So it can fail after the event has landed, and the form says so rather than closing on a room somebody believes is held: the event is never unwound, and the notice names the room and points at the Rooms tab.

Still open from the same round: the wider location model the owner described — offices carrying addresses with rooms inside them, and Zoom or Google Meet as bookable places with their own concurrency ceilings — which is a spec rather than a patch.
