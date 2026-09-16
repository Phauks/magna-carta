---
category: Changed
audience: public
---

**The calendar's rail folds, keeps a month in view, and the screen's name spans it.** Three corrections from the owner's 2026-09-16 pass, and one of them widened a shared component.

**A folder folds.** The disclosure is the folder's NAME — chevron and name are one button at the full width of what is left after the checkbox, the shape the application sidebar's own groups take. It is deliberately not the `Accordion` component: that component's trigger IS its whole header, and this header already holds the three-state checkbox, which cannot be nested inside a button. What folds is the LIST, not the head, so the folder's own switch stays reachable whether it is open or shut and folding hides no calendar a reader could otherwise turn on. A shut folder states how many of its calendars are on, because that count is the one fact its hidden rows were carrying. Held per browser beside the colours, and stored as a DEPARTURE like everything else in `calendar-preferences.svelte.ts`, so a folder shipped later arrives open rather than shut because a stored list predates it.

**`NavigationLayout` gained a spanning `header` and a pinned `navigationFooter`.** Both optional; giving neither leaves the DOM byte-identical for Settings, Magnus, Tools and Reports. Neither is calendar-specific — a title naming the SCREEN belongs over the whole canvas rather than over one column of it, and a rail with a picker under it is the shape of every navigation whose last element must stay in view while its list scrolls. The header sits inside the cancelled canvas inset and puts the gutter back itself; `navigationFooter` moves the scroll region and its reserved gutter off the `<nav>` onto an inner stack, because a pinned footer cannot sit inside the thing that scrolls past it. The landmark stays the `<nav>` either way, so what a screen reader announces does not change.

**The masthead spans and the date controls take its old place.** `CalendarView`'s `header` is now a plain `Snippet` that hands nothing back, and the view switch and window navigation sit at the top of the content column in every arrangement. That replaces the 2026-09-14 ruling, which seated them in the masthead's actions beside New — right while the masthead sat over the grid's own column, and wrong the moment it spanned both. One place instead of two, and no host decides.

`calendar-month-picker.svelte` rides the new footer. It moves the ANCHOR and never the view: somebody reading a week who presses a Thursday means that Thursday's week, so it calls `goToDay` rather than `showDay`, and its week begins on the day the firm chose so its columns and the grid's are the same seven days.

## Public

**Folders in the calendar list collapse.** A firm with twenty conference rooms no longer scrolls past all twenty to reach the folder underneath. Press a folder's name to fold it; the tick beside the name still turns every calendar in it on or off while it is folded, and a folded folder shows how many of its calendars are switched on so nothing disappears quietly. What you fold is remembered on that browser.

**A small month sits under the list, and it stays put.** It shows where you are and takes you somewhere else in one press — and it does not scroll away when you scroll the list of calendars. Pressing a day moves the calendar to that day without changing your view: press a Thursday while you are reading a week and you get that Thursday's week.

**The screen's name now sits across the top of the whole page**, above both the list of calendars and the calendar itself, with search and New on its line. The view switch, the arrows and Today moved down to sit directly over the calendar they move.
