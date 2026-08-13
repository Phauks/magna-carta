# Financial Core

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Time, trust and billing -->

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
  audience: public
  public-summary: Record time as you work — a running timer, a quick entry, or a weekly grid — against the matter and the rate that applies on that day.
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
  notes: The Billed transition is exercised at invoice finalize, which is not built yet.

- id: financial.time.wip
  name: Time is WIP, not a ledger posting
  scope: Unbilled time lives in a work-in-progress store and never touches the ledger; billable time converts to an A/R receivable at invoicing.
  status: partial
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: per-firm WIP store in packages/timekeeping; my-day.ts documented as read-only over the WIP store, never the ledger
  notes: WIP store shipped; the WIP-to-A/R conversion belongs to the unbuilt billing slice.

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
  evidence: packages/trust ships the account tree, the composition guard, holds, the transfer link, and the fitness suite over four per-firm tables (20260805T120000_trust-ledger); movement operations, reconciliation, and the jurisdiction engine are unbuilt
  audience: public
  public-summary: Hold client money in trust with a balance per client that cannot go negative, and the rules of your jurisdiction enforced rather than described.
  notes: Sub-slice 1 (schema + structural guards) is built; fifteen owner flags from the 2026-08-04 analysis stay open and are refused rather than defaulted in code.

- id: financial.trust.client-ledgers
  name: Per-client trust ledgers, no negative balance
  scope: Per-client (per-matter) trust subledgers under a per-account roll-up, with a hard no-negative-balance invariant per client ledger.
  status: partial
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009, ADR-0072
  evidence: the three-level tree ships in packages/trust/src/account-tree.ts and min_balance_minor = 0 is written onto every matter leaf in its creation batch, enforced by the account_balance bounds CHECK; receipts and disbursements as domain operations are the next sub-slice

- id: financial.trust.authorization-policy
  name: Disbursement authorization policy (per-firm)
  scope: Who may release money leaving a client ledger, as firm configuration. Authority is a property of the person - a member holding trust:authorize releases alone, in one act; a member without it raises a request that routes to somebody who holds it, and is told who before composing anything. Every per-firm database is seeded with that posture as version 1 (off plus the authority requirement); a firm adds a ceiling above which two people are required by writing a threshold or always version, and above the ceiling the authority requirement binds whichever of the two decides (peer approval). The earned-fee application follows the same policy through the same approval queue; in-flight requests keep the policy version they were submitted under.
  status: shipped
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: packages/trust/src/authorization-policy.ts (versioned append-only policy, the shared requires-second-person predicate, the authority assertion, resolveLoneTrustManagerException, resolveTrustAuthorizationDisposition); composeTrustDisbursementSubmission in packages/trust/src/disbursement-authorization.ts (proposal plus solo release, one batch); the seeded version-1 posture in packages/database/drizzle/per-firm/20260808T020000_trust-authority-default-posture.sql; policy-aware decision and transfer triggers in the per-firm migration; billing's applyEarnedFeesUnderAuthorizationPolicy in packages/billing/src/apply-authorization.ts; routes for the policy read/change, the disbursement submission, and the application submit/approve
  notes: Owner-directed. UI deferred. Flagged, not decided - whether the lone-holder exception should count trust:authorize rather than trust:manage (it would relax a firm with several managers and one authority holder), whether a posture relaxation itself takes a second person, and whether matter-to-matter reallocations fall under the policy.

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
  status: designed
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009
  spec: docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md
  evidence: approved design (typed profiles, baseline/overlay resolution, silence-vs-unresearched distinction) on main; packages/trust-jurisdictions does not exist yet
  awaiting-owner: An attorney review of the encoded Nevada trust profile, before any compliance surface is built on top of it.

- id: financial.trust.jurisdiction-engine.rules-catalog
  name: Trust-rules catalog (56 jurisdictions)
  scope: Verified research corpus of 56 US jurisdictions across 16 rule dimensions compiled into shared reference data.
  status: designed
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: docs/research/trust-rules/ (four jurisdiction groups + verification pass); design cites 896 verified cells; compiled data package not yet built
  notes: Research corpus complete and adversarially verified; the build-data pipeline exists only in the design.

- id: financial.trust.multi-jurisdiction-accounts
  name: Multiple active jurisdictions per firm
  scope: Each trust account opened in a state carries its own jurisdiction profile and governing-rule citation and is associated with a Location; matter trust activity defaults from the matter's home location.
  status: designed
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: trust_account-to-location binding and per-account profile in the approved jurisdiction-schema design; location.jurisdiction column shipped as the seam

- id: financial.trust.reconciliation
  name: Interactive three-way reconciliation
  scope: Monthly bank reconciliation (manual entry or banking-plugin import), match cleared items, flag outstanding/discrepancies, generate and archive a signed three-way reconciliation, per trust account.
  status: not-started
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: in slice 3-2 scope per the phase-3 slice map; the jurisdiction-schema design covers cadence rules, not the workflow; no code
  notes: Banking-plugin import additionally depends on an unbuilt banking integration.

- id: financial.trust.close-rule
  name: Zero-balance close precondition
  scope: Registers "all bills paid, no remaining balance" on the matter close-precondition hook.
  status: not-started
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: the hook is shipped and deliberately empty (packages/matters/src/close-preconditions.ts); no registration exists

- id: financial.billing
  name: Billing and invoicing
  scope: Bill generation combining time/fees, costs, and taxes across the four fee models, with a draft-to-finalize lifecycle.
  status: partial
  evidence: the invoice spine, all four fee models, and the corrections after finalization are on main (packages/billing-core, packages/billing); invoice composition, WIP-to-A/R posting at finalize, taxes, delivery and LEDES are not built
  audience: public
  public-name: Billing and invoices
  public-summary: Raise a bill on any fee arrangement, apply trust money to it, correct it afterwards without editing it, and send it out.
  awaiting-owner: Whether a credit note draws its own number from the invoice sequence or a sequence of its own.
  notes: The slice map serializes this after time and costs, which are both on main.

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

- id: financial.billing.corrections
  name: Corrections after finalization
  scope: Credit notes and their lines, the client credit a correction opens when it outruns the unpaid balance, write-offs, and the reversal of a mistaken application.
  status: shipped
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/credit-note.ts (the four composers; a correction is a second permanent record and the invoice's total never moves) and packages/billing/src/close-precondition.ts (a matter does not close over an open client credit)
  notes: Two of the three ways to discharge a client credit — a refund from operating and a return to the client's trust ledger — move real money through the operating-disbursement path and stay deferred; setting a credit against a later bill of the same client is built. Credit notes carry no number pending an owner decision.

- id: financial.billing.corrections.contingency-residual
  name: Contingency shrunk-basis residual
  scope: Reporting a contingency fee billed beyond what the surviving recovery entitles the firm to, and letting the credit note that resolves it clear the finding.
  status: shipped
  slices: 3-4-billing-and-invoicing
  evidence: readContingencyResidual in packages/billing/src/contingency.ts (the amount and the fee lines a correction would be aimed at) and contingencyBilledBeyondEntitlementStatement in packages/billing/src/fitness.ts (billed read net of credits attributed through credit_note_line.credits_invoice_line_id)
  notes: The platform reports and never issues — what a firm owes back after a settlement collapses is a decision with a client in it.

- id: financial.billing.invoice-composition
  name: Invoice composition
  scope: Bills combine time/fees plus costs plus taxes.
  status: not-started
  evidence: no invoice model in tree

- id: financial.billing.location-letterhead
  name: Location letterhead and remit-to on invoices
  scope: Invoices carry the home Location's letterhead and remit-to when the matter is location-assigned, snapshotted at finalize.
  status: not-started
  evidence: locations carry remit-to data on main; no invoice renderer consumes it

- id: financial.billing.wip-to-ar
  name: WIP to A/R posting at finalize
  scope: At invoice finalize, billable time and cost WIP convert atomically to an A/R receivable ledger entry with the Draft-to-Billed lock.
  status: not-started
  evidence: the phase-3 slice map assigns all WIP-to-A/R posting (time and cost) to the billing slice; no posting service exists

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
  audience: public
  public-name: Costs and disbursements
  public-summary: Record what the firm has laid out on a matter, from a filing fee to postage, and recover it on the bill.
  notes: Backend shipped; cost-entry UI not built; cost-to-A/R conversion and LEDES belong to the billing slice.

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
  status: partial
  slices: 3-3-costs-expenses-disbursements
  evidence: hard-cost capture as billable WIP in packages/costs
  notes: Capture shipped; the receivable posting and bill-back happen at the unbuilt billing slice per the slice map.

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
