# Reports

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: reports
  name: Reports
  scope: Reproducible projections over the append-only ledger; standard library of trust-compliance, financial, productivity, and operational reports with scheduling and exports.
  status: planned
  slices: 3-6-financial-reporting
  evidence: Design and implementation plan on branch claude/financial-reporting (docs/specs/2026-08-13-financial-reporting-design.md and -implementation-plan.md); no reporting package, report definitions, or report UI yet.
  notes: Owner scoped all four families with the bar-audit pack first; nine questions flagged for the owner in the design.

- id: reports.projections
  name: Ledger projections
  scope: Reports computed as projections over the append-only ledger, consistent with the books and reproducible for any past date.
  status: planned
  slices: 3-6-financial-reporting, 0-3-ledger-core-fixtures
  adrs: ADR-0072
  evidence: Ledger core with posting/reversal is on main; the projection contract is designed (bitemporal effective-date plus recorded_at knowledge instant), no projection layer built.

- id: reports.trust-compliance
  name: Trust-compliance reports
  scope: Mandatory three-way reconciliation, client ledgers, and journal, per trust account.
  status: planned
  slices: 3-6-financial-reporting, 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009, ADR-0246
  evidence: Trust accounting is shipped end to end including the frozen three-way proof; the bar-audit pack is the first sub-slice of the reporting plan, rendering the frozen attestation rather than recomputing it.

- id: reports.financial
  name: Financial reports
  scope: WIP, A/R aging, realization, and profitability reports.
  status: planned
  slices: 3-6-financial-reporting, 3-1-time-tracking-wip-rate-engine, 3-3-costs-expenses-disbursements
  evidence: Time/WIP, costs and billing substrates are shipped; sub-slice 3·6·2 plans as-of A/R aging, live work-in-progress, and realization.
  notes: Profitability is deferred — no timekeeper cost rate exists in the schema; work in progress is live-only because its stores are mutable and carry no billed_at/voided_at.

- id: reports.productivity
  name: Productivity reports
  scope: Timekeeper and staff productivity reporting.
  status: planned
  slices: 3-6-financial-reporting
  evidence: Planned as sub-slice 3·6·3 on its own permission key; time-entry data model shipped as substrate.
  notes: Live-only (mutable store); no attainment figure, because the platform stores no billable-hour target.

- id: reports.operational
  name: Operational reports
  scope: Operational reporting over firm activity.
  status: planned
  slices: 3-6-financial-reporting
  evidence: Planned as sub-slice 3·6·4 — counts and dates over the matter, invoice, trust and cost records, deliberately summing no money.

- id: reports.location-rollups
  name: Per-location roll-ups
  scope: Financial and productivity reports filter and subtotal by office; trust reports inherently per-account/per-location.
  status: planned
  slices: 3-6-financial-reporting
  adrs: ADR-0031
  evidence: Locations model shipped (packages/locations); roll-ups planned in each report sub-slice, with location held as a filter and never an access gate.

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
  status: planned
  slices: 3-6-financial-reporting
  adrs: ADR-0162
  evidence: PDF rides the existing assembly-to-conversion edge in sub-slice 3·6·1; CSV and Excel are planned in sub-slice 3·6·5.

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
