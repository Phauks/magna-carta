---
category: Changed
audience: public
---

**`DatePicker` is a typed date.** The segmented Bits field is replaced by one text input read through `date-picker/typed-date.ts` ("Nov 13", "11/13", "today", "fri", "last fri", "+3", month first), shown at rest in words with its weekday through the new `formatDateWithWeekday`. A refused entry keeps its text with the danger edge and the reason on hover; Escape restores, Up and Down move a day. The calendar is the design system's `Calendar` in a Popover anchored to the field. The props every caller uses are unchanged.

## Public

**Type dates the way you say them.** Every date field now takes "Nov 13", "11/13", "today", "tomorrow", "fri" or "last fri", and shows the date in words, like "Fri, Nov 13, 2026", once you move on, so you can see it landed on the right day. Up and down arrows move a day at a time, and the calendar button still opens a month to pick from.
