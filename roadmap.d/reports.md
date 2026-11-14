# Reports

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Reports -->

- id: reports
  name: Reports
  scope: Reproducible projections over the append-only ledger; standard library of trust-compliance, financial, productivity, and operational reports with scheduling and exports.
  status: partial
  slices: 3-6-financial-reporting
  spec: docs/specs/2026-09-07-report-screen-design.md
  evidence: packages/reporting holds the temporal contract, the completeness declaration and the trust-compliance pack; apps/api-worker/src/http/routes/billing/reports.ts serves it; apps/web/src/lib/reports/report-registry.ts declares every report and the /reports and /reports/<id> screens render from it. The financial, productivity and operational families are built (aging, work in progress, realization, timekeeper productivity, daily time, matter productivity, operational volumes) and run on the same screen; profitability and the scheduled delivery surface are unbuilt.
  audience: public
  public-summary: Reports on money, time, trust compliance and productivity — on screen, exported, or sent to you on a schedule.
  notes: Owner scoped all four families with the bar-audit pack first; nine questions flagged for the owner in the design.

- id: reports.projections
  name: Ledger projections
  scope: Reports computed as projections over the append-only ledger, consistent with the books and reproducible for any past date.
  status: shipped
  surface: internal
  slices: 3-6-financial-reporting, 0-3-ledger-core-fixtures
  adrs: ADR-0072
  evidence: packages/reporting/src/temporal.ts holds the (period, knowledge instant) contract and its validation; the bitemporal select builders are in packages/trust/src/statements.ts and packages/reporting/test/reproducibility.test.ts proves a stated triple re-derives across a backdated correction.
  notes: Backend only, no screen. Two blocks in the trust-compliance pack are labelled as outside the claim — the three-way proof beside each attestation, and the outstanding-item, unmatched-line and stored-balance checks — because their owning reads take no knowledge instant and a second definition of them is refused.

- id: reports.trust-compliance
  name: Trust-compliance reports
  scope: Mandatory three-way reconciliation, client ledgers, and journal, per trust account.
  status: partial
  surface: screen
  slices: 3-6-financial-reporting, 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009, ADR-0246
  evidence: packages/reporting/src/trust-compliance/pack.ts assembles the cover, reconciliations, client ledgers, journal, firm cushion, exceptions and provenance; GET /api/v1/reports/trust-compliance/{trustAccountId} serves it on reports:trustCompliance; packages/reporting/test/agreement.test.ts proves each decomposition equals the aggregate trust owns; /reports/trust-compliance runs it on screen over a trust account, a period and a knowledge instant, and exports it through the tabular export seam.
  awaiting-owner: What a pack does when no jurisdiction rule can be cited, which is every pack today because every encoded jurisdiction ships unreviewed and no corpus is bound. It currently states that on the cover in the corpus's own words and produces the rest; refusing outright is the alternative, and would mean the surface produces nothing at all until an attorney review lands. Three defaults ship behind seams beside it and none is settled: whether a pack names the person who authorized each disbursement, whether zero-balance client ledgers appear, and whether the frozen attestation or the live proof leads each reconciliation.
  notes: On screen and exportable; no filed artifact — turning a pack into an immutable firm document waits on a renderer this repository cannot run yet and on the owner's answers on its record.

- id: reports.financial
  name: Financial reports
  scope: WIP, A/R aging, realization, invoices, payments applied, and profitability reports.
  status: partial
  surface: screen
  slices: 3-6-financial-reporting, 3-1-time-tracking-wip-rate-engine, 3-3-costs-expenses-disbursements
  evidence: Billing owns the reads (packages/billing/src/queries.ts readAccountsReceivableAgingAsOf, readWorkInProgressBreakdown, readRealizationBreakdown, readInvoiceRegister, readApplicationRegister, readMatterCaptions, readWorkInProgressByAge; packages/billing/test/aging-as-of.test.ts, work-in-progress-breakdown.test.ts and report-registers.test.ts prove each against the live aggregate or the as-of aging); packages/reporting/src/financial/ adds them into offices, clients, matters and timekeepers; GET /api/v1/reports/accounts-receivable-aging, /work-in-progress, /realization, /invoices, /payments-applied, /matter-balances and /aged-work-in-progress serve them on reports:financial (Matter Balances puts the work-in-progress, aging and trust per-leaf figures on each matter, each column proved equal to its owner's total in packages/reporting/test/financial-matter-balances.test.ts); /reports/<id> draws totals first, a by-office table ruled off with the report's total, then a sortable by-client table that opens onto matters (the owner's pick B, 2026-11-13).
  notes: Profitability is deferred — no timekeeper cost rate exists in the schema; work in progress is live-only because its stores are mutable and carry no billed_at/voided_at.

- id: reports.productivity
  name: Productivity reports
  scope: Timekeeper and staff productivity reporting.
  status: shipped
  surface: screen
  slices: 3-6-financial-reporting
  evidence: packages/timekeeping/src/productivity-statements.ts reads minutes recorded by timekeeper, matter, billable, non-billable category and task code; packages/reporting/src/productivity/timekeeper-productivity.ts adds them into timekeepers, offices, clients and task codes, each summing to the same total (packages/reporting/test/productivity.test.ts); GET /api/v1/reports/timekeeper-productivity serves it on reports:productivity and /reports/timekeeper-productivity runs it. Daily Time (readTimeRecordedByDay over the same TIME_RECORDED_IN_PERIOD predicate, packages/reporting/src/productivity/daily-time.ts, GET /api/v1/reports/daily-time, live) lists the same minutes per day and timekeeper, its totals proved equal to Timekeeper Productivity's in packages/reporting/test/productivity-daily-time.test.ts. Matter Productivity (packages/reporting/src/productivity/matter-productivity.ts over the same breakdown, GET /api/v1/reports/matter-productivity, live) turns it per matter with its timekeepers, proved equal in packages/reporting/test/productivity-matter-productivity.test.ts. Tasks by Person (readTaskWorkload in packages/tasks/src/task-workload.ts, overdue through packages/calendar/src/overdue.ts; packages/reporting/src/productivity/task-workload.ts; GET /api/v1/reports/task-workload, live) counts each member's open, overdue and undated tasks, never a task's words; packages/reporting/test/productivity-task-workload.test.ts proves the people add up to every open task.
  notes: Live-only (mutable store); no attainment figure, because the platform stores no billable-hour target.

- id: reports.operational
  name: Operational reports
  scope: Operational reporting over firm activity.
  status: shipped
  surface: screen
  slices: 3-6-financial-reporting
  evidence: Each domain counts its own records (packages/billing, matters, trust and costs, each src/operational-counts.ts); packages/reporting/src/operational/operational-volumes.ts places them side by side, billing and trust bitemporal and matters and costs labelled live; GET /api/v1/reports/operational-volumes serves it on reports:operational and /reports/operational-volumes runs it. Counts only, never money. The Matters List (packages/matters/src/matter-register.ts read, packages/reporting/src/operational/matters-list.ts, GET /api/v1/reports/matters-list, live) lists every opened matter and counts them by office. The Client List (packages/reporting/src/operational/client-list.ts, GET /api/v1/reports/client-list, live) takes the clients from that same register and each one's name and default contact details from the directory's own listing row (readEntityListingRows in packages/directory/src/entity-listing.ts); its counts are proved to add up to the Matters List's in packages/reporting/test/operational-client-list.test.ts.

- id: reports.location-rollups
  name: Per-location roll-ups
  scope: Financial and productivity reports filter and subtotal by office; trust reports inherently per-account/per-location.
  status: shipped
  surface: screen
  slices: 3-6-financial-reporting
  adrs: ADR-0031
  evidence: Every financial, productivity and operational read takes an optional locationId and, with none, subtotals every office (a by-office table in each report); the run screen's Office picker narrows the rows and is a filter, never a gate.

- id: reports.scheduling
  name: Scheduled generation
  scope: Scheduled/automated report generation, archival, and optional email delivery.
  status: planned
  slices: 3-6-financial-reporting
  adrs: ADR-0059
  evidence: Planned as sub-slice 3·6·5 on the existing daily per-firm cron fan-out and the transactional outbox; no scheduler built.

- id: reports.exports
  name: Exports
  scope: PDF, Excel/CSV, and print export of reports.
  status: partial
  surface: screen
  slices: 3-6-financial-reporting
  adrs: ADR-0162
  evidence: The tabular export framework is live on Firm Usage and on every report screen in every format — text, CSV, and Excel render in the browser ($lib/export), Word renders server-side (POST /api/v1/reports/exports composes through document assembly), and PDF is composed in the browser by the platform's PDF composer (apps/web/src/lib/export/render-pdf.ts over @magna-carta/pdf-compose, in a Web Worker), the one way a tabular export becomes a PDF. A report's presentation IS the export document's shape, so a report declared in the registry exports with no per-report code. Every export taken is kept on the member's download register (/downloads) for seven days and can be taken again in any format.

- id: reports.download-register
  name: Download register
  scope: A per-member record of everything they have downloaded — exports, bundles, converted files, discovery productions, and files taken off a matter — kept after the copy the platform held has been released.
  status: shipped
  surface: screen
  evidence: Every producer writes through one chokepoint (apps/api-worker/src/downloads/download-register.ts), held by pnpm run lint:download-register — nothing else may reach insertDownloadItemStatement, and any module that hands a member bytes must register what it handed over. Reachable two ways: the top-bar tray beside the Time Keeper ($lib/export/download-tray.svelte) and the /downloads page, which is DataTable.Grid over a declared column model ($lib/export/download-columns.ts) with a Standing column saying whether a row can still be taken. A matter file is a reference kind carrying no object key, so its re-download goes back through the matter and re-runs the capability check. Retention splits: the bytes keep the seven-day rule, the row is kept and marked expired. GET /api/v1/downloads is cursor-paged on (created_at, id), searched on the server, and takes a bounded limit for the tray. Settings · Downloads carries the per-member save-immediately preference (user-tier scoped setting) and, where the browser has a folder picker, a chosen download folder held in IndexedDB and written through the File System Access API ($lib/export/save-target.ts is the one seam every save goes through, falling back to the browser's own download for Firefox and Safari). What stays with the desktop app is a folder that applies to a bundle whose bytes never touch the page.

- id: reports.custom-builder
  name: Custom report builder
  scope: User-defined custom reports.
  status: deferred
  evidence: White paper explicitly defers the custom report builder.

- id: reports.dashboards
  name: Live dashboards
  scope: Live operational/financial dashboards.
  status: deferred
  evidence: White paper explicitly defers live dashboards.
