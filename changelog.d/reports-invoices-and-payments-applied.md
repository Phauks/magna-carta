---
category: Added
audience: public
---

**Two financial reports: Invoices and Payments Applied.** Billing owns two new reads over records it already holds (`readInvoiceRegister`, `readApplicationRegister` in `packages/billing/src/queries.ts`); `packages/reporting/src/financial/` adds them into bills, clients and offices; `GET /api/v1/reports/invoices` and `/payments-applied` serve them on `reports:financial`, over a period and an optional knowledge instant. A bill's unpaid figure is proved equal to the as-of aging's. The reporting package's purity scan now allows zod in `src/contract.ts` only. The master list behind the order these are built in compares every LEAP and Clio report with what Magna Carta has.

## Public

Two new reports under Financial. **Invoices** lists the bills issued in a period with what was billed, credited, applied and still unpaid at the end of it, by office and client. **Payments Applied** lists every payment, transfer from trust, credit and write-off set against a bill, with any reversal on its own line.
