---
category: Changed
audience: internal
---

The version panel's three carets are one component, and a shut heading says what it hides.

The three sections each computed their own collapsed badge, and the differences had stopped being decisions. Deployment carried a count of Workers without a version and dropped the sync read entirely — so folding it hid whether the two Workers serving the app agree, which is the one fact a reader opens that section for. Workers carried the same warning with no sense of how many Workers were behind the fold. Database carried a mood, "Needs attention" or "Not working", with no count at all, so one bad row out of four and four bad rows read identically. And all three said nothing whatever when healthy, which looks exactly like a section that never loaded.

The heading is now one component every fold renders through, and all three hand it the same shape from the model: a **count** of what the fold hides, always, then a **status** pill only where there is something to say beyond the count. A count present when things are fine is what makes a quiet heading meaningful — "13 Workers" with nothing beside it is a section reporting health, where an empty heading was a section reporting nothing.

The wording changed with it. "Without a version" named the missing field rather than the condition, and reads now as "2 not reporting" — a reader wants to know the Worker did not answer, not which column is blank. The database mood becomes "1 not working" or "2 needs attention" against a "4 checks" count. Deployment's shut heading carries the sync read it used to lose: "3 parts · In sync".

`collapsedHealthBadge` and `summarizeSilentWorkers` are gone, superseded by the pill builders, along with the dead worst-reading derived they fed.
