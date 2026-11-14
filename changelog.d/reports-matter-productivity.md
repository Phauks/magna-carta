---
category: Added
audience: public
---

**A Matter Productivity report.** `GET /api/v1/reports/matter-productivity` (`reports:productivity`, live) lists the minutes recorded on each matter in a period, billable against non-billable, with each timekeeper's minutes on it, the matters with the most time first. It adds up timekeeping's own productivity breakdown, the read Timekeeper Productivity uses, and `packages/reporting/test/productivity-matter-productivity.test.ts` proves its totals equal that report's.

## Public

A new Matter Productivity report shows how many hours were recorded on each matter, and by whom.
