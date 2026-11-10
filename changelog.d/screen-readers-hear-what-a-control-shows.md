---
category: Fixed
audience: public
---

**Screen readers and voice control now hear the words a control shows.** Several controls were
named in a way that left out what was printed on them, so a person using voice control could not say
the label they saw. A folder in the file manager's tree is now named with its file count ("Pleadings
12 files"), the month heading of a small calendar starts with the month it shows ("June 2026, choose a
month"), and the Error ID chip on a failure band reads the ID and what pressing it does ("Error ID
err_7FQ2K9XW, copy").

**For builders.** The accessibility checker the design system's stories run under (axe-core 4.14,
arrived with the dependency refresh) now enforces `label-content-name-mismatch`, which it used to
treat as experimental, and 23 stories failed it or the changes beside it. Fixed per component rather
than by turning the rule off:

- `Tree`: the treeitem is now the row, and an open branch is the row's sibling `role="group"` inside
  a `role="none"` `<li>` (levels, set sizes and positions stay explicit). A treeitem that wrapped its
  children showed every descendant's label inside itself. `Tree` takes an optional `itemLabel` for a
  row whose `trailing` content shows text; `FolderTree` uses it for the file count. Drag marks land on
  the treeitem itself now.
- `MergeFieldPicker`'s trigger is a `combobox`, the role Bits 2.20 gave the `Select` trigger, so the
  field's label names it and the chosen field is its value. Story queries for both moved from
  `button` to `combobox`.
- `FolderTree` clips its loading placeholder instead of scrolling it, since a scroll region with
  nothing focusable fails `scrollable-region-focusable`.
- Two stories asserted more than they meant: the day-lanes story now expects the deposition held in
  two calendars twice, and the exchange story reads which side a turn sits on from its mark, not from
  the width of the member's question.

## Public

**Screen readers and voice control now say the words a control shows.** A folder in the file tree
is named with its file count, a small calendar's month heading starts with the month it shows, and
the Error ID on a failure message reads the ID and what pressing it does, so you can say what you see.
