---
category: Changed
audience: public
---

**The calendar screen: one View menu, the date as its heading, and three firm calendars.** `calendar-toolbar.svelte` leads with the arrows and the window's name as a heading that opens `MonthJump` (new in `@magna-carta/design-system/calendar`, beside a `compact` density of `Calendar` that the rail's month now uses), and ends with Today and one View menu carrying the views, the week and day's concurrency choice and the agenda's Hide settled. The Kinds filter and `schedule-narrowing.ts` are removed. `calendar-sources.ts` splits the firm's records into `caseSettings` and `deadlines` sources, each with its own read in `calendar-reads.ts`; every rail name is Title Case. `CalendarGrid.Month` keeps its caption for assistive technology only when it has nothing to say, so a month that fills its host no longer overflows it by the caption's line. `formatMonthName` joins the civil-date formatters. Deadline sources read "Court Order" and "Firm".

## Public

**The calendar is easier to read and to move around.** The month you are reading is now the heading over the calendar; press it to jump to any month. **Today** and a single **View** menu sit at the top right. The firm's calendars on the left are now **Case Settings**, **Deadlines** and **Firm Events**, each with its own colour and tick, which replaces the separate Kinds filter. The small month under the list is smaller, has its own arrows, and picks a month from a grid instead of a dropdown. The month view shows only the weeks the month needs and no longer scrolls when there is nothing more to see. A deadline's Source now reads **Court Order** or **Firm**.
