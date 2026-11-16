---
category: Added
audience: public
---

**A Client Statement of Account, through the API.** `GET /api/v1/reports/client-statement` (`reports:financial`, a period plus an optional knowledge instant) gives one client's balance at the end of the day before the period, every bill and every application against the client's bills in it (a reversal on its own line naming what it reverses) with the balance after each, the closing balance, and the bills still unpaid at the period's end. The balances are billing's as-of aging for the client (the new `readClientUnpaidInvoicesAsOf`, over the aging's own balances), and the invoice and application registers now take an optional client so one client's rows are narrowed in SQL. `packages/reporting/test/financial-client-statement.test.ts` proves the closing balance equals the client's total in Accounts Receivable Aging and that opening plus billed less applied equals closing; `packages/billing/test/client-statement.test.ts` proves the same identity over every application kind the composers can write. The run screen has no client control yet, so the report is not listed on the Reports page.

## Public

A client statement of account (opening balance, every bill, payment and credit with a running balance, closing balance and unpaid bills) can now be produced through the API; it reaches the Reports page once its client picker is chosen.
