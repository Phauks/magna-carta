---
category: Added
audience: public
---

**The report screen, as two screens over one registry.** `/reports` lists every report the platform
declares, grouped by family, from `apps/web/src/lib/reports/report-registry.ts`; `/reports/<id>`
draws a report's controls from its declaration (a period on every report, a knowledge instant on a
bitemporal one, a trust account where the report is about one, the report's own options), reads
through the declaration's port when the scope is complete, and renders the answer as titled sections
of tables whose shape is the tabular export document's, so the export menu takes every report with
no per-report code. The scope rides the address. The trust-compliance pack is the first report wired;
the financial, productivity and operational families are declared at stage `soon`, visible and
disabled in the catalogue with what each waits on. A presenter computes nothing, and its test says
so. Adds `GET /api/v1/trust/accounts` (cursor-paged, `trust:read`), the one listing of a firm's
trust accounts, which the trust ledger's `account` gap has been waiting on; the ledger's wiring is
left to its own stream. Design: `docs/specs/2026-09-07-report-screen-design.md`. Sidebar row flipped
to shipped.

## Public

**Reports has a screen.** Open Reports from the sidebar to see every report the platform offers,
grouped by family. The trust compliance report runs today: choose a trust account, a period (this
or last month, quarter or year, or any range), and whether you want everything known now or the
figures as they stood at the end of a chosen day, and the report appears below with its cover, each
reconciliation, every client and matter ledger, the receipts and disbursements journal, the holds
and exceptions, and its provenance. Export it in any format from the menu at the top, and send
somebody the address to show them the same report. The financial, productivity and operational
reports are listed and marked Soon, each saying what it waits on.
