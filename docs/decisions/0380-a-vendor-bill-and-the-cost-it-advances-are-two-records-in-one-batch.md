---
number: 380
slug: a-vendor-bill-and-the-cost-it-advances-are-two-records-in-one-batch
status: Proposed
date: 2026-08-17
area: Financial Core
summary: "A vendor bill records what the firm owes the vendor; a cost entry records what the firm may bill the client. They are different obligations with different lifecycles, so accounts payable writes both and the ROUTE commits them in one D1 batch — recordVendorBill returns its statements, the costs slice's capture returns its own, neither package imports the other, and a fitness query proves a matter-tagged hard line always carries its cost entry. The debit routes on the line's disbursement class and misrouting it is a tax error rather than a cosmetic one: a hard cost debits Client Costs Advanced with no profit-and-loss impact because an advanced client cost is a loan to the client and not the firm's deductible expense (Canelo v. Commissioner), while a soft cost debits the line's own expense account and is reimbursed as income. This closes the negative Client Costs Advanced position billing documents as open. The link lives on vendor_bill_line.disbursement_entry_id rather than as a fourth cost_entry.source value, because SQLite cannot widen a CHECK without a destructive rebuild of a table holding data — the earlier design got this wrong — and because provenance derived from a link is the same shape reversed-status already takes. The column is not named cost_entry_id: the schema conformance gate refuses that name. A bill's state is DERIVED, with no status column: an append-only payment table plus a bounds-checked paid_minor delta, the invoice_matter_balance arrangement, so two payments racing for one remainder abort rather than overpay and a guarded UPDATE — which cannot abort a batch — is never used as the guard."
---

**Accounts payable writes two records for one bill, the route commits them together, and the debit
routes on the disbursement class.**

**Context:** a vendor bill for an expert witness is simultaneously a payable to the vendor and, where
the cost is advanced on a client's behalf, a recoverable from the client. The costs slice already models
the vendor link and the hard/soft classification on `cost_entry`, and billing already routes hard costs
to Client Costs Advanced and soft costs to Cost Recovery Income at finalize — and records that Client
Costs Advanced "runs negative until operating disbursements land" as an open position. These are those
disbursements.

**Decision:**

(1) **Two records, one batch, composed by the route.** `recordVendorBill` returns its statements and the
costs slice's capture returns its own; the route spreads both into one `runIdempotentEffect`. Neither
package imports the other. A single service owning both writes would buy atomicity a shared batch
already provides at the price of a dependency edge; a `cost.recorded` outbox message would introduce
eventual consistency to solve a problem one batch solves, and would misuse the outbox, which exists for
external consequences. A fitness query proves the pair over stored rows, catching a future call site
that composes the ledger statements and forgets the capture.

(2) **The debit routes on `disbursement_class`, and getting it wrong is a tax error.** `hard` posts
`Dr Client Costs Advanced` (matter-tagged) `/ Cr Accounts Payable`, with no profit-and-loss impact,
because an advanced client cost is a loan to the client rather than the firm's deductible expense
(_Canelo v. Commissioner_, 53 T.C. 217 (1969), aff'd 447 F.2d 484 (9th Cir. 1971)). `soft` posts
`Dr <the line's own expense account> / Cr Accounts Payable`, expensed now and reimbursed as income
later. A line with no expense account refuses; there is no default.

(3) **The link is a column on this slice's own table, not a fourth `cost_entry.source` value.**
`vendor_bill_line.disbursement_entry_id` references `cost_entry.id`, and a bill-originated cost's
provenance is derived from that link — the same shape reversed-status already takes, derived from the
reverses link rather than a flag. Widening the `cost_entry.source` CHECK would cost a destructive
rebuild of a table holding data, which the schema policy forbids and which billing's own
`invoice_delivery.channel` note records. The column is not named `cost_entry_id` because the schema
conformance gate refuses a money-ish column name without a `_minor` or `_rate_e4` suffix.

(4) **A bill has no status column.** Its state — unpaid, part-paid, paid — is derived from an
append-only `vendor_bill_payment` table plus a `paid_minor` delta on `vendor_bill_balance` under a
bounds CHECK, the arrangement `invoice_matter_balance` carries. The delta statement is deliberately
unguarded: a `WHERE amount_minor - paid_minor >= ?` guard looks safer and is strictly worse, because a
zero-row UPDATE is not an error in SQLite and the losing batch would commit its ledger entry beside a
balance that never moved. The CHECK is the guarantee.

(5) **A bill entered in error is reversed**, with an append-only reversal row carrying the actor and a
required reason, and no further payment may name a reversed bill. Vendor credits — the vendor's own
credit memo, and the mirror of billing's credit note — are deliberately not designed alongside four
other subsystems.

(6) **Paying a bill resolves the operating bank through the role map and takes no caller-supplied cash
account.** A trust account is refused twice over: it is not what the role resolves to, and the
trust-refusal rule binds this composer. Executing the payment at a bank is out of scope.

Builds on **ADR-0008** and **ADR-0072**.
