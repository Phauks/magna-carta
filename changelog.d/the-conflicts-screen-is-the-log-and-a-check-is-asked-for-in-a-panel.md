---
category: Changed
audience: public
---

**The conflicts screen is the log, and a check is asked for in a panel.** `/conflicts` opened on the
composer: a matter picker, then the whole scope form — parties, sources, band, three edge budgets,
two caps — and only then, below the fold, the list of what the firm had actually run. That put a form
almost nobody was filling in that visit in front of the record almost everybody came for, and it made
the run control something a reader scrolled to rather than reached for.

The screen is now the List archetype it always was: one table at the full width over
`GET /api/v1/conflicts/checks`, cursor-paged with a load-more, and narrowed from its own column
headings — Run, Trigger, Asked By, Against, Band, Floor, Depth (hidden by default) and Candidates.
Running a check is the create act performed over that log: **New Check** at the end of the header's
action row, the design system's one `CreateControl`, opening the product's one `ActionDialog`.

The form did not change; it moved. `check-runner.svelte` became `check-form.svelte` — the fields and
nothing else, handing back the request it composes (or null with the reason it cannot yet) so the
panel owns the commit, the busy state and the failure band. `new-check-dialog.svelte` is that panel,
and it is the same panel from both doors: opened from the firm's log it asks which matter, opened
from a matter it states the matter and asks nothing about it. The matter's own Conflicts section
therefore stopped carrying a second copy of the composer, and its header's New Check now opens the
panel instead of scrolling the reader to a heading.

Two things the register deliberately does not do. It has no Matter column: a check summary carries
the matter's handle and no name, and the matters listing has no read that takes a set of handles, so
the column would be one request per row — what it can say honestly from the summary alone is whether
the search was filed against a matter at all, which is the pre-engagement screen told apart from the
engagement one. And no column is a conclusion: `apps/web/test/conflicts-check-columns.test.ts` pins
that, along with the three-way answer to who asked — a member, `Run automatically`, or a row written
before the trigger source existed, which must not collapse into the second.

**And a check a person asked for now says so on the row.** `POST /api/v1/conflicts/checks` — the
route behind every deliberate run — never set `triggerSource`, so the check was stored with none at
all: the shape of a row written before the column existed. On the old surface that was one muted line
in a list; on a register with an Asked By column it is the column, reading "the row does not say what
started it" beside an actor the same row does in fact name. That is a third and worse claim than
either honest one. The route now passes `triggerSource: "manual"` — which `runConflictsCheck` already
recognized, and which the re-check route beside it has always sent — and
`apps/api-worker/test/conflicts-routes.test.ts` asserts it. Nothing else moves: a null source already
suppressed the announcement, and "manual" suppresses it for the stated reason (the person who asked
is looking at the result).

## Public

**Conflicts Check now opens on your firm's record of checks, and New Check is at the top right.**

The screen used to open on a long form, with the list of checks your firm had run pushed below it.
Now the list is the screen: every check across every matter, newest first, saying when it ran, what
set it going, who asked, whether it was filed against a matter or against parties named before a file
existed, how wide it searched, whether your firm's floor widened it, and how many candidates came
back. Narrow it from any column's own heading and clear that from the control beside New Check.

A check you ran by hand now says on its row that a person asked for it, and names them; before, the
row could only say it did not know what started it.

**New Check** at the top right opens the form in a panel — which matter if any, the parties, what to
search, how far — and nothing runs until you press Run Check. The same panel opens from **New Check**
on a matter, with the matter already filled in, so the matter's Conflicts tab now leads with where
that matter stands instead of with a form.
