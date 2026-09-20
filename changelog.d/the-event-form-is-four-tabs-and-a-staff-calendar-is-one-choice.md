---
category: Changed
audience: public
---

**The event form is four tabs, a staff member is an owner, and a zone reads as one line.** The
owner's round of 2026-09-18 on `apps/web/src/lib/calendar`. `record-event-dialog.svelte` renders
Details, When, Where and Who over `EVENT_FORM_TABS` in `event-draft.ts`; its Belongs to is the
product's one closed-choice field with three owners, and the staff arm is `withMemberListed` — a
firm event with the people-listed audience and that member first. The second field on that line is
one slot, so the choice no longer reflows the form. `readsAsAllDay` / `asAllDay` are the All Day
switch's reading. The design system's `inAllDayBand` (`day-axis.ts`) sends a run of days to the
band above the hours; `day-segments.ts` no longer cuts a span into per-day pieces, which is what
drew a trial across every hour and gave each piece an id no press could open. `formatTimeZone` and
`describeTimeZone` join the display vocabulary (`formatters/instant.ts`) as the one line every zone
reads as, on the record's day; `time-zone-options.ts` orders the rest west to east and searches a
haystack, and `formatWallClock` prints the code beside an hour. `location-picker.svelte` offers the
offices with their addresses (the calendar context reads `listOffices` whole), the rooms, and the
directory's organizations through `directoryPickerSearch`. `participantsBySource` bundles the
chips. `calendar-menu.svelte` is the rail's selection as a dropdown, drawn by `CalendarView` on
`calendarMenu` for the day pane. Every self-clearing picker passes `allowDeselect={false}`, which
is what emptied the matter field on a re-pick. `DISCARD_SENTENCE` is gone from the action dialog.
The design system's `Tooltip.Provider` defaults `ignoreNonKeyboardFocus` on, so the focus a
closing popover hands back to the header's button no longer opens its tooltip.

## Public

**The event form is easier to fill in, and a colleague's calendar is one choice away.** The form is
now four tabs — Details, When, Where and Who — and its first line offers a matter, the firm, or a
staff member, whose own calendar the event lands on; the field beside that choice stays put
whichever you pick. All Day is a switch. A setting that runs across days, such as a three-day
trial, is drawn in the all-day band at the top of the week and the day, spanning its days, rather
than across every hour of each. Every time zone reads the same way — "(UTC-08:00) Pacific Standard
Time · Los Angeles" — in the list, in the field, on the record and on a printed sheet; the list runs
west to east; and typing PST, pacific or los angeles finds the same row. An hour on the calendar
carries its zone's code. Location offers your offices with their addresses, your rooms, and the
organizations in your directory, and keeps an address you type. The people on an event are listed
under Staff, Directory and Other. The day shown beside the form has a Calendars menu, so you can
check one attorney's afternoon or one room's day before choosing a time. Picking the matter already
chosen no longer empties the field, and a form asks "Discard Your Changes?" with nothing more under
it. Closing a header panel by pressing its button again no longer leaves the button's hover text
showing.
