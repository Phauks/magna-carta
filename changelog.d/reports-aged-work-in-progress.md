---
category: Added
audience: public
---

**An Aged Work in Progress report.** `GET /api/v1/reports/aged-work-in-progress` (`reports:financial`, live) places unbilled time and costs in four buckets by how long ago the work was done (a time entry by its work date, a cost by the day it was incurred), per office, client and matter. Billing's new `readWorkInProgressByAge` reads the same entries as the work-in-progress breakdown through one shared predicate (`UNBILLED_TIME_PREDICATE`, `UNBILLED_COST_PREDICATE` in `packages/billing/src/queries.ts`), and `packages/reporting/test/financial-aged-work-in-progress.test.ts` proves the buckets add up to the Work in Progress total.

## Public

A new Aged Work in Progress report shows unbilled time and costs by how long ago the work was done, so old work that has not been billed stands out.
