---
category: Added
audience: public
---

**The calendar's third round: the room grid, bookings on an event, and the resource catalog.** `CalendarView` gains the `resource` scope: `/calendar/rooms` is the one component over `GET /api/v1/calendar/resources/{id}/availability`, a week at a time, with a picker that names the room and mirrors it into the address. A booking paints as the event it belongs to (the availability read carries a type name and never a title), takes the danger register with a "Double-booked" line where the read pre-paired it with another booking, and opens that event's window. Two small reads join the API, `GET /api/v1/events/{eventId}/bookings` and `GET /api/v1/firm-events/{firmEventId}/bookings`, over the package's existing `readBookingsForEvent`, so an event's window can list what it booked; the entry window gains a Rooms tab, a Book a Room verb (the booking takes the event's own window, lands even when it double-books, and says so) and Release per row. Settings › Practice › Rooms and Resources is the catalog: add, change, retire and restore, each an `ActionDialog` committing at once, gated on the session's `calendar:manage`.

## Public

**Rooms.** Under Settings › Practice › Rooms and Resources, name what the firm can book: conference rooms, pool cars, equipment, each with an office and a seat count. Open any event and press **Book a Room** to book one for that event's window; the event's **Rooms** tab lists what it has booked and releases any of it. If a resource is already taken the booking still lands and says so, because a room being taken must never be why a hearing cannot be recorded. **Rooms** on the calendar shows one resource's week with every double-booking marked; press an entry and the event behind it opens.
