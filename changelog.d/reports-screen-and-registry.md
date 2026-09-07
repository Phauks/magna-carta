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

**The three questions the screen flagged, decided and built in the same stream.** The account
picker names `trust:read` in the refusal sentence when a member holding only the report key hits
it. The knowledge instant is the end of the chosen day in the zone of the office that holds the
account (the trust listing now carries `timeZone`, resolved through `timeZoneForLocation`), and
changing the account keeps the day and moves the instant. What the pack lists is a firm policy:
`firm:manageReportPolicy` (seeded to Owner/Admin), `GET`/`PATCH /api/v1/firm/reports/policy`
(audited), the pack route defaulting from it, Settings › Practice › Reports over the calendar
settings page's server-backed draft pattern, and the two selects gone from the run screen.

## Public

**Reports has a screen.** Open Reports from the sidebar to see every report the platform offers,
grouped by family. The trust compliance report runs today: choose a trust account, a period (this
or last month, quarter or year, or any range), and whether you want everything known now or the
figures as they stood at the end of a chosen day, and the report appears below with its cover, each
reconciliation, every client and matter ledger, the receipts and disbursements journal, the holds
and exceptions, and its provenance. Export it in any format from the menu at the top, and send
somebody the address to show them the same report. A chosen day ends at midnight in the time zone
of the office that holds the account. What the trust compliance report lists, such as ledgers at
zero and who authorized each payment, is now a firm setting under Settings, Practice, Reports, so
every copy of the report reads the same. The financial, productivity and operational reports are
listed and marked Soon, each saying what it waits on.
