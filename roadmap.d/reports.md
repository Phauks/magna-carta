# Reports

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Reports -->

- id: reports
  name: Reports
  scope: Reproducible projections over the append-only ledger; standard library of trust-compliance, financial, productivity, and operational reports with scheduling and exports.
  status: partial
  slices: 3-6-financial-reporting
  evidence: packages/reporting holds the temporal contract, the completeness declaration and the trust-compliance pack; apps/worker/src/routes/reports.ts serves it. The financial, productivity and operational families and the delivery surface are unbuilt, and no report has a screen.
  audience: public
  public-summary: Reports on money, time, trust compliance and productivity — on screen, exported, or sent to you on a schedule.
  notes: Owner scoped all four families with the bar-audit pack first; nine questions flagged for the owner in the design.

- id: reports.projections
  name: Ledger projections
  scope: Reports computed as projections over the append-only ledger, consistent with the books and reproducible for any past date.
  status: shipped
  slices: 3-6-financial-reporting, 0-3-ledger-core-fixtures
  adrs: ADR-0072
  evidence: packages/reporting/src/temporal.ts holds the (period, knowledge instant) contract and its validation; the bitemporal select builders are in packages/trust/src/statements.ts and packages/reporting/test/reproducibility.test.ts proves a stated triple re-derives across a backdated correction.
  notes: Backend only, no screen. Two blocks in the trust-compliance pack are labelled as outside the claim — the three-way proof beside each attestation, and the outstanding-item, unmatched-line and stored-balance checks — because their owning reads take no knowledge instant and a second definition of them is refused.

- id: reports.trust-compliance
  name: Trust-compliance reports
  scope: Mandatory three-way reconciliation, client ledgers, and journal, per trust account.
  status: partial
  slices: 3-6-financial-reporting, 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009, ADR-0246
  evidence: packages/reporting/src/trust-compliance/pack.ts assembles the cover, reconciliations, client ledgers, journal, firm cushion, exceptions and provenance; GET /api/v1/reports/trust-compliance/{trustAccountId} serves it on reports:trustCompliance; packages/reporting/test/agreement.test.ts proves each decomposition equals the aggregate trust owns.
  notes: Backend only, no screen, and no filed artifact — turning a pack into an immutable firm document waits on a renderer this repository cannot run yet.

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
  evidence: The trust-compliance pack is served as JSON; PDF rides the existing assembly-to-conversion edge, whose engines are not deployed, and CSV and Excel are planned in sub-slice 3·6·5.

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
