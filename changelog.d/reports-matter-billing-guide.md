---
category: Added
audience: public
---

**A Matter Billing Guide report.** `GET /api/v1/reports/matter-billing-guide` (`reports:financial`, live) lists every open and held matter with the fee agreement governing the UTC day it is produced, any amendment already recorded to start later, and the matter-tier and client-tier rates in force on the firm's unarchived rate cards, and counts matters by kind of agreement with "None recorded" beside them. The agreement is billing's own read (`readBillingArrangementsOnDate` in `packages/billing/src/arrangements.ts`), the rates are timekeeping's (`readMatterAndClientRatesInForce` in `packages/timekeeping/src/rate-resolution.ts`, through the rate engine's own in-force test), and `packages/reporting/test/financial-matter-billing-guide.test.ts` proves every open and held matter of the Matters List appears once and each agreement shown is billing's.

## Public

A new Matter Billing Guide report shows how each open matter is billed today: its fee agreement, its terms and the rates set for it.
