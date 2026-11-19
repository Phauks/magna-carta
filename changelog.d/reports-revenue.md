---
category: Added
audience: public
---

**A Revenue report.** `GET /api/v1/reports/revenue` (`reports:financial`, a period plus an optional knowledge instant) shows what was billed and what was collected in a period, by office, by matter type and by responsible attorney. Billed is the Invoices report's billed figure; collected is payments, transfers from trust and client credits from the Payments Applied register, less their reversals, with credit notes and write-offs in a separate credited column. Matter type and responsible attorney come from a new billing read, `readMatterAttributions` in `packages/billing/src/queries.ts`, and are the matter's current values. `packages/reporting/test/financial-revenue.test.ts` proves billed equals Invoices, collected equals the matching Payments Applied columns, and each breakdown adds up to the totals.

## Public

A new Revenue report shows what was billed and collected in a period, by office, matter type and responsible attorney.
