---
category: Added
audience: public
---

**A Matter Balances report.** `GET /api/v1/reports/matter-balances` (`reports:financial`, live, no date) puts three figures on each matter, by office and client: its unbilled work (the work-in-progress report's total), what its bills still owe (the receivables aging's total, taken today), and what it holds in trust (trust's own per-leaf balance across every US-dollar account). The three are never added together. `packages/reporting/src/financial/matter-balances.ts` assembles it, `readMatterCaptions` in `packages/billing/src/queries.ts` captions the matters, and `packages/reporting/test/financial-matter-balances.test.ts` proves each column's total equals its owner's. A trust account in another currency that holds money for a matter refuses the report by name (`reporting-currency-not-reported`).

## Public

A new Matter Balances report shows, for each matter, the unbilled time and costs, what its bills still owe, and what is held for it in trust, side by side, by office and by client.
