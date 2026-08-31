---
category: Added
audience: internal
---

**The Time Sheet is ported from the owner's own surface**, which is an editable grid rather than a
table that opens a window. That distinction is the whole of it: what stood on the matter's Time tab
was a read-only ledger and a record window, and neither is a smaller version of a sheet somebody
captures a day's work in.

Rows edit in place and autosave on leaving a cell, and the leading state mark says which of saving,
saved, saved-but-incomplete, not-yet-written or failed the row is in. Undo and redo carry forty
bounded steps with split menus naming what each step was, and an undo writes the restored values
back rather than only redrawing them. Scope is Today, Yesterday or This week against the firm's own
first weekday, with a custom range that applies as it is picked — and a row just added or re-dated is
never dropped out of view. Search expands from its icon and collapses when left empty; clear-filters
exists only while a filter is in play.

**The timer is the firm's real one, not a local stopwatch.** The single-active-timer routes already
existed, so starting a second row says the first was stopped and kept its time; a row that is already
an entry takes the elapsed time onto its own duration, and a row that is not becomes the entry the
timer commits.

Nothing was simplified because an endpoint is missing. Time Code, Date Entered, Rate, Files and
Entered By render as real columns naming what they wait on, and the capture route requires a positive
duration and a narrative — so a fresh row lives on the sheet holding what is typed into it, marked
not yet written with the reason, and writes itself the moment it is acceptable.

**Two consumer defects were found by measuring rather than reading.** The record pane's field rows
broke on a viewport media query when the pane's width is a property of the window, which is exactly
what collided three labels into one unreadable run. And a Soon badge overflowed the pane by thirty
pixels in a pane that does not scroll sideways, so it was simply cut off. Both are container-width
problems and are now solved with the width the pane actually controls.
