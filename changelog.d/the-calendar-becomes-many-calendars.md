---
category: Added
audience: public
---

**The calendar's sixth round: many calendars in folders, a day of columns, and a form that asks where.** The owner walked the deployed calendar and issued eleven corrections; this is all of them, and the rulings are in [`docs/conventions/design-corrections.md`](docs/conventions/design-corrections.md).

The firm calendar stops being one undifferentiated grid. A CATALOG of individual calendars (`apps/web/src/lib/calendar/calendar-sources.ts`) stands over what the calendar context already read: the firm's own two (matters and deadlines, firm events), a folder per role the firm handed out holding the members who hold it, the rooms, everything else that is booked, and the dates. Each row turns on and off on its own; each folder's own control carries the third state and completes a part-filled folder. The folders are the firm's own vocabulary — nothing here decides who counts as support staff — and a member holding two roles is filed under the first, because a calendar listed twice reads as two calendars and toggles as one. File-destruction dates are listed, marked Soon and refused, because a retention schedule is the one date calendar nothing serves yet.

**A calendar that is on is a read; a calendar that is off is no read at all.** The read plan is a plan per calendar (`readOneCalendar`) rather than one read narrowed afterwards: a member calendar is the member filter the server already resolves in SQL, a room calendar is the availability read, a date calendar is the federated read narrowed to that layer's own sources. The reads are made together, fail independently, and a failure now names WHOSE calendar it was. The same record arriving from two of them is merged into one row that knows it is on both.

**`CalendarGrid.Day`** is the fourth presentation and the only one with a time axis: an hour per row, a CALENDAR per column, which is what makes a Tuesday six attorneys spend in four places legible. A record on two calendars is drawn in both their columns on purpose. An entry with no hour sits in a band above the hours, where a filing belongs. The hours are the working day, widened without asking by anything outside it.

The firm-wide federated read carries **the hour**. `TimelineEntry` gains `timeOfDay` and `timeZone`, declared per source (`timeOfDayExpression` on the two select builders) and set on matter events, deadlines and firm events. It is the same class of fact as the sort key — when a thing happens, said in the record's own terms, never converted — and it is what lets a day grid put a hearing on the ten o'clock row without the projection ever naming it. Before this the firm calendar painted no times at all.

**One palette, one home.** The eleven colours the file manager's folders offer moved to `packages/design-system/src/lib/palette/`, with their fills as `--mc-palette-*` on `:root`; `FOLDER_COLORS` re-exports them unchanged and the folder recipe aliases the shared properties. A calendar offers the nine that read on a chip, and wears its colour as a rule down the chip's leading edge — the status register keeps the fill, so a cancelled setting on the blue calendar is still visibly cancelled. `PaletteSwatches` is the one control both surfaces pick from. An unchosen calendar is dealt a colour by position.

**Double-clicking an empty day or hour** starts a record on it, with the day and the hour as the form's opening answers. It is an accelerator, never the only path, and it never fires from a press on a chip.

The record forms change with the same round. **Where is Location**, and it is the product's dropdown-with-add over the firm's own offices and rooms, still keeping a courthouse nobody has a record of. **A conference link** is its own field and its own column — a nullable `conference_url` on `matter_event` and `firm_event` — because a deposition can be in a conference room and on a call at once. **The times are time fields** with the zone beside them as a shortcode, worked out on the record's own day (`formatTimeZoneAbbreviation`, in the design system's display vocabulary); a record has one zone, so the ends line states the same code rather than offering a second control. **The day being booked stands in the panel's context pane**, as the product's own calendar with a day view and no toolbar. And **the matter is no longer required**: no matter is a choice whose row says what it writes, and the form writes a firm event instead — which is the shape the data already had.

Two lines come off. "A matter is needed." is gone with the requirement. "Nothing recorded in September 2026." is gone from every grid: a month that is empty says so by being empty. The agenda keeps its sentence, because an empty list is a blank rectangle.

## Public

**Your calendars, in folders, each in its own colour.** The calendar now lists every calendar your firm has down the left: the firm's own matters and deadlines, its events, each attorney and each of your support staff under the role they hold, every conference room, and the date calendars. Tick one to add it to the grid, or tick a folder to add everyone in it. Give any of them a colour — press the dot beside its name — so you can tell one person's day from another's at a glance.

**A day view, with a column per calendar.** For a day when several people are in several places, press **Day**: the hours run down the side and each calendar you have turned on gets its own column, so two things at ten o'clock stand side by side and a free afternoon is visible as a gap.

**Start a record by double-clicking.** Double-click an empty day on the month, or an empty hour on the day, and the event form opens on it.

**The forms ask better questions.** **Location** offers your own offices and conference rooms and still takes anything you type, for a courthouse or opposing counsel's. A **Conference link** field holds the Zoom or Teams link for a setting held on a call. Start and end are proper time fields, with the time zone beside each as a shortcode — PST, EDT — rather than a long name. And while you are choosing a time, **that day's calendar stands beside the form**, so you can see who is already busy.

**An event no longer needs a matter.** Leave the matter blank and the form records it as a firm event instead.
