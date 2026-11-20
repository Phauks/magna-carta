---
category: Changed
audience: public
---

**An open calendar reads its window again every 30 seconds while in view, and at once when the reader returns to the tab.** The shared timer moved from the trust reconciliation screens to `apps/web/src/lib/screen/live-read.ts`, and `CalendarView` uses it with a longer interval.

## Public

The calendar now updates by itself. A change a colleague makes, or one you make in Outlook or Google, appears without reloading the page.
