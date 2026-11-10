---
category: Changed
audience: public
---

**One field for a day and a time.** The design system's new `DateTimeField`
(`@magna-carta/design-system/date-time-field`) holds a day, a time of day, or both: the parts are
typed into one box, and its button opens one panel with the month beside a list of times, or only
the half the field asks for. The list steps every fifteen minutes but the field takes any minute, and
an off-step time is listed in its place (`time-choices.ts`). `formatWallClockTime` joins the display
vocabulary for a time with no day or zone. The calendar's event form uses it for Starts and Ends,
replacing a date picker beside the browser's time box and the All Day checkbox, which is now the
Starts list's first row. `withStartsOn` and `withStartsAtTime` (`event-draft.ts`) carry the start
date to the end and put a new end an hour after the start.

## Public

**Choosing when an event happens is quicker.** Starts and Ends on the calendar's event form are now
one field each, holding the day and the time together. Press the arrow at the end of the field to
pick a day from the month and a time from the list beside it, or type straight into the field. Any
minute works, not only quarter hours. The end date now starts out the same as the start date, and
picking a start time sets the end an hour later, so a one-day meeting takes one answer. **All day**
is the first choice in the Starts list of times.
