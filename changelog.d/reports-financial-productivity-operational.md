---
category: Added
audience: public
---

**The financial, productivity and operational reports are built.** Accounts Receivable Aging (`GET /api/v1/reports/accounts-receivable-aging`, as of a date, bitemporal), Work in Progress (live), Realization (bitemporal, with the standard value labelled live), Timekeeper Productivity (live, minutes only, no target) and Operational Volumes (billing and trust bitemporal, matters and costs labelled live). Each domain owns its SQL (`packages/billing/src/queries.ts`, `packages/billing/src/operational-counts.ts`, `packages/timekeeping/src/productivity-statements.ts`, and the matters, trust and costs `operational-counts.ts`); `packages/reporting` adds the rows into offices, clients, matters and timekeepers, each decomposition held by an agreement test. Every read takes an optional office, a filter and never a gate. The run screen (`apps/web/src/routes/(app)/reports/[reportId]/+page.svelte`) draws a row of totals, then a table by office ruled off with the report's own total, then a sortable table by client on `DataTable.Grid` whose rows open onto their matters; under the medium breakpoint each row is a card, so no table scrolls sideways. `@magna-carta/money/format` gains `spreadsheetNumber`. No migration: the `reports:*` keys were already seeded.

## Public

Five new reports: Accounts Receivable Aging, Work in Progress, Realization, Timekeeper Productivity and Operational Volumes. Each opens with a row of totals, then a table by office with the firm total, then a table by client you can sort by any column; press a client to see its matters. Every report can be narrowed to one office. Aging, Realization and Operational Volumes can be fixed "as known" at the end of a chosen day, so the copy reads the same every time it is run. Timekeeper Productivity reports the time recorded and sets no target. Export carries the same tables.
