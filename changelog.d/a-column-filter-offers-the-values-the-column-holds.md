---
category: Fixed
audience: public
---

**A text column's grid filter is the set of its values, and a date filter's calendar stays inside the column's menu.** `gridColumnFilterKind` now defaults a text column to `set`; the contains box survives only for a declared prose column (the time and fee ledgers' Description). The set filter's one select control acts on the choices listed once the narrow field is in play (`facetSelectionAfterToggleValues`). The design system's submenu wrappers keep focus in a popover, select or combobox list as focus inside the field (`context-menu/menu-field-layer.ts`), which needed `patches/bits-ui@2.18.1.patch` to also wrap the focus-outside event so `preventDefault()` is honoured — a focus event is not cancelable, so Bits' documented route was a no-op. The file manager's Name, From, To and File or Folder, the upload's Name and the conflict hit's Party move to the set.

## Public

**A table's date filter can be set from its calendar, and a text column's filter lists the values to choose from.**

Opening the calendar on a Date filter closed the filter with it, so the dates disappeared the moment they were reached for and could only be typed. The calendar now opens inside the column's menu and stays there until a day is picked.

A text column — the changelog's From, To and File or Folder, a file's Name in every view, and every other text column on every table — used to offer a box that matched whatever was typed, which is a search, not a filter. It now lists every value the column holds, each with a checkbox and a count, so there is a baseline to choose from; the field above the list narrows it, and the one select control acts on what is listed, so a long list is narrowed to the values that match a word and taken in one press. Columns of prose, such as a time entry's description, keep the box that matches text.
