---
category: Added
audience: public
---

**A Daily Time report.** `GET /api/v1/reports/daily-time` (`reports:productivity`, live) lists the minutes recorded on each day of a period, per timekeeper, billable against non-billable, with each timekeeper's total and day count. Timekeeping's new `readTimeRecordedByDay` takes the same entries as the productivity breakdown through one shared predicate (`TIME_RECORDED_IN_PERIOD` in `packages/timekeeping/src/productivity-statements.ts`), and `packages/reporting/test/productivity-daily-time.test.ts` proves its totals equal Timekeeper Productivity's.

## Public

A new Daily Time report shows how many hours were recorded on each day, and by whom.
