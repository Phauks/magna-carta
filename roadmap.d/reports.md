# Reports

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: reports
  name: Reports
  scope: Reproducible projections over the append-only ledger; standard library of trust-compliance, financial, productivity, and operational reports with scheduling and exports.
  status: not-started
  evidence: No reporting package, report definitions, or report UI; the ledger substrate the projections read is shipped (packages/ledger, slice 0-3).

- id: reports.projections
  name: Ledger projections
  scope: Reports computed as projections over the append-only ledger, consistent with the books and reproducible for any past date.
  status: not-started
  slices: 0-3-ledger-core-fixtures
  adrs: ADR-0072
  evidence: Ledger core with posting/reversal is on main; no projection/report layer exists on top of it.

- id: reports.trust-compliance
  name: Trust-compliance reports
  scope: Mandatory three-way reconciliation, client ledgers, and journal, per trust account.
  status: not-started
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009
  evidence: Trust accounting slice is in research/design (status.d/3-2); no reconciliation or report code.

- id: reports.financial
  name: Financial reports
  scope: WIP, A/R aging, realization, and profitability reports.
  status: not-started
  slices: 3-1-time-tracking-wip-rate-engine, 3-3-costs-expenses-disbursements
  evidence: Time/WIP and costs substrates are shipped (packages/timekeeping, packages/costs, packages/billing-core); no report layer reads them.

- id: reports.productivity
  name: Productivity reports
  scope: Timekeeper and staff productivity reporting.
  status: not-started
  evidence: No productivity report exists; time-entry data model shipped as substrate.

- id: reports.operational
  name: Operational reports
  scope: Operational reporting over firm activity.
  status: not-started
  evidence: No operational report definitions exist.

- id: reports.location-rollups
  name: Per-location roll-ups
  scope: Financial and productivity reports filter and subtotal by office; trust reports inherently per-account/per-location.
  status: not-started
  adrs: ADR-0031
  evidence: Locations model shipped (packages/locations); no reports exist to roll up.

- id: reports.scheduling
  name: Scheduled generation
  scope: Scheduled/automated report generation, archival, and optional email delivery.
  status: not-started
  adrs: ADR-0059
  evidence: No scheduler; notifications orchestration decision and the shipped transactional email adapter are the seams.

- id: reports.exports
  name: Exports
  scope: PDF, Excel/CSV, and print export of reports.
  status: not-started
  adrs: ADR-0162
  evidence: No export path; the PDF generate-primitives engine is a shipped substrate for PDF output.

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
