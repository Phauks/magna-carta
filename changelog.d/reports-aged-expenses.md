---
category: Added
audience: public
---

**An Aged Expenses report.** `GET /api/v1/reports/aged-expenses` (`reports:financial`, live) places unbilled costs in four buckets by how long ago they were incurred, per office, client and matter. It is the aged work-in-progress report over cost entries alone (`assembleAgedExpenses` in `packages/reporting/src/financial/aged-work-in-progress.ts`), and `packages/reporting/test/financial-aged-work-in-progress.test.ts` proves its total equals the costs in Work in Progress.

## Public

A new Aged Expenses report shows unbilled costs by how long ago they were incurred.
