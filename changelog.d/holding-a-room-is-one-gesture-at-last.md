---
category: Fixed
audience: public
---

**Correcting where a setting is held now moves the room booking with it.** Booking the room a location names landed at the RECORD on 2026-09-14 and was never done at the CORRECTION — so an event moved from the Boardroom to Conference Room B kept the Boardroom held and never held Conference Room B. After one edit the two room calendars disagreed with the record and with each other, and Location and Book a Room still read as two features (owner, 2026-09-16: "booking a room and location should be consolidated. remove book room feature? or better implement together?").

`reconcileRoomBooking` in `room-location.ts` is the pure answer, and what it does NOT do is the load-bearing half: it releases a booking for a room the location no longer names, books the one it now does, and touches nothing else. A pool car, or a second room somebody held by hand from the Rooms tab, was never named by this field and is not swept away by an edit to it. Where neither the old nor the new location names a room — one courthouse to another — it moves nothing, which is what makes it safe to run on every save rather than only when somebody remembered to.

It runs AFTER the record saved, because the location it reconciles to is the one that landed. A booking it could not move does not unwind the correction: the correction is a real change the reader asked for, so the window states which half did not happen and leaves the record as saved — exactly the rule the record form already keeps.

**The Book a Room verb has left the entry window's action bar.** A second control for the act the Location field performs is the duplication itself. The Rooms tab keeps the control, because a second room is a real thing to hold and nothing else can hold it, and the tab is still where what an event has booked is read and released.

## Public

**Changing where a setting is held now moves the room booking with it.** Recording an event in one of your conference rooms has held that room for a while. Editing it afterwards did not: move a deposition from the Boardroom to Conference Room B and the Boardroom stayed booked while Conference Room B stayed free, so both room calendars were wrong until somebody noticed.

Now the booking follows the Location field. Change the room and the old one is released and the new one held; change the location to a courthouse and the room is released; change one courthouse for another and nothing moves. If the new room cannot be held — somebody else has it and the booking is refused — your change to the event is still saved and the window tells you the room was not held, rather than quietly losing one or the other.

**Book a Room has gone from the buttons along the top of an event.** Choosing the room in Location is how a room is held, and a second button for the same thing was the confusion. It is still on the **Rooms** tab, where you can see what the event has booked, hold a second room, or book a car.
