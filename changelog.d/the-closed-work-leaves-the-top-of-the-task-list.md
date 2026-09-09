---
category: Changed
audience: public
---

**The tasks screen's Done and Cancelled boxes move below the list, and its search and New Task move
into the screen header.** `TaskList` stopped deciding where its own controls sit: it renders the
search, the create control and the clear into a `screenHeader` snippet its host provides, so
`/tasks` seats them in the masthead's action row — the position every other main screen keeps them
in — while a matter's Tasks section, which has no masthead of its own, still draws the row under its
heading. What is closed is asked for at the foot of the list by two controls that name their own
undo, so nothing over the rows competes with the search for the row a reader searches from; the
clear control is now `DataTable.ClearFilters` rather than a seventh hand-rolled funnel, and it
speaks for the search alone, because asking to see done work widens the list rather than narrowing
it. The create control also stops being swapped out for Cancel while the composer is open — it holds
its place in the row, per the design system's own rule, and abandoning a draft is asked for in the
draft.

## Public

**Tasks looks like every other screen, and the finished work is out of the way.** The search box and
**New Task** are at the top right of the Tasks screen, in the same place as on Matters, Directory and
Custodian. The **Done** and **Cancelled** tick boxes that sat above the list are gone: below the
list, past everything you still owe, **Show Done** and **Show Cancelled** bring the closed work in
when you want it, and read **Hide Done** and **Hide Cancelled** while it is showing.
