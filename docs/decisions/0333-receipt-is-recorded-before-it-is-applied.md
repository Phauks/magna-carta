---
number: 333
slug: receipt-is-recorded-before-it-is-applied
status: Proposed
date: 2026-08-15
area: Payments
summary: "Recording that money arrived is never gated on the money fitting an invoice. The invoice_matter_balance bounds CHECK aborts a whole D1 batch when an application exceeds what a bill can absorb — which is correct and must not be weakened — so composing the receipt and the application in one batch would mean an over-payment aborts the record of money the firm has already received. Receipt and application are therefore two acts: the ledger entry posts, and the invoice_application of kind `payment` is composed in the same batch when it fits and not at all when it does not. Money received and unapplied is a visible reportable state, which is what it actually is. This resolves partial payment (ordinary), over-payment (received, unapplied — a client credit is unavailable because client_credit.credit_note_id is NOT NULL and SQLite cannot relax it without a rebuild the schema policy forbids), and payment against a bill that can absorb nothing (refused by name, money kept)."
---

**Money that arrived is recorded whether or not it fits a bill, because the mechanism that stops over-application aborts the whole batch.**

**Context:** billing's `invoice_matter_balance` carries a bounds CHECK on `applied_minor`, and the delta statement is deliberately unguarded — a guarded `UPDATE` would look safer and be strictly worse, because a zero-row update aborts nothing and a losing batch would commit its ledger entries beside a balance that never moved. That arrangement is the only thing that makes "this invoice has enough unpaid balance" structural rather than hopeful, and it is not being weakened.

Its consequence for payments is the sequencing question the whole subsystem turns on. A trust transfer or a credit note is composed by a firm that already knows the amount fits. A payment is not: the money has already left the client's hands by the time anything is composed, and the amount is whatever the client sent. If the receipt rode the application's batch, an over-payment would abort — and the thing aborted would be the record of money the firm is now holding.

**Decision:**

(1) **Receipt and application are two acts.** The ledger entry recording the money arriving is composed and committed on its own footing. The `invoice_application` of kind `payment` is composed alongside it when the amount fits the matter's outstanding balance, and is simply absent when it does not. `invoice_application_entry_paired` already requires a payment application to name its own entry, so the application when present is the ordinary shape and needs no billing schema change.

(2) **Received-and-unapplied is a first-class state, not an error.** It is what a firm's books say when a client overpays, pays a bill that has since been credited in full, or pays against a matter whose share is already settled. Reporting it is the remedy; refusing to record it is not.

(3) **Partial payment needs nothing.** An application for less than the outstanding balance is the ordinary path.

(4) **Over-payment does not automatically open a client credit, and cannot under the built schema.** `client_credit.credit_note_id` is `NOT NULL`, so a client credit exists today only as the residue of a credit note, and SQLite cannot relax a `NOT NULL` without the destructive table rebuild the schema policy forbids on a table holding data. The excess stays received-and-unapplied unless the owner directs one of the alternatives — a nullable `payment_id` sibling with a shape CHECK requiring exactly one source, or refusing over-payment at the application boundary and requiring a refund.

(5) **There is no such thing as a superseded invoice, so that case reduces to two others.** A finalized invoice is frozen by trigger, there is no un-finalize, and a correction is a credit note standing beside it whose `total_minor` never moves. What a payer can actually hit is a bill that can absorb nothing (fully paid, credited or written off) or a draft with no balance rows. Both refuse the application by name, naming the invoice and its state, and both keep the money.

**Consequences:** the payments subsystem can accept money it cannot place, which is the only honest posture for a subsystem whose input is other people's decisions. The bounds CHECK keeps its full strength and nothing about it is worked around. One question stays open for the owner and is flag K4 in `docs/specs/2026-08-15-payments-design.md`: whether an over-payment should be able to open a client credit, and by what mechanism given the `NOT NULL`. Builds on **ADR-0008** (append-only) and the billing invoice model.
