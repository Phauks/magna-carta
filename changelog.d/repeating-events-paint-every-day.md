---
category: Added
audience: public
---

**Repeating events, painted and changed one day at a time.** `GET /api/v1/calendar/series` returns the
repeating settings that touch a window, each with the days inside it that it falls on, worked out
from the stored RFC 5545 rule at read time and never stored; a day changed on its own is left out of
its series. `POST /api/v1/events/{eventId}/occurrences` and `POST /api/v1/firm-events/{firmEventId}/occurrences`
change or cancel one day (`this`, written as its own event naming the series and the day it replaces,
on the existing `recurrence_parent_id` and `recurrence_occurrence_on` columns) or that day and every
later one (`following`: the series ends the day before and a new one starts carrying the change and
the rest of a count). No migration. The grid marks a repeating entry with a repeat sign, the entry
window opens on the day pressed and asks how far a change reaches, and the record form's Ends answer
is three rows (Never, After N times, On a date) with the day of the last one named under them.

## Public

**Repeating events show on every day they fall on.** A weekly status conference now appears on each
of its Tuesdays, not only the first. Changing or cancelling one asks whether you mean this event only,
this and all later events, or all events in the series, and the repeat form now names the day the last
one falls on.
