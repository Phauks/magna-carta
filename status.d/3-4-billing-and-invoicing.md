---
slice: 3·4 — Billing & invoicing
group: phase-3
order: 4
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: in-progress by="Opus 5"
ui: todo
load-profile: done by="Opus 5"
tested: in-progress by="Opus 5"
branch: claude/billing-fee-models
active-work: docs/active-work/claude/billing-fee-models.md
next: Taxes; credit notes, client credits, write-offs and reversals; presentation, delivery, LEDES
link-spec: docs/specs/2026-08-05-billing-design.md
link-plan: docs/specs/2026-08-05-billing-implementation-plan.md
adrs:
blocked-by:
---

**Sub-slice 1 built — the invoice spine.** `@magna-carta/billing` over a new seven-table schema: the draft/final/void invoice with no stored total and no stored balance, lines that each name their matter, the work-in-progress claim whose partial unique index is the concurrency control, and the per-`(invoice, matter)` balance whose bounds CHECK is the mechanism a later earned-fee transfer depends on. Finalization is one composed batch — the number draw, the presentation snapshot, the `billed` lock on every claimed entry through the shared freeze contract, the balance rows, and the accounts-receivable posting — with a commit guard that aborts the whole thing if a claimed entry was frozen between the read and the commit. A finalized invoice is immutable by trigger, and the numbering pair is append-only. An unmapped `firm_account_role` refuses finalization by name rather than posting somewhere plausible.

Also extracts the counter/allocation numbering idiom into `@magna-carta/sequence-numbering`, consumed by matters (behaviour bit-for-bit, its whole suite the proof) and by billing.

**Sub-slice 2, the trust half — value reaching an invoice, and T4 closed.** `invoice_application` (append-only, the full closed kind set in its CHECK because SQLite cannot widen one without a destructive rebuild) plus `composeInvoiceApplication`, the one door any value reaches an invoice through: the application row and the `applied_minor` delta, always paired, so the invoice subledger cannot drift from the accounts-receivable control account. Billing now satisfies trust's `EarnedFeePrecondition` — a finalized invoice whose client matches the ledger being drawn on, which bills that matter, with enough unpaid balance on that matter's own row, and named amounts summing to the transfer — closing flag T4 with **no change to `@magna-carta/trust`**, which is the test that the seam sits in the right place. `applyTrustFundsToInvoices` merges trust's two-linked-entry transfer with the applications into ONE batch: a concurrent consumer of the balance aborts the whole thing, trust entries included. The trust kind composes **no ledger entry** — the transfer's operating leg already credited the receivable — with a dedicated test proving the subledger still equals the control account after a trust-funded fee, and a fitness query re-proving exactly one receivable credit per trust application over stored rows. Over HTTP as `POST /api/v1/billing/trust-applications` on `billing:apply`, idempotency required. The trust-refusal-to-problem mapping moved to one shared home now that two route modules reach it.

**All four fee models — the owner's docket direction, built.** `matter_billing_arrangement` is the per-matter fee agreement, versioned append-only in the rate-engine shape hardened by trigger: a fee change is a NEW version, versions are dense per matter, exactly one is in force, and the only edit a version ever takes is the one-time close of its `valid_to` — because invoice lines now record the agreement version that composed them (`invoice_line.billing_arrangement_id`), so what a finalized bill was computed under is permanent. Absence means hourly. The flat fee is one line plus zero-amount claims on the contributing time (instalments representable, over-billing reported by fitness query); a flat-fee or contingency matter refuses hourly time claims by name while its costs stay claimable. The contingency fee is ALWAYS DERIVED, never stored: `matter_recovery` records the settlement or judgment (void-with-reason its only edit) and the fee is computed at composition — the agreed share against the gross recovery or the recovery net of advanced hard costs, per the recorded election — landing as an ordinary reviewable line. The evergreen retainer records target and floor on the agreement, reads trust's own AVAILABLE figure, and records a `retainer_replenishment_request` (observed balance, shortfall, one open per matter, resolution-only edits) emitting `billing.retainer.replenishment_requested` — the notifications seam, with the below-floor automation belonging to 3·7. NO new trust write shape anywhere: advance fees sit where the agreement's recorded destination says, and money leaves trust only through the existing earned-fee application. Per owner override B4, the multi-matter render shape is a fact on the invoice model: a firm default (per-matter pages plus a summary ships as the default), overridable per finalize, snapshot onto `invoice.render_shape` with the letterhead, and served by a render-model derivation the PDF tail will consume. Migration idx 49 (`20260807T060000_billing-fee-models`); thirteen new chokepoint routes on the existing six billing permissions.

Taxes, credit notes, client credits, write-offs and reversals — including the credit-note-after-transfer case, which the design deferred on purpose because giving back money already in the firm's operating account is a firm-funds decision the platform will not make on its own — remain open, as do presentation, delivery, and LEDES (4) and settlement disbursement statements (a later financial slice).
