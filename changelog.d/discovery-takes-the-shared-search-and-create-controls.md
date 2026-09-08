---
category: Changed
audience: public
---

**Discovery's three screens now carry the product's own search and create controls.** The register,
a review set's document list and its Loads screen each shipped without `ScreenSearch`, and Loads
carried a button per act — "New Custodian of Record" beside "New Load" — which is the shape the
standing list-screen ruling names outright: one primary action with a menu, at the end of the action
row, never a button per variant. The two are now one `CreateControl` reading the bare "New", each
choice carrying its own refusal so a member who may load but not manage sees why the other is shut.

The match rules moved into the design system rather than into three screens:
`data-table/grid-search.ts` (`gridRowMatchesSearch`, `gridRowsMatchingSearch`) is the catalogue's
grammar — every word must match, anywhere inside a word, case-insensitively — applied to the text the
column model RENDERS, so a query reaches the state word a reader can see rather than the enum under
it, and every declared column is searched whether or not the reader has it on screen. It sits beside
`grid-columns`, `grid-filters` and `grid-rows` and is pure, so a screen wires it through the grid's
`rows` thunk and holds no matching logic of its own.

Nothing on the server moved: no discovery listing takes a `search` parameter, so each of these
narrows the rows already read, which is the scope the grid's column filters already run at. The
document list says so from the control's own panel, because keyword search of a document's TEXT is a
different question, still `soon` in `criteria.ts`, and composes into the search index rather than
into this list — a reviewer who believes they searched a corpus and searched a page of it is the
mistake this surface can least afford. Loads' "Each Load" panels now follow the table rather than the
read, so a narrowed list does not sit above panels for the deliveries it just filtered out.

## Public

**You can search on every discovery screen now, the same way you search everywhere else.** The
magnifier sits in the row above the table on Discovery, on a review set's Documents and on its Loads.
Type and the list narrows; the X or Escape clears it; "Show Everything" brings back what a search and
a filter were both holding out.

On Documents it searches what the rows show — a document's name, its path, its format, whose records
it is, which delivery it arrived on — over the documents already on the list. Searching the words
INSIDE your documents is Keyword, in the Narrow control, and it is still waiting on the search
engine; the search field says so when you open it, so the two are never confused.

**Loads has one New control instead of two buttons.** New Load and New Custodian of Record are now
choices under it, in the same place every other screen keeps the way to make something. If one of
them is not available to you, it says why rather than disappearing.
