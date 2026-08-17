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
  surface: internal
  slices: 0-3-ledger-core-fixtures
  adrs: ADR-0072
  evidence: packages/ledger/src/reverse-entry.ts + invariants in validate.ts

- id: financial.ledger.operating-gl
  name: Operating accounting / general ledger
  scope: Extends the ledger to full firm operating books.
  status: designed
  slices: 3-5-operating-general-ledger
  spec: docs/specs/2026-08-17-general-ledger-design.md
  evidence: design + implementation plan only; no operating-books code on main and none on a branch
  notes: The design supersedes the stale one on the dormant slice-3-5-operating-general-ledger branch, which predates billing's shipped account-role map. Five sub-slices, each shippable alone; sixteen owner flags gate what is built.

- id: financial.ledger.operating-gl.chart-of-accounts
  name: Chart of accounts
  scope: The product chart-of-accounts the baseline schema defers, over the account resolver billing already shipped.
  status: designed
  slices: 3-5-operating-general-ledger
  spec: docs/specs/2026-08-17-general-ledger-design.md
  evidence: designed as four additive columns on ledger_account; fixtures/demo-chart-of-accounts.ts on main is explicitly not the product chart, and firm_account_role on main is the resolver rather than a second semantic-key map
  notes: A chart may classify a trust-registered account for statement presentation and may never map, re-section, or re-type one.

- id: financial.ledger.operating-gl.general-journal
  name: General journal
  scope: Firm-authored journal entries and their reversals over the operating books.
  status: designed
  slices: 3-5-operating-general-ledger
  spec: docs/specs/2026-08-17-general-ledger-design.md
  evidence: designed; no journal composer on main
  notes: A third door onto the posting primitive, refused at the door — every line resolves through trust's own role read and the entry refuses unless every line is outside trust.

- id: financial.ledger.operating-gl.period-close
  name: Fiscal-period close
  scope: A monotonic lock date closing every effective date at or before it, with soft reopen.
  status: designed
  slices: 3-5-operating-general-ledger
  spec: docs/specs/2026-08-17-general-ledger-design.md
  evidence: designed; no accounting_lock table on main
  notes: A scope addition to the slice rather than in its slice-map scope, and flagged for the owner as a clean cut — nothing else in the slice reads the lock.

- id: financial.ledger.operating-gl.accounts-payable
  name: Accounts payable
  scope: Accounts payable as a subledger of the operating books.
  status: designed
  slices: 3-5-operating-general-ledger
  spec: docs/specs/2026-08-17-general-ledger-design.md
  evidence: designed; no vendor-bill tables on main
  notes: Closes the negative Client Costs Advanced position billing documents as open. Payment execution at a bank stays with the Phase 6 rails.

- id: financial.ledger.operating-gl.financial-statements
  name: Financial statements
  scope: Trial balance, balance sheet, and income statement read primitives over the operating books.
  status: designed
  slices: 3-5-operating-general-ledger
  spec: docs/specs/2026-08-17-general-ledger-design.md
  evidence: designed, bitemporal in the shape packages/reporting already shipped; no statement assembly on main
  notes: This slice owns the figures and the reporting surface renders them. Each statement refuses rather than printing a figure it cannot stand behind.

- id: financial.ledger.operating-gl.quickbooks-sync
  name: QuickBooks sync
  scope: QuickBooks as an optional sync, not the system of record.
  status: not-started
  evidence: no QuickBooks integration in packages/integrations; integration platform foundation exists but carries no accounting connector
  notes: The seam's direction is designed — an export-only capability descriptor and no column anywhere that could hold a remote figure — but the adapter Worker is Phase 7·2. Bank feed is a reserved seam.

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
  surface: awaiting-screen
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: time-entry-service.ts + quick-add-parser.ts + routes/time-entries.ts
  notes: Backend shipped; entry UI not built.

- id: financial.time.capture.weekly-grid
  name: Weekly timesheet grid
  scope: Matters-by-days grid for catching up a whole week.
  status: partial
  surface: awaiting-screen
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: listWeeklyGrid fan query in packages/timekeeping/src/queries.ts; source=grid provenance
  notes: Backend query shipped; the grid itself is UI, not built.

- id: financial.time.capture.calendar-drafts
  name: Calendar-derived drafts
  scope: One-click, user-initiated conversion of a calendar event into a time entry.
  status: deferred
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: the 3-1 design reserves source=calendar and the API shape as a dormant seam; the Calendar event model it would read from has since shipped in packages/calendar, and nothing on the timekeeping side consumes it
  notes: Still deferred by decision rather than by absence — the conversion is a one-click act on a calendar surface, and no calendar surface exists to click on.

- id: financial.time.entry-model
  name: Entry anatomy and audit
  scope: Date, timekeeper, required matter, duration, narrative, billable flag, resolved rate, optional UTBMS codes, non-billable category; every change audited.
  status: shipped
  surface: internal
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: time-entry-statements.ts, non-billable-category-service.ts, audit.ts in packages/timekeeping

- id: financial.time.increments-rounding
  name: Increments and rounding
  scope: Configurable minimum increment (default 0.1 hr) and rounding rule; firm default with per-client/per-matter override.
  status: shipped
  surface: awaiting-screen
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: packages/timekeeping/src/rounding.ts + scoped-setting resolver in settings.ts

- id: financial.time.rates
  name: Effective-dated rate engine
  scope: Resolution chain matter rate, client rate, timekeeper standard, role default; multiple rate cards; an entry keeps the rate in force on its date.
  status: shipped
  surface: awaiting-screen
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: rate-resolution.ts, rate-service.ts, rate-validation.ts + routes/rate-cards.ts

- id: financial.time.narrative
  name: Narrative ergonomics
  scope: Snippet/abbreviation expansion, recent-narrative reuse, per-task-code templates.
  status: partial
  surface: awaiting-screen
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: narrative-template-service.ts + routes/narrative-templates.ts
  notes: Template store shipped; expansion/reuse ergonomics are capture-UI behaviors, not built.

- id: financial.time.lifecycle
  name: Draft-to-Billed lifecycle with optional review gate
  scope: Draft (editable) to Billed (locked) by default; firm-configurable Submitted/Approved gate, off by default; post-bill corrections are new adjusting entries.
  status: shipped
  surface: awaiting-screen
  slices: 3-1-time-tracking-wip-rate-engine, 3-3-costs-expenses-disbursements
  evidence: packages/billing-core/src/lifecycle.ts (transition rules, isFrozen) + review-gate.ts (approvalRequired setting)
  notes: The Billed transition is driven at invoice finalize by packages/billing/src/finalize.ts, which may move an entry into billed and never back out; the capture screens the gate would appear on are not built.

- id: financial.time.wip
  name: Time is WIP, not a ledger posting
  scope: Unbilled time lives in a work-in-progress store and never touches the ledger; billable time converts to an A/R receivable at invoicing.
  status: partial
  surface: internal
  slices: 3-1-time-tracking-wip-rate-engine
  evidence: per-firm WIP store in packages/timekeeping; my-day.ts documented as read-only over the WIP store, never the ledger
  notes: WIP store shipped, and the conversion it promised now happens at invoice finalize in packages/billing/src/finalize.ts; what keeps this partial is that no surface reads the store.

- id: financial.time.my-day
  name: My Day visibility
  scope: Running billable/non-billable totals, missing-time detection, billable-hour targets (daily/monthly/annual), per-matter and calendar-overlay views.
  status: partial
  surface: awaiting-screen
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
  surface: awaiting-screen
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
  evidence: packages/trust ships the account tree, the composition guard, holds, the transfer link, deposits/disbursements/reallocations, the authorization posture, the bank-charge cushion, the unclaimed-funds diligence file, three-way reconciliation and the fitness suite, over the 20260805T120000_trust-ledger and 20260805T200000_trust-reconciliation per-firm migrations; packages/trust-jurisdictions holds the typed profile model with Nevada encoded
  audience: public
  public-summary: Hold client money in trust with a balance per client that cannot go negative, and the rules of your jurisdiction enforced rather than described.
  awaiting-owner: Three controls are analysed and deliberately not built. Whether one person may relax the two-person release control and then act alone; whether matter-to-matter reallocations, which move no money out of trust, stay outside the authorization policy; and whether to close the structuring gap where two at-threshold requests pass where one larger request would not.
  notes: Backend only - no trust screen exists, and nothing reads a jurisdiction requirement through the port yet. Owner flags from the 2026-08-04 analysis stay open and are refused rather than defaulted in code.

- id: financial.trust.client-ledgers
  name: Per-client trust ledgers, no negative balance
  scope: Per-client (per-matter) trust subledgers under a per-account roll-up, with a hard no-negative-balance invariant per client ledger.
  status: partial
  surface: awaiting-screen
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0009, ADR-0072
  evidence: the three-level tree ships in packages/trust/src/account-tree.ts and min_balance_minor = 0 is written onto every matter leaf in its creation batch, enforced by the account_balance bounds CHECK; deposits, disbursements and matter-to-matter reallocations ship as domain operations in packages/trust/src/movements.ts behind required-idempotency routes
  notes: No screen reads a client ledger; the balances, holds and movement history are API-only.

- id: financial.trust.authorization-policy
  name: Disbursement authorization policy (per-firm)
  scope: Who may release money leaving a client ledger, as firm configuration. Authority is a property of the person - a member holding trust:authorize releases alone, in one act; a member without it raises a request that routes to somebody who holds it, and is told who before composing anything. Every per-firm database is seeded with that posture as version 1 (off plus the authority requirement); a firm adds a ceiling above which two people are required by writing a threshold or always version, and above the ceiling the authority requirement binds whichever of the two decides (peer approval). The earned-fee application follows the same policy through the same approval queue; in-flight requests keep the policy version they were submitted under.
  status: shipped
  surface: awaiting-screen
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: packages/trust/src/authorization-policy.ts (versioned append-only policy, the shared requires-second-person predicate, the authority assertion, resolveLoneTrustManagerException, resolveTrustAuthorizationDisposition); composeTrustDisbursementSubmission in packages/trust/src/disbursement-authorization.ts (proposal plus solo release, one batch); the seeded version-1 posture in packages/database/drizzle/per-firm/20260808T020000_trust-authority-default-posture.sql; policy-aware decision and transfer triggers in the per-firm migration; billing's applyEarnedFeesUnderAuthorizationPolicy in packages/billing/src/apply-authorization.ts; routes for the policy read/change, the disbursement submission, and the application submit/approve
  notes: Owner-directed. UI deferred. Flagged, not decided - whether the lone-holder exception should count trust:authorize rather than trust:manage (it would relax a firm with several managers and one authority holder), whether a posture relaxation itself takes a second person, and whether matter-to-matter reallocations fall under the policy.

- id: financial.trust.firm-funds
  name: Bank-charge cushion (the firm-funds carve-out)
  scope: The one purpose the firm's own money may sit in a trust account for - bearing the institution's service charges - as a second, narrower composition door rather than a relaxation of the first.
  status: shipped
  surface: awaiting-screen
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: packages/trust/src/firm-funds.ts (the per-account enablement, the deposit, the charge, the position read) behind assertTrustFirmFundsComposition in packages/trust/src/composition-guard.ts, which admits exactly two lines and refuses everything the general door refuses; the trust_firm_funds_movement table carries no client, matter, node or payee column, so a record of the category cannot describe somebody else's money; apps/worker/src/routes/trust-firm-funds.ts over the 20260812T000000_trust-firm-funds-and-unclaimed-funds and 20260812T000001_seed-trust-firm-funds-permission per-firm migrations, on a trust:firmFunds capability seeded to Owner/Admin alone
  notes: Backend only, no screen. Owner-directed and deliberately incomplete in one direction - the rule text authorizes the deposit and is silent on taking it back out, so there is no movement that withdraws surplus firm funds and none that pays a person. Refused outright on a pooled interest-bearing account, which the corpus records as exempt from the charges it would pay.

- id: financial.trust.unclaimed-funds
  name: Unclaimed client funds diligence file
  scope: Finding client money that has sat unmoved, recording the diligence done to return it, and closing the file against a payment somebody already made - never moving money and never asserting an obligation.
  status: shipped
  surface: awaiting-screen
  slices: 3-2-trust-accounting-jurisdiction-compliance
  spec: docs/research/2026-08-07-nevada-unclaimed-client-funds-escheat.md
  evidence: packages/trust/src/unclaimed-funds.ts holds readDormantTrustBalances (the only definition of dormancy anywhere - a comparison against a date the caller states, never a stored flag), the review, its contact attempts and its closure, plus the review read; five routes in apps/worker/src/routes/trust-unclaimed-funds.ts over the 20260812T000000_trust-firm-funds-and-unclaimed-funds per-firm migration; a trigger independently refuses a closure naming a payment out of another client's ledger
  notes: Backend only, no screen. Nothing on this path moves money - the closure takes a trust_movement that already posted and receives no amount, payee, date or method, so the manual-confirmation gate is the absence of the inputs rather than a check somebody could remove. Deliberately not an escheat feature - the researched jurisdiction exempts designated client trust accounts from the state presumption outright, so no deadline, countdown or required-by date is ever surfaced.

- id: financial.trust.no-commingling
  name: No commingling
  scope: Firm and client funds never commingle; fees never touch trust (processor/bank fees debit operating only).
  status: shipped
  surface: internal
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
  evidence: packages/trust-jurisdictions is built — the typed profile model carrying per-field confidence and provenance, the registry, baseline/overlay resolution preserving the silence-vs-unresearched distinction, the review gate, and Nevada encoded end to end — with its profile, review-gate and display-seam tests. Nothing consumes it yet: no trust surface reads a requirement through the port, and the other 55 jurisdictions are unencoded.
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
  status: partial
  surface: awaiting-screen
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: openTrustAccount in packages/trust/src/account-tree.ts binds every account to a location and to the jurisdiction derived from that office rather than chosen, and packages/trust/src/movements.ts refuses every movement on an account whose office recorded none (jurisdiction-not-recorded in packages/trust/src/trust-validation.ts, deliberately distinct from not-encoded and not-verified)
  notes: The binding and its refusals ship; what does not is the per-account profile actually resolving - no trust surface reads a requirement through the port in packages/trust/src/jurisdiction.ts yet - and matter trust activity defaulting to the matter's home location, which callers still name an account for.

- id: financial.trust.reconciliation
  name: Interactive three-way reconciliation
  scope: Monthly bank reconciliation (manual entry or banking-plugin import), match cleared items, flag outstanding/discrepancies, generate and archive a signed three-way reconciliation, per trust account.
  status: partial
  surface: awaiting-screen
  slices: 3-2-trust-accounting-jurisdiction-compliance
  adrs: ADR-0246
  evidence: the whole workflow is on main behind routes — packages/trust/src/bank-statements.ts (the recorded period and its lines), packages/trust/src/statement-import.ts (a preview that stores nothing, then a confirmation quoting the preview's fingerprint), packages/trust/src/matching.ts (ranked candidates a person confirms; nothing matches on its own), packages/trust/src/three-way-proof.ts (the statement, book and client-ledger legs plus the firm-funds cushion, computed from dated rows), and packages/trust/src/reconciliation.ts (open, the frozen close, the proof read) over apps/worker/src/routes/trust-reconciliation.ts and the 20260805T200000_trust-reconciliation per-firm migration
  awaiting-owner: The PDF import path is designed and unbuilt behind four calls about a firm's money. Whether a statement whose rows do not foot to its parsed closing balance is refused outright, or imported with the discrepancy recorded — refusing sends a firm with an irregular statement back to typing the month by hand, allowing it puts a difference into the bank leg of the proof that nobody can attribute to a trust problem or a parse error. Whether a scanned statement may produce stored lines at all, or recognition may only assist a person typing, which costs the firms with paper statements the most. Whether one statement line may match several ledger entries — a single deposit slip covering three cheques reads today as one match plus two items outstanding, so a firm that batches deposits has a period that can never balance, and this is the one flag the design makes no recommendation on. And how long the source PDF is kept, given it is a client's bank activity by name and amount, and whether a subject erasure request reaches it while the trust-record retention obligation runs. Trust PDF statement import design, flags S1, S2, S4 and S5.
  notes: No screen: the matter trust section is still the stub at apps/web/src/routes/(app)/matters/[id]/trust/+page.svelte, so matching, the outstanding lists and the proof are API-only. Import is the guided CSV path; a banking-plugin import still depends on an unbuilt banking integration.

- id: financial.trust.close-rule
  name: Zero-balance close precondition
  scope: Registers "all bills paid, no remaining balance" on the matter close-precondition hook.
  status: shipped
  surface: internal
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: packages/trust/src/close-precondition.ts exports matterTrustClosePrecondition and readMatterTrustPositions, registered on the matter shell's hook by the composition root in apps/worker/src/routes/matters.ts; the same question is re-asked inside the close batch by refuseMatterCloseWithTrustBalanceStatement, so a deposit landing mid-close aborts it, and packages/trust/test/close-precondition.test.ts covers both layers
  notes: Backend only, and nothing more is promised - the capability is a refusal carried by the matter close route, not a screen. The "all bills paid" half of the scope is deliberately not registered: an uncollectable receivable's lawful exit is a write-off, and the money the firm owes back is covered instead by matterClientCreditClosePrecondition in packages/billing/src/close-precondition.ts.

- id: financial.billing
  name: Billing and invoicing
  scope: Bill generation combining time/fees, costs, and taxes across the four fee models, with a draft-to-finalize lifecycle.
  status: partial
  evidence: the invoice spine (draft, claim, finalize, post, number), all four fee models, the corrections after finalization, and the delivery record are on main (packages/billing-core, packages/billing) behind apps/worker/src/routes/billing.ts; tax computation, the renderer and LEDES export are not built
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
  surface: awaiting-screen
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/draft.ts (lines composed from each entry's own rate snapshot; billing never re-resolves a rate; a flat-fee or contingency matter refuses hourly time claims by name)

- id: financial.billing.fee-models.flat-fee
  name: Flat/fixed fee
  scope: Flat and fixed-fee billing.
  status: shipped
  surface: awaiting-screen
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/flat-fee.ts (one flat_fee line from the agreement; contributing time claimed at zero for realization; instalments representable with over-billing reported by flatFeeBilledBeyondArrangementStatement)

- id: financial.billing.fee-models.contingency
  name: Contingency and settlement statements
  scope: Contingency agreements (share, costs-before-or-after election), recorded recoveries, and the fee derived at invoice time; settlement disbursement statements splitting client share, fee, costs, and liens.
  status: partial
  surface: awaiting-screen
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/contingency.ts (matter_recovery records the fact; the fee is always derived at composition, never stored as a decided number)
  notes: The fee model is shipped; settlement disbursement statements and lien handling stay deferred to a later financial slice, once a real matter demands them.

- id: financial.billing.fee-models.retainer
  name: Retainer/evergreen
  scope: Retainer and evergreen billing with auto-replenishment alerts below threshold.
  status: partial
  surface: awaiting-screen
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/retainer.ts (target and floor on the agreement; floor status from trust's available figure; retainer_replenishment_request with the billing.retainer.replenishment_requested topic)
  notes: The record and the topic are shipped; the automated below-floor alert belongs to the billing-automations slice, which consumes this same event.

- id: financial.billing.corrections
  name: Corrections after finalization
  scope: Credit notes and their lines, the client credit a correction opens when it outruns the unpaid balance, write-offs, and the reversal of a mistaken application.
  status: shipped
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/credit-note.ts (the four composers; a correction is a second permanent record and the invoice's total never moves) and packages/billing/src/close-precondition.ts (a matter does not close over an open client credit)
  awaiting-owner: What becomes of money a client over-pays, which the built mechanism cannot express — client_credit.credit_note_id is NOT NULL and the schema policy forbids the destructive rebuild that would relax it, so a payment larger than the bill cannot open a credit. Three ways out: leave the excess as received-and-unapplied cash and report it, which is safe and leaves the firm holding an unexplained figure; add a nullable payment source beside the credit note with a shape check requiring exactly one; or refuse over-payment at the application boundary and make the firm issue a refund. Payments design flag K4.
  notes: Two of the three ways to discharge a client credit — a refund from operating and a return to the client's trust ledger — move real money through the operating-disbursement path and stay deferred; setting a credit against a later bill of the same client is built. Credit notes carry no number pending an owner decision.

- id: financial.billing.corrections.contingency-residual
  name: Contingency shrunk-basis residual
  scope: Reporting a contingency fee billed beyond what the surviving recovery entitles the firm to, and letting the credit note that resolves it clear the finding.
  status: shipped
  surface: awaiting-screen
  slices: 3-4-billing-and-invoicing
  evidence: readContingencyResidual in packages/billing/src/contingency.ts (the amount and the fee lines a correction would be aimed at) and contingencyBilledBeyondEntitlementStatement in packages/billing/src/fitness.ts (billed read net of credits attributed through credit_note_line.credits_invoice_line_id)
  notes: The platform reports and never issues — what a firm owes back after a settlement collapses is a decision with a client in it.

- id: financial.billing.invoice-composition
  name: Invoice composition
  scope: Bills combine time/fees plus costs plus taxes.
  status: partial
  surface: awaiting-screen
  slices: 3-4-billing-and-invoicing
  evidence: packages/billing/src/draft.ts composes an invoice from claimed time and cost work-in-progress over the invoice, invoice_line and invoice_wip_claim tables in packages/database/src/per-firm-schema.ts, each line carrying its kind and tax treatment, behind the draft and line routes in apps/worker/src/routes/billing.ts.
  notes: Partial because tax is a declared line kind and a posting role with nothing computing it — a rate table and a jurisdiction resolution have to land before a bill can carry tax it worked out itself. Backend only, no screen.

- id: financial.billing.delivery
  name: Invoice delivery record
  scope: An append-only row per attempt at giving a client a bill — channel, recipient reference, date, external reference, outcome, and who recorded it — plus the delivery-state read the apply-funds surface shows.
  status: partial
  surface: awaiting-screen
  slices: 3-4-billing-and-invoicing
  evidence: the invoice_delivery table and its append-only, finalized-bill and not-before-issue triggers in the 20260817T000000_billing-invoice-delivery per-firm migration, recordInvoiceDelivery in packages/billing/src/delivery.ts, readInvoiceDeliveries / readInvoiceDeliveryState / readInvoiceDeliveryStates in packages/billing/src/statements.ts (the state also rides readInvoiceDetail), and the record and list routes in apps/worker/src/routes/billing.ts
  audience: public
  public-name: Recording that a bill went out
  public-summary: Record how and when a client was given a bill — by post, by hand, or by an email you sent yourself — so you can always show whether the bill reached them.
  awaiting-owner: Whether a delivery recorded in error can be corrected. The record is append-only by design and a wrong row cannot be edited or removed, but the design names no correction shape either — unlike a credit note, whose answer is a further credit note. Either a superseding row that names the one it corrects, or the record simply stands. Also unresolved: the design names outcome as a column without enumerating it, so delivered and failed are the built floor rather than an answered vocabulary.
  notes: Partial because it is a record and not a transmission - the platform renders no invoice and carries nothing to a client, so every row is a delivery the firm made and is reporting. Backend only, no screen. The client_portal channel is enumerated with nothing able to produce it until the portal lands.

- id: financial.billing.location-letterhead
  name: Location letterhead and remit-to on invoices
  scope: Invoices carry the home Location's letterhead and remit-to when the matter is location-assigned, snapshotted at finalize.
  status: not-started
  evidence: locations carry remit-to data on main; no invoice renderer consumes it

- id: financial.billing.wip-to-ar
  name: WIP to A/R posting at finalize
  scope: At invoice finalize, billable time and cost WIP convert atomically to an A/R receivable ledger entry with the Draft-to-Billed lock.
  status: shipped
  surface: internal
  slices: 3-4-billing-and-invoicing
  evidence: finalizeInvoice in packages/billing/src/finalize.ts locks every claimed entry into billed through the shared freeze contract, resolves each line's posting role (fee income, client costs advanced for a hard cost, cost-recovery income for a soft one, tax payable, fee adjustments) and writes the receivable ledger entry in the same batch, guarded so an entry that moved underneath the read fails the commit rather than leaving a finalized invoice with an unlocked entry; served by the finalize route in apps/worker/src/routes/billing.ts.
  notes: Backend only, no screen.

- id: financial.billing.ledes
  name: LEDES e-billing
  scope: Export invoices in LEDES 1998B and LEDES XML 2.0/2.1 with UTBMS codes carried through from time and cost entries.
  status: partial
  evidence: no LEDES exporter in tree; UTBMS capture upstream is shipped and its columns are documented as what "the LEDES exporter at billing reads". The per-matter e-billing flag beneath this node shipped early with the time and cost slices, which is what makes this a roll-up over mixed children rather than untouched work.

- id: financial.billing.ledes.e-billing-flag
  name: Per-matter e-billing flag
  scope: Per-matter flag driving required-code validation upstream in time and cost capture.
  status: shipped
  surface: awaiting-screen
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

- id: financial.billing.automations
  name: Billing automations
  scope: The scheduled no-client-present layer over invoicing — recurring and batch bills, payment reminders, payment plans, and evergreen below-floor replenishment.
  status: designed
  slices: 3-7-billing-automations
  spec: docs/specs/2026-08-16-billing-automations-design.md
  evidence: docs/specs/2026-08-16-billing-automations-design.md and its implementation plan; no automations module in packages/billing and no billing cron pass in apps/worker
  awaiting-owner: Three flags decide what gets built. Whether a recurring schedule may finalize a bill or only draft one — finalizing is irreversible, posts the receivable, locks work in progress, and is what permits money to leave trust. Whether payment reminders ship on or off out of the box and on what cadence, since telling a client they owe money is an act in the firm's voice and a schedule nobody set should be a stated default rather than a silence. And whether a payment plan may ever charge anything, which the design recommends against on three independent grounds rather than deferring. Billing automations design, flags M1, M2 and M3.
  notes: Every automation is tiered by consequence, and nothing scheduled moves client money — a cron pass has no actor and the trust authorization posture is built on one.

- id: financial.billing.automations.recurring
  name: Recurring bill generation
  scope: A per-matter standing instruction that composes a bill for each period, versioned and pinned to the fee agreement it was authorized against.
  status: designed
  slices: 3-7-billing-automations
  evidence: designed in docs/specs/2026-08-16-billing-automations-design.md; the composers it would call (createInvoiceDraft, addClaimsToDraft) ship in packages/billing/src/draft.ts and nothing schedules them

- id: financial.billing.automations.batch
  name: Batch bill generation
  scope: A member selects matters and gets drafts, with one run record per target naming what happened to each including the skips.
  status: designed
  slices: 3-7-billing-automations
  evidence: designed in docs/specs/2026-08-16-billing-automations-design.md; no run tables in packages/database/src/per-firm-schema.ts

- id: financial.billing.automations.reminders
  name: Payment reminders
  scope: A comparison over unpaid finalized invoices past their due date, recorded as a durable billing decision and surfaced through the notifications subsystem.
  status: designed
  slices: 3-7-billing-automations
  evidence: designed in docs/specs/2026-08-16-billing-automations-design.md; no reminder table and no billing notification type beyond invoice finalized and voided in packages/notifications/src/registry.ts
  notes: A prompt to the firm rather than a letter to the client — every notification audience resolves to a member and the client portal is not started. The delivery record it needed is now built (financial.billing.delivery), so a reminder can state whether the bill was ever recorded as given to the client; it still cannot deliver one.

- id: financial.billing.automations.payment-plans
  name: Payment plans
  scope: An instalment schedule recorded against a finalized invoice, with the standing derived from what has actually been applied.
  status: designed
  slices: 3-7-billing-automations
  evidence: designed in docs/specs/2026-08-16-billing-automations-design.md; no payment plan tables in tree
  notes: The record half is buildable now; charging is unreachable on three independent grounds — no payment rail, no stored method, and no principal an unattended charge could be checked against.

- id: financial.billing.automations.replenishment
  name: Evergreen below-floor replenishment
  scope: A scheduled comparison of each retainer matter's available trust balance against the agreement's floor, raising the replenishment ask the firm can act on.
  status: designed
  slices: 3-7-billing-automations
  evidence: designed in docs/specs/2026-08-16-billing-automations-design.md; readRetainerStatus and requestRetainerReplenishment ship in packages/billing/src/retainer.ts with the billing.retainer.replenishment_requested topic, and nothing calls them on a schedule or subscribes to the topic

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
  surface: awaiting-screen
  slices: 3-3-costs-expenses-disbursements
  evidence: cost-entry-service.ts, cost-validation.ts (shared UTBMS catalog; isEBillingMatter check)
  notes: Backend shipped; entry UI not built.

- id: financial.costs.hard
  name: Hard costs as client receivable
  scope: Firm-advanced third-party costs (filing, recording, service, experts, postage/shipping) advanced as a client receivable and billed back.
  status: partial
  surface: awaiting-screen
  slices: 3-3-costs-expenses-disbursements
  evidence: hard-cost capture as billable WIP in packages/costs
  notes: Capture shipped, and the receivable posting is shipped with it — packages/billing/src/finalize.ts credits client costs advanced for a hard cost, keeping it an asset the firm is repaid rather than income. The cost entry screens are not built.

- id: financial.costs.soft
  name: Soft/in-house costs
  scope: In-house costs (printing, copies) tracked separately from hard costs.
  status: partial
  surface: awaiting-screen
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
  surface: internal
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
