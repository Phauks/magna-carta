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
branch: claude/billing-slice-1
active-work: docs/active-work/claude/billing-slice-1.md
next: Value reaching an invoice — applications, the earned-fee precondition, credit notes, client credits
link-spec: docs/specs/2026-08-05-billing-design.md
link-plan: docs/specs/2026-08-05-billing-implementation-plan.md
adrs:
blocked-by:
---

**Sub-slice 1 built — the invoice spine.** `@magna-carta/billing` over a new seven-table schema: the draft/final/void invoice with no stored total and no stored balance, lines that each name their matter, the work-in-progress claim whose partial unique index is the concurrency control, and the per-`(invoice, matter)` balance whose bounds CHECK is the mechanism a later earned-fee transfer depends on. Finalization is one composed batch — the number draw, the presentation snapshot, the `billed` lock on every claimed entry through the shared freeze contract, the balance rows, and the accounts-receivable posting — with a commit guard that aborts the whole thing if a claimed entry was frozen between the read and the commit. A finalized invoice is immutable by trigger, and the numbering pair is append-only. An unmapped `firm_account_role` refuses finalization by name rather than posting somewhere plausible.

Also extracts the counter/allocation numbering idiom into `@magna-carta/sequence-numbering`, consumed by matters (behaviour bit-for-bit, its whole suite the proof) and by billing.

Applications, the earned-fee precondition, credit notes and client credits (sub-slice 2); arrangements and taxes (3); presentation, delivery, and LEDES (4) are open.
