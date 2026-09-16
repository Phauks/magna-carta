---
category: Changed
audience: internal
---

**The week and the day are time grids, and a setting is a block from its start to its end.** The owner's 2026-09-14 round on the calendar, in four parts.

**An entry stretches.** "Start and end time need to properly show themselves on the calendar, not just on the start, should stretch accordingly." The day grid used to park a chip in the row of the hour a thing began in and say how long it ran in words, on the argument that a two-pixel sliver for a fifteen-minute call is unreadable. The sliver is now answered by a MINIMUM block rather than by refusing to stretch: a block is never shorter than one that can hold a line of text, and an entry that outgrows its true duration says so by overlapping what follows it, which is the truth about a day with a fifteen-minute call in it. An entry with no end — half of what a firm calendar paints, since the federated read declares a time of day and no duration — gets that minimum rather than a guessed hour.

**The week is one.** "Week view should be taller since we can include time." It was seven civil-day cells in the month's grammar, each holding a list of chips, which answers none of what a week is read for: who is where on Wednesday afternoon, what Thursday morning still has room for. It is now the day's shape with seven columns — hours down the leading edge, a day across the top — with a band above the hours where what is true of a whole day sits, and where a multi-day run is still drawn across its days and marked at each end.

**What runs at the same time is the reader's call.** "There should be a setting to allow for overlapping events on one calendar, or showing them next to each other." Side by side divides the column between the things in a cluster, so nothing hides; overlapping steps them over one another, so each block keeps more of its width. The choice is held per browser beside the calendar colours, and offered on the toolbar only where there is an hour axis to be concurrent on — the month and the agenda are lists of days, and a list has no concurrency to present.

**The view switch and the window sit beside New.** "Move month view controls to next to the new event button." `CalendarView` hands its action row UP to the host's `header` snippet, so the screen seats the controls on the masthead's own line; a host that ignores the snippet still gets the row above the grid.

Two pure modules carry the arithmetic, asserted without a browser: `time-placement.ts` (the span an entry occupies, the clusters it falls in, the share of the column it takes) and `time-blocks.ts` (which cell it renders in, and the style that draws it there). The block lives in the DOM cell of the hour it begins in — where a screen reader reading the table row by row should meet it — and is positioned out of that cell over one hour step, so the grids stay real tables.
