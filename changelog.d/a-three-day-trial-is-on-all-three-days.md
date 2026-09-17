---
category: Fixed
audience: public
---

**A three-day trial is on all three days.** It was on the first one, and every other day it covered read as free (owner, 2026-09-16: "multi-day events are not showcasing through multiple days"). Two independent faults, either of which alone was enough to hide it.

**The READ windowed on the start alone.** `civilDateWindowConditions` compares both bounds against a source's sort column, and for an event that is `starts_on` — so a row running the 12th to the 16th was outside every window that did not contain the 12th. `spanningCivilDateWindowConditions` is the shape a spanning row needs: it starts before the window closes AND ends after it opens. `COALESCE(ends_on, starts_on)` makes a one-day row behave exactly as it always did, because its end IS its start, so the predicate collapses to the plain one for almost every row the calendar holds. Applied to the `matterEvent` and `firmEvent` timeline sources and to `selectFirmEventsStatement`. This does not widen what a source may return beyond its window — it returns rows the window always should have held.

**The TIME GRIDS placed by `entry.date === key`.** The month never had the fault, because `placeEntries` walks every day of a span; the week and the day could not use it, because a span on an HOUR axis is not the same entry repeated — it is a different piece of the day on each of its days. `day-segments.ts` cuts it: the first day runs from the start hour to midnight, a day in the middle is the whole column, and the last day runs from midnight to the end hour. Each piece carries its own id, because two pieces of one record are two things to render and a grid keyed on a repeated id drops all but one, and `continuesBefore` / `continuesAfter` are what let a block reaching the top of a column say it began yesterday rather than at midnight.

All-day entries never reach that module: they have no `startMinute`, they belong in the band above the hours, and both time grids already banded and spanned them correctly.

## Public

**An event that runs for several days now shows on every one of them.** A three-day trial, a week of office closure, a two-day deposition — each used to appear only on the day it started, so the days after it read as free when they were not.

On the **month** they paint across the days they cover, as they did before. On the **week** and the **day**, where the hours run down the side, each day shows the part of the event that falls on it: the first day from its start time to midnight, a day in the middle filled, and the last day from midnight to when it ends. That is what "in court until Wednesday afternoon" looks like on a calendar.

**All-day events sit in a band above the hours**, on both the week and the day, rather than at midnight — a filing has no hour, and parking it at the top of the column implied one.
