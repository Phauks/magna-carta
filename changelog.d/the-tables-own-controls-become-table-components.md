---
category: Changed
audience: internal
---

**The controls a table's control row and counts strip are made of are now table components, and the
count of hand-built copies they replace is the argument.** The clear-filters control was built
**seven times in three shapes**; the labelled figures strip **five times**, one of them already
reading in the opposite order; the load-more control **three times in two places**, one of them
below the strip entirely where it read as an act on the page rather than on the list. All twelve
grid consumers assembled the footer's trailing area through the one escape hatch it had.

**`DataTable.GridFigures`** owns the arrangement and never the formatting: label first, figure
second, tabular, `·` between, and "In view:" before the first one under a filter — because a total
that silently changed meaning when a column was filtered is the most quietly wrong thing a footer
can do. The value arrives as text, since money, durations and counts each format through their own
home and a strip that took minor units and a currency would have to learn all three. The Bills
register's reversed label/figure order is corrected in the move.

**`DataTable.ClearFilters` is two acts and says which.** Column filters alone read "Clear Filters";
a surface whose own search or scope is also holding rows back reads "Show Everything", because
clearing a search under a button labelled Clear Filters is a lie about what the press will do.
Neither is configured — both are derived from what is actually narrowing the view. Its `grid` is
optional, since a surface can be narrowed before its grid exists.

**`DataTable.LoadMore` says the noun** — "Load more matters", not "Load more" — and leaves when
there is nothing more, on the same rule every control that undoes a state follows: absence is the
answer, never a disabled control.

**Two owner placements, recorded as rulings.** The clear control lives in the control row above the
table, where the filters were set (`L42b`, revising L42's footer placement; `TB2c` for the time
surfaces, where TT2 had already put it there). The undo and redo pair lives in the footer on every
surface that has a stack (`A15c`, `TS9`) — the Time Sheet's toolbar pair moved down to join the
worked / billed / value figures. The footer's inline "Show all" stays: it is part of the tally
sentence, not a control in a control row, and the two are different things.

What is left in a surface's own hands is what genuinely belongs to it: the file manager's scale
control and File Analysis's own acts still ride the footer's `extras` slot, which is the slot
working as designed — one escape hatch at the end of a declared order, rather than a declared order
that exists nowhere.
