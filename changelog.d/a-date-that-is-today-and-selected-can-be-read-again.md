---
category: Fixed
audience: public
---

**A day that was both today and the selected day rendered as its own foreground colour on no background at all.** `date-range-picker.css` declared its band states as bare `.mc-calendar-day[...]` selectors, and `components.css` imports it after `calendar.css` — so at equal specificity and later source order, the range picker's `[data-today] { background-color: transparent }` beat the plain calendar's `[data-selected]` fill on every calendar in the product, while selection's near-white foreground survived. White text, white surface. The range picker's rules are now scoped to a `.mc-date-range-calendar` class the popover carries, and `calendar.css` marks today with an inset hairline ring and a heavier numeral rather than a fill, so today and selection compose instead of one erasing the other.

Outside-month days now carry a wash on the cell rather than only paler text: the small month under the calendar rail draws six fixed weeks, so as many as eleven of its days belong to a neighbouring month, and colour alone left the reader counting columns to find where the month began. A new dev-only gallery at `/developer-console/calendar-day-states` holds every day state on one screen — including the today-and-selected pair, which was previously reachable only on the one day a month it happens, which is why it survived every review. `packages/design-system/test/calendar-day-states.test.ts` pins the scope, the declaration order, and the wash; a jsdom render could not have caught any of it, because the defect lived in the cascade rather than in any one declaration.

## Public

**The date you are looking at is legible when it is also today.** Picking today in a calendar used to blank the date out entirely — the number was drawn in the highlight's own colour with the highlight missing. Today now wears a thin ring and a bolder number, so it stays visible whether or not it is the day you have chosen.

**The small calendar shows where the month begins.** Days that belong to the month before or after are now shaded as a block rather than merely printed in a lighter grey.
