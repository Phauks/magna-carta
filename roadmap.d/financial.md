# Financial Core

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: financial
  name: Financial Core
  scope: The firm's money spine — ledger, time, trust, billing, costs, operating books
  status: partial

- id: financial.ledger
  name: Append-only double-entry ledger
  scope: Single append-only double-entry ledger in D1 serving trust, billing, costs, and operating accounting.
  status: partial
  slices: 0-3-ledger-core-fixtures
  adrs: ADR-0008, ADR-0072
  spec: docs/specs/2026-06-09-ledger-core-and-fixtures-design.md
  evidence: packages/ledger (post-entry, reverse-entry, validate, normal-balance); status.d/0-3 built+tested
  notes: Core shipped; the operating-books extension is in build (children mix shipped and not).

- id: financial.ledger.append-only
  name: Reversals, never edits
  scope: Transactions are never edited, only reversed with new balancing entries; provable correctness and full history.
  status: shipped
  slices: 0-3-ledger-core-fixtures
  adrs: ADR-0072
  evidence: packages/ledger/src/reverse-entry.ts + invariants in validate.ts

- id: financial.ledger.operating-gl
  name: Operating accounting / general ledger
  scope: Extends the ledger to full firm operating books.
  status: in-build
  evidence: branch slice-3-5-operating-general-ledger carries design + implementation-plan commits (docs(ledger): design/plan slice 3·5); nothing on main
  notes: Specs live only on the branch; phase-3 slice map marks this slice loosely coupled.

- id: financial.ledger.operating-gl.chart-of-accounts
  name: Chart of accounts
  scope: The product chart-of-accounts the baseline schema defers, with the firm account resolver invoicing needs.
  status: in-build
  evidence: designed on branch slice-3-5-operating-general-ledger; fixtures/demo-chart-of-accounts.ts on main is explicitly not the product chart

- id: financial.ledger.operating-gl.accounts-payable
  name: Accounts payable
  scope: Accounts payable as a subledger of the operating books.
  status: in-build
  evidence: in the slice scope per docs/specs/2026-06-21-phase-3-financial-core-slice-map.md; design on the GL branch

- id: financial.ledger.operating-gl.financial-statements
  name: Financial statements
  scope: Trial balance, balance sheet, and income statement read primitives over the operating books.
  status: in-build
  evidence: in the slice scope per docs/specs/2026-06-21-phase-3-financial-core-slice-map.md; design on the GL branch

- id: financial.ledger.operating-gl.quickbooks-sync
  name: QuickBooks sync
  scope: QuickBooks as an optional sync, not the system of record.
  status: not-started
  evidence: no QuickBooks integration in packages/integrations; integration platform foundation exists but carries no accounting connector
  notes: Bank-feed is a reserved seam per the phase-3 slice map.

- id: financial.time
  name: Time tracking
  scope: Keyboard-first time capture on every matter (billed on hourly; captured internally on flat-fee/contingency for profitability/realization).
  status: partial
  slices: 3-1-time-tracking-wip-rate-engine
  adrs: ADR-0033
  spec: docs/specs/2026-06-22-slice-3-1-time-tracking-design.md
  evidence: packages/timekeeping on main; status.d/3-1 built+tested done, ui todo
  notes: Backend complete; all daily-driver surfaces await the app shell.

- id: financial.time.capture
  name: Time capture surfaces
  scope: The ways time enters the system — live timer, manual/quick-add, weekly grid, calendar drafts
  status: partial

- id: financial.time.capture.timer
  name: Single active live timer
  scope: One timer at a time bound to a matter (+ optional UTBMS code + narrative), start/pause/stop, server-persisted state surviving tab close and following across devices, always-visible timer bar.
  status: partial
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: apps/worker/src/timer/live-timer-durable-object.ts + timer-runtime.ts + routes/timer.ts (the codebase's first Durable Object); atomic stop-commit fix on main
  notes: Server-side timer shipped; the global timer bar is UI, not built.

- id: financial.time.capture.timer.offline-desktop
  name: Offline timer in Tauri
  scope: Timer works offline in the desktop shell, then syncs.
  status: not-started
  adrs: ADR-0002
  evidence: no Tauri app in tree (desktop comes after web MVP); time-entry source CHECK reserves offline_sync

- id: financial.time.capture.manual
  name: Manual entry and quick-add
  scope: Duration or start-end entry, free backdating, one-line quick-add parsing ("0.5 Smith — drafted demand letter").
  status: partial
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: time-entry-service.ts + quick-add-parser.ts + routes/time-entries.ts
  notes: Backend shipped; entry UI not built.

- id: financial.time.capture.weekly-grid
  name: Weekly timesheet grid
  scope: Matters-by-days grid for catching up a whole week.
  status: partial
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: listWeeklyGrid fan query in packages/timekeeping/src/queries.ts; source=grid provenance
  notes: Backend query shipped; the grid itself is UI, not built.

- id: financial.time.capture.calendar-drafts
  name: Calendar-derived drafts
  scope: One-click, user-initiated conversion of a calendar event into a time entry.
  status: deferred
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: the 3-1 design reserves source=calendar and the API shape as a dormant seam until the future Calendar subsystem
  notes: No Calendar subsystem exists yet.

- id: financial.time.entry-model
  name: Entry anatomy and audit
  scope: Date, timekeeper, required matter, duration, narrative, billable flag, resolved rate, optional UTBMS codes, non-billable category; every change audited.
  status: shipped
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: time-entry-statements.ts, non-billable-category-service.ts, audit.ts in packages/timekeeping

- id: financial.time.increments-rounding
  name: Increments and rounding
  scope: Configurable minimum increment (default 0.1 hr) and rounding rule; firm default with per-client/per-matter override.
  status: shipped
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: packages/timekeeping/src/rounding.ts + scoped-setting resolver in settings.ts

- id: financial.time.rates
  name: Effective-dated rate engine
  scope: Resolution chain matter rate, client rate, timekeeper standard, role default; multiple rate cards; an entry keeps the rate in force on its date.
  status: shipped
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: rate-resolution.ts, rate-service.ts, rate-validation.ts + routes/rate-cards.ts

- id: financial.time.narrative
  name: Narrative ergonomics
  scope: Snippet/abbreviation expansion, recent-narrative reuse, per-task-code templates.
  status: partial
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: narrative-template-service.ts + routes/narrative-templates.ts
  notes: Template store shipped; expansion/reuse ergonomics are capture-UI behaviors, not built.

- id: financial.time.lifecycle
  name: Draft-to-Billed lifecycle with optional review gate
  scope: Draft (editable) to Billed (locked) by default; firm-configurable Submitted/Approved gate, off by default; post-bill corrections are new adjusting entries.
  status: shipped
  slices: 3-1-time-tracking-wip-rate-engine, 3-3-costs-expenses-disbursements
  evidence: packages/billing-core/src/lifecycle.ts (transition rules, isFrozen) + review-gate.ts (approvalRequired setting)
  notes: The Billed transition is exercised at invoice finalize, shipped in packages/billing/src/finalize.ts.

- id: financial.time.wip
  name: Time is WIP, not a ledger posting
  scope: Unbilled time lives in a work-in-progress store and never touches the ledger; billable time converts to an A/R receivable at invoicing.
  status: shipped
  slices: 3-1-time-tracking-wip-rate-engine, 3-4-billing-and-invoicing
  evidence: per-firm WIP store in packages/timekeeping; my-day.ts documented as read-only over the WIP store, never the ledger; billable time claimed and converted to an A/R receivable at finalize in packages/billing/src/finalize.ts.

- id: financial.time.my-day
  name: My Day visibility
  scope: Running billable/non-billable totals, missing-time detection, billable-hour targets (daily/monthly/annual), per-matter and calendar-overlay views.
  status: partial
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: my-day.ts (target shortfall + un-logged-day detection) + routes/my-day.ts; time.target_daily/monthly/annual_hours settings
  notes: Backend shipped; the My Day view is UI, not built; calendar overlay is a deferred Calendar-subsystem seam.

- id: financial.time.utilization-reports
  name: Utilization and realization roll-ups
  scope: Utilization and realization rolled up into the reports library.
  status: not-started
  evidence: the reports slice (3-6 in the phase-3 slice map) has no fragment, branch, or code

- id: financial.time.utbms
  name: UTBMS codes
  scope: UTBMS task/activity codes on entries; e-billing matters require and validate codes at capture.
  status: shipped
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: utbms-catalog.ts, utbms-service.ts + routes/utbms-codes.ts; isEBillingMatter enforcement in time-entry-service.ts

- id: financial.time.passive-capture
  name: Passive/automatic time capture
  scope: Automatic activity capture feeding a draft-approve queue.
  status: deferred
  evidence: white paper states it remains backlogged; the review gate is built as its future host
  notes: Seam only; no capture code.

- id: financial.trust
  name: Trust accounting
  scope: Per-client trust ledgers, jurisdiction-configurable compliance, reconciliation.
  status: partial
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009
  spec: docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md
  evidence: packages/trust ships the account tree, the composition guard, holds, the transfer link, movements (deposits/disbursements/matter-to-matter transfers), two-person disbursement authorization as per-firm policy, matter-close zero-balance blocking, and bank-statement three-way reconciliation, over eight-plus per-firm tables; only the jurisdiction-configurable compliance engine (rules profiles, multi-jurisdiction accounts) is unbuilt.
  notes: Sub-slice 1 (schema + structural guards) plus movements, authorization, close-blocking, and reconciliation are built; the jurisdiction engine stays designed-only. Several of the fifteen owner flags from the 2026-08-04 analysis have since been ratified; some (e.g. jurisdiction rules) remain open.

- id: financial.trust.client-ledgers
  name: Per-client trust ledgers, no negative balance
  scope: Per-client (per-matter) trust subledgers under a per-account roll-up, with a hard no-negative-balance invariant per client ledger.
  status: shipped
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009, ADR-0072
  evidence: the three-level tree ships in packages/trust/src/account-tree.ts and min_balance_minor = 0 is written onto every matter leaf in its creation batch, enforced by the account_balance bounds CHECK; receipts and disbursements as domain operations ship in packages/trust/src/movements.ts (composeTrustDeposit, composeTrustDisbursement, composeMatterToMatterTransfer).

- id: financial.trust.authorization-policy
  name: Disbursement authorization policy (per-firm)
  scope: Whether money leaving a client ledger takes a second person as firm configuration — off, threshold-based, or always (the strict shipped default) — plus an approver-authority option requiring the trust:authorize capability of whoever lets money go; the earned-fee application follows the same policy through the same approval queue; in-flight requests keep the policy version they were submitted under.
  status: shipped
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: packages/trust/src/authorization-policy.ts (versioned append-only policy, the shared requires-second-person predicate, the authority assertion); policy-aware decision and transfer triggers in the per-firm migration; billing's application queue in packages/billing/src/apply-authorization.ts; routes for the policy read/change and the application submit/approve
  notes: Owner-directed override of the always-two-person default. Flagged, not decided - whether a posture relaxation itself takes a second person, and whether matter-to-matter reallocations fall under the policy.

- id: financial.trust.no-commingling
  name: No commingling
  scope: Firm and client funds never commingle; fees never touch trust (processor/bank fees debit operating only).
  status: shipped
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0032
  evidence: packages/trust/src/composition-guard.ts refuses any entry mixing a trust account's accounts with anything outside it (which is also what leaves a processor fee nowhere to sit on a trust entry), plus a fitness query over posted lines; tests cover the netted-fee and client-to-client cases

- id: financial.trust.jurisdiction-engine
  name: Jurisdiction-configurable compliance engine
  scope: A rules profile per state/territory parameterized where states differ (citation, retention, reconciliation cadence, firm-funds allowance, IOLTA model, advance/flat-fee treatment, overdraft reporting, electronic payments, thresholds); rule numbers never hard-coded; Nevada seeded.
  status: partial
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009
  spec: docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md
  evidence: packages/trust-jurisdictions ships the TrustJurisdictionPort contract, a fail-closed resolver (attorneyReview null refuses everything as jurisdiction-not-verified, revision-bound so an amendment re-closes the gate), and the Nevada profile (ten typed requirements, verbatim rule quotes and citations). packages/trust/src/jurisdiction.ts wires trust accounts to it by their recorded jurisdiction, but the worker keeps the refusing default until the reviewed port is actually bound.
  notes: Only Nevada is encoded; the other 55 jurisdictions have no primary-source-verified profile.

- id: financial.trust.jurisdiction-engine.rules-catalog
  name: Trust-rules catalog (56 jurisdictions)
  scope: Verified research corpus of 56 US jurisdictions across 16 rule dimensions compiled into shared reference data.
  status: partial
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: docs/research/trust-rules/ (four jurisdiction groups + verification pass); Nevada corrected against primary sources and compiled into packages/trust-jurisdictions/src/data/nevada.ts (SCR 78 citations, two five-year retention clocks, NRPC 1.15(f)/NRS 120A.500(6)(f) unclaimed-funds no-escheat exemption).
  notes: Nevada is primary-source-verified and compiled. The 55 sibling entries have no primary source in the repo to check against and carry a NOT-VERIFIED banner in the research docs — narrative research only, not compiled.

- id: financial.trust.multi-jurisdiction-accounts
  name: Multiple active jurisdictions per firm
  scope: Each trust account opened in a state carries its own jurisdiction profile and governing-rule citation and is associated with a Location; matter trust activity defaults from the matter's home location.
  status: designed
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: trust_account-to-location binding and per-account profile in the approved jurisdiction-schema design; location.jurisdiction column shipped as the seam

- id: financial.trust.reconciliation
  name: Interactive three-way reconciliation
  scope: Monthly bank reconciliation (manual entry or banking-plugin import), match cleared items, flag outstanding/discrepancies, generate and archive a signed three-way reconciliation, per trust account.
  status: shipped
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: packages/trust/src/{bank-statements,statement-import,matching,reconciliation,three-way-proof}.ts — statements entered or CSV-imported through preview -> confirm -> report, human-confirmed matching (no silent auto-match), the three-way proof (adjusted bank = book = sum of client ledgers) computed from the ledger's own statements, and a frozen, named-member-attested reconciliation record. Four append-only per-firm tables, twelve routes.
  notes: Manual entry and CSV import are built; a live banking-plugin import still depends on an unbuilt banking integration.

- id: financial.trust.close-rule
  name: Zero-balance close precondition
  scope: Registers "all bills paid, no remaining balance" on the matter close-precondition hook.
  status: shipped
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: packages/trust/src/close-precondition.ts registers into the matters close-precondition registry seam; refuses close naming the amount, account, held portion, and the movements that would clear it; race-safe via an in-transaction re-check that aborts the whole close batch on a concurrent deposit.

- id: financial.billing
  name: Billing and invoicing
  scope: Bill generation combining time/fees, costs, and taxes across the four fee models, with a draft-to-finalize lifecycle.
  status: partial
  slices: 3-4-billing-and-invoicing
  spec: docs/specs/2026-08-05-billing-design.md
  evidence: packages/billing — the invoice spine (draft/claim/finalize/post/number, migration 20260805T230000), applying trust funds to a finalized invoice as the earned-fee satisfier (packages/billing/src/apply-trust-funds.ts, migration 20260806T060000), and all four fee models (arrangements.ts, hourly/flat-fee/contingency/retainer).
  notes: LEDES export/guideline validation/electronic submission, invoice-location letterhead rendering, and the billing-automations slice (replenishment alerts) remain unbuilt; no UI.

- id: financial.billing.fee-models
  name: Fee models
  scope: The four billing arrangements — hourly, flat/fixed, contingency, retainer/evergreen
  status: shipped
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/arrangements.ts (the versioned append-only per-matter fee agreement; a fee change is a new version and invoice lines record the version that composed them)
  notes: Built all at once per the owner's docket override of the staged default.

- id: financial.billing.fee-models.hourly
  name: Hourly billing
  scope: Hourly bills from billable WIP time at resolved rates.
  status: shipped
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/draft.ts (lines composed from each entry's own rate snapshot; billing never re-resolves a rate; a flat-fee or contingency matter refuses hourly time claims by name)

- id: financial.billing.fee-models.flat-fee
  name: Flat/fixed fee
  scope: Flat and fixed-fee billing.
  status: shipped
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/flat-fee.ts (one flat_fee line from the agreement; contributing time claimed at zero for realization; instalments representable with over-billing reported by flatFeeBilledBeyondArrangementStatement)

- id: financial.billing.fee-models.contingency
  name: Contingency and settlement statements
  scope: Contingency agreements (share, costs-before-or-after election), recorded recoveries, and the fee derived at invoice time; settlement disbursement statements splitting client share, fee, costs, and liens.
  status: partial
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/contingency.ts (matter_recovery records the fact; the fee is always derived at composition, never stored as a decided number)
  notes: The fee model is shipped; settlement disbursement statements and lien handling stay deferred to a later financial slice, once a real matter demands them.

- id: financial.billing.fee-models.retainer
  name: Retainer/evergreen
  scope: Retainer and evergreen billing with auto-replenishment alerts below threshold.
  status: partial
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/retainer.ts (target and floor on the agreement; floor status from trust's available figure; retainer_replenishment_request with the billing.retainer.replenishment_requested topic)
  notes: The record and the topic are shipped; the automated below-floor alert belongs to the billing-automations slice, which consumes this same event.

- id: financial.billing.invoice-composition
  name: Invoice composition
  scope: Bills combine time/fees plus costs plus taxes.
  status: shipped
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/draft.ts composes invoice lines from claimed time and cost WIP entries plus the four fee models; packages/billing/src/finalize.ts is one composed batch (number draw, presentation snapshot, billed lock, balance rows, A/R posting).
  notes: No tax computation; a bill combines time/fees and costs only.

- id: financial.billing.location-letterhead
  name: Location letterhead and remit-to on invoices
  scope: Invoices carry the home Location's letterhead and remit-to when the matter is location-assigned, snapshotted at finalize.
  status: not-started
  evidence: locations carry remit-to data on main; no invoice renderer consumes it

- id: financial.billing.wip-to-ar
  name: WIP to A/R posting at finalize
  scope: At invoice finalize, billable time and cost WIP convert atomically to an A/R receivable ledger entry with the Draft-to-Billed lock.
  status: shipped
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/finalize.ts posts the accounts-receivable ledger entry, the billed lock on every claimed WIP entry, and the per-matter balance rows in one composed batch; a commit guard aborts the whole batch if a claimed entry was voided mid-flight.

- id: financial.billing.ledes
  name: LEDES e-billing
  scope: Export invoices in LEDES 1998B and LEDES XML 2.0/2.1 with UTBMS codes carried through from time and cost entries.
  status: not-started
  evidence: no LEDES exporter in tree; UTBMS capture upstream is shipped and its columns are documented as what "the LEDES exporter at billing reads"

- id: financial.billing.ledes.e-billing-flag
  name: Per-matter e-billing flag
  scope: Per-matter flag driving required-code validation upstream in time and cost capture.
  status: shipped
  slices: 3-1-time-tracking-wip-rate-engine, 3-3-costs-expenses-disbursements
  evidence: selectMatterEBillingStatement read by both time-entry-service.ts and cost-entry-service.ts
  notes: Landed early per the phase-3 slice map coordination pin.

- id: financial.billing.ledes.guideline-validation
  name: Billing-guideline validation
  scope: Validation against client billing guidelines (rate caps, block-billing/increment rules, required codes) before submission.
  status: not-started
  evidence: no guideline model or validator in tree

- id: financial.billing.ledes.submission
  name: Electronic submission path
  scope: A path to electronic invoice submission.
  status: not-started
  evidence: no submission integration in tree

- id: financial.costs
  name: Costs and expenses (disbursements)
  scope: Per-matter cost entries for advanced hard costs and in-house soft costs, staying unbilled WIP until invoiced.
  status: partial
  slices: 3-3-costs-expenses-disbursements
  spec: docs/specs/2026-06-23-slice-3-3-costs-expenses-design.md
  evidence: packages/costs + @magna-carta/billing-core on main; status.d/3-3 built+tested done, ui todo
  notes: Backend shipped, including cost-to-A/R conversion at invoice finalize; cost-entry UI not built; LEDES export is unbuilt.

- id: financial.costs.entry-model
  name: Cost entry anatomy
  scope: Per-matter entries with type, Directory-linked vendor, date, hard/soft, billable flag, optional UTBMS expense (E-) code with e-billing validation.
  status: partial
  slices: 3-3-costs-expenses-disbursements
  evidence: cost-entry-service.ts, cost-validation.ts (shared UTBMS catalog; isEBillingMatter check)
  notes: Backend shipped; entry UI not built.

- id: financial.costs.hard
  name: Hard costs as client receivable
  scope: Firm-advanced third-party costs (filing, recording, service, experts, postage/shipping) advanced as a client receivable and billed back.
  status: shipped
  slices: 3-3-costs-expenses-disbursements, 3-4-billing-and-invoicing
  evidence: hard-cost capture as billable WIP in packages/costs; receivable posting and bill-back at invoice finalize in packages/billing/src/finalize.ts.

- id: financial.costs.soft
  name: Soft/in-house costs
  scope: In-house costs (printing, copies) tracked separately from hard costs.
  status: partial
  slices: 3-3-costs-expenses-disbursements
  evidence: hard/soft distinction in cost entry model
  notes: Backend shipped; UI not built.

- id: financial.costs.markup-trust
  name: Markup and pay-from-trust
  scope: Cost markup and paying costs from trust.
  status: deferred
  evidence: white paper states markup and pay-from-trust are not enabled now but easy to add; no code in packages/costs
  notes: Deliberate exclusion with an open seam.

- id: financial.costs.auto-capture
  name: Integration auto-capture
  scope: Automatic cost capture from integrations (PACER filing fees, shipping, banking operating disbursements).
  status: partial
  evidence: children mix shipped and not
  notes: Arrives plugin-by-plugin per the white paper.

- id: financial.costs.auto-capture.shipping
  name: Shipping cost auto-capture
  scope: Purchased shipments flow into recoverable cost charges via the shipment.purchased outbox seam.
  status: shipped
  slices: 3-3-costs-expenses-disbursements, shipping-postage-backend
  evidence: recoverable-charge.ts + recovery-policy.ts in packages/costs; the codebase's first per-firm queue consumer (status.d/3-3)

- id: financial.costs.auto-capture.pacer
  name: PACER filing-fee capture
  scope: PACER integration auto-captures filing fees as costs.
  status: not-started
  evidence: no PACER integration in packages/integrations

- id: financial.costs.auto-capture.banking
  name: Banking disbursement capture
  scope: Banking integration auto-captures operating disbursements.
  status: not-started
  evidence: no banking integration in tree
