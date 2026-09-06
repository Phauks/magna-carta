---
category: Added
audience: public
---

**The day the week begins on is a firm setting.** The owner's ruling on the calendar's first slice: the week is the unit a firm plans in, so which day it begins on is the firm's decision, never a personal preference. `packages/calendar/src/settings.ts` holds it over the per-firm setting table (`calendar.weekStartsOn`, Sunday by default); `GET /api/v1/calendar/settings` reads it for every member who can read the calendar and `PATCH` moves it under `calendar:manage`, audited and idempotent, with the contract and the client regenerated. `CalendarView` reads it once with the rest of its context and hands it to every grid, so no surface picks a week start of its own.

Settings › Practice › Calendar is the page, and it is the first settings page with a server behind it: a draft that keeps the shape the shared rows and footer already understand but answers from the firm's own read and saves through the route, never through local storage. It shows no per-browser history, because a ledger in one browser would misstate a firm-wide fact; the record is the audit row. The standing rule is in `docs/conventions/design-corrections.md`.

## Public

**Your firm chooses the day its week begins on.** Every calendar in the firm, the firm's own and every matter's, now begins its week on the same day: Sunday unless an administrator changes it to Monday under Settings › Calendar. It is the firm's setting rather than each member's, so "next week" means the same seven days to everybody. Changing it moves the columns, never the dates, and the change is recorded.
