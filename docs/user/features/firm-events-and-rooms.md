# Firm events and rooms

_Firm events are recorded and read on the firm calendar. Resources and bookings are built and are
the room grid, the Rooms tab on an event, and the catalog under Settings are live._

## What it does

Not everything on a law firm's calendar belongs to a case. The firm meets, trains, closes for
holidays, and reserves its own rooms and vehicles — and those entries live on the one firm calendar
beside the hearings and deadlines, without being pinned to any matter.

**A firm event** is a meeting, an office closure, a training session, a firm holiday, or a
reservation. It takes the same shape a case event does — a date, an optional time, and the time
zone it happens in — plus one thing a case event never needed: an **audience**.

**A resource** is something bookable the firm owns: a conference room, a pool car, the video rig, a
projector. **A booking** puts a resource against an event for a window of time.

## The audience: who sees it on their calendar

Every firm event is visible to everyone at the firm — that is what makes it a firm event. The
audience decides whose _personal_ calendar it lands on:

- **All members.** A firm holiday, an office closure, an all-hands. It is on everyone's calendar
  automatically — including whoever joins the firm next month. Nobody maintains a list, so nobody's
  list goes stale.
- **Participants.** A committee meeting, a training session with a sign-up. It is on the calendars
  of the people listed. Participants work exactly as they do on a case event: somebody under
  **Staff**, a contact from your **Directory**, or **Other** — a visiting speaker you will never
  need a directory record for.

One person's own appointment is a firm event with an audience of one, and the form says it in one
choice: set the first line to **a staff member** and pick the colleague, and the event lands on
their calendar and nobody else's.

## Recording a firm event

On the firm calendar, **Record** then **New Event**, and set the first line to **the firm** — or to
**a staff member**, for one colleague's own appointment. There is one event form, in four tabs, and
that line is what decides whether you are recording a case setting, a firm one, or one person's.
Give it a title, a date, and a time zone. The event usually happens at one of your offices, so on
Where you can pick the office — which also tells the calendar which rooms are nearby — or type a
venue for an offsite. Classify it from the same type list case events use; the shipped list includes **Firm
meeting**, **Training**, **Office closure**, **Firm holiday**, and **Reservation**.

**Repeats** asks whether the meeting is a series. Most firm meetings are: a weekly stand-up, a
partners meeting every second Tuesday, a quarterly review. Set the cadence, the days, and where it
stops, and the form reads the rule back to you in words before you save it. It is one record with a
rule on it, not one record per date — see
[Case calendar and deadlines](case-calendar-and-deadlines.md) for the whole of how a repeat works,
which is the same on both kinds of event.

A moved staff meeting is just an edit: change the date, and the audit trail carries the move.
Cancelling keeps the record, with an optional note saying why.

## Booking a room, a car, or anything else

**The room a setting is HELD in is booked by the Location field, not from here.** Choose one of your
conference rooms as the location and it is held for the event's window; change the location and the
booking follows. This section is for everything else: a second room, a pool car, a projector — and
for seeing and releasing what an event already holds, on its **Rooms** tab.

A booking always belongs to an event — the room is busy _because something is happening in it_.
Book the conference room for a deposition, the pool car for a site visit, the video rig for a
hearing. Want the car on Friday with no particular occasion? Record a **Reservation** firm event
and book the car against it; the reservation is the occasion.

- **The booking's window starts as the event's window and can differ.** Book the room from half
  past eight for a nine o'clock deposition, because somebody has to set up.
- **One event can book several resources** — the room, the rig, and the car all at once.
- **The room's schedule keeps the room's own time.** A booking is recorded in the time zone of the
  resource's home office, fixed when the booking is made.
- **Cancelling the event frees the room. That is the whole procedure.** A booking blocks a resource
  only while its event is still on. There is no separate release step to remember, and no way for a
  cancelled meeting to keep a room hostage.

## Double-booking: the platform warns, you decide

If a booking overlaps another, **the booking still goes through** — and the overlap is reported
back immediately, shown on the room's schedule, and visible from both bookings.

That is deliberate. Firms double-book on purpose: a tentative hold while a deposition date firms
up, two small groups sharing the large room, the partner who bumps the staff meeting. The front
desk resolves rooms; software that refuses to record your actual intentions gets worked around with
a whiteboard. And a taken room must never be the reason a hearing cannot be recorded.

The room grid shows each booking's window and what kind of thing booked it — "Booked —
Deposition" — never the matter or the title. What a booking is _about_ stays behind its own link,
under the same access rules as the event itself.

## The resource list

Add resources with a name, a kind (room, vehicle, equipment, or other), a home office, and — for
rooms — a capacity. Capacity is shown when picking a room so a person can judge the fit; the
platform does not refuse a twelve-person meeting in a ten-seat room.

Retire a resource when the room becomes storage: its history and its existing bookings stay, and it
simply takes no new ones.

## Tips and edge cases

- **Firm events never appear on a matter's timeline.** They belong to no case, so a case's history
  never shows them; they appear on the firm calendar, interleaved with everything else.
- **The firm calendar can be narrowed to just firm entries, or just case entries,** as well as by
  kind, member, and date window.
- **An offsite in another time zone** works like a hearing in another court: record the event in the
  zone where it happens.
- **Reading the calendar and managing it are the same two permissions as case events.** Everyone
  can see the firm calendar; recording events, curating the resource list, and booking rooms is the
  calendar-management capability.

## Related features

- [Case calendar and deadlines](case-calendar-and-deadlines.md) — the case-side half of the same
  calendar.
- [Continuing a hearing](continuing-a-hearing.md) — a continued hearing releases its rooms
  automatically, so the new setting can book them afresh.
