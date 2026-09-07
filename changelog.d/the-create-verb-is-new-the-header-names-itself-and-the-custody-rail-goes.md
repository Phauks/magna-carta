---
category: Changed
audience: internal
---

**Three corrections from a walk of the deployed app.**

**The calendar makes things with New, like everything else.** The firm calendar's primary action was a hand-built dropdown reading "Record" — the product's one create control, re-implemented under a different verb — and it is `CreateControl` now, reading the bare "New" over "New Event", "New Deadline" and "New Firm Event". The matter's own calendar section had the same mislabel from the other side: it read "New Event" over a menu that also records a deadline. A control that opens a menu reads the bare "New" and the items carry the nouns; the section registry says which sections those are (`CREATE_SEVERAL_KINDS`), so the label does not change under the reader as the page mounts. Each kind wears the glyph it already wears wherever it is named — a calendar, a clock, a building — rather than a second choice made per menu. The gate that refuses a rival create button never walked the calendar's routes, which is how the hand-built one survived; it walks them now.

**The header's controls name themselves on hover.** Notifications, Time Sheet, Downloads, Build Information — one name each, through the design system's Tooltip. Three of the four had no hover text at all and the fourth explained what pressing it would do, so four controls in one band read as four kinds of thing. Where the control is already a popover's trigger the two share one button: `Tooltip.Trigger` now takes bits' `child` snippet, which app code could not reach before because bits-ui is importable only inside the design system.

**The custody register is one table at the full width.** The container tree down its left side is gone. It narrowed to a whole branch — a subtree read no column filter over loaded rows can express — and that did not pay for making this register read as a different kind of table from every other one; Location was already a set-filtered column, narrowed from its own header the way Status is. The server's subtree read stays in the API, and the holdings-by-location report stays with it, for the custody reports.
