---
number: 330
slug: a-refund-is-a-second-record-and-a-chargeback-carries-its-own-date
status: Proposed
date: 2026-08-15
area: Payments
summary: "A refund is never a deletion. A full operating refund is an invoice_application of kind `reversal`, which already exists, already requires a stated reason by trigger, and is already UNIQUE on reverses_application_id so a double reversal loses at commit. A PARTIAL refund cannot be a partial reversal for exactly that reason, so it is a full reversal plus a fresh smaller payment application in one batch — the shape trust already uses, where a partial release is a release plus a new smaller hold. A trust refund is a disbursement composed and authorized in the trust package, and payments composes none of it: the same boundary billing holds when its reversal refuses a trust transfer by name. And a chargeback's ledger entry carries the date the chargeback happened, never the original payment's — backdating would leave the LIVE proof for an already-closed reconciliation disagreeing with the frozen attestation for the same period, with nothing recording why."
---

**Money going back out is a second permanent record, and it is dated when it happened.**

**Context:** the ledger is append-only, `invoice_application` is append-only from birth, and a mistaken application is corrected by a reversal rather than an edit — an edit would move a balance whose money has already moved, with no record of having done so. Payments introduces three ways money goes back out that billing did not have to model: a refund the firm chooses, a refund the client demands through a chargeback, and an ACH return the bank performs. All three arrive after the fact, sometimes long after.

**Decision:**

(1) **A full operating refund is a `reversal` application.** The kind exists, `invoice_application_reason_required` already forces it to state why, and `invoice_application_reverses_unique_index` already makes a double reversal lose its whole batch at commit. Its own entry reverses the receipt. Payments adds no new correction mechanism to billing.

(2) **A partial refund is a full reversal plus a fresh, smaller payment application, in one batch.** The UNIQUE index means an application is reversed exactly once, whole, so a partial reversal is unrepresentable by design and should stay that way. The composition of a reversal and a smaller re-application is exactly the shape trust already uses for a partial release, it uses only mechanisms that are built and proven, and the arithmetic is exact. Two entries where one would appear to do is the correct price.

(3) **A trust refund is a disbursement, and payments composes none of it.** Returning money from a client's trust ledger to the payer is money leaving a client ledger: it goes through `trust_disbursement_request`, carries `authorized_by`, and is governed by the firm's authorization policy at the version its request was stamped with. Payments records the linkage and stops. This is the boundary billing already holds when its reversal refuses a trust transfer by name, and for the same reason: a package that composed trust statements to unwind its own postings would become a writer of trust rules the source scan forbids.

(4) **A chargeback's entry carries the date the chargeback happened.** A closed `trust_reconciliation` is frozen by trigger and can never move, but the **live** proof for that same period is recomputed from dated ledger rows on every read — so an entry backdated into a closed period changes the live answer while the frozen attestation stands, and the two disagree with nothing recording why. Dating the entry when the event happened keeps the closed period's two answers in agreement and moves the difference into the period it belongs to. The relationship to the original payment is carried by the `payment_event` row, which is where a relationship belongs.

(5) **A chargeback against trust may be unrecordable, and refusing is correct.** Reversing a deposit whose funds have since been spent drives the matter leaf negative and the `account_balance` bounds CHECK aborts the whole batch — the platform declining to let one client's chargeback be paid out of another client's money, which is the hazard the jurisdiction corpus names repeatedly. What that leaves is a real shortfall and an unmatched bank line, which is the honest state. Texas codifies the cure (reimburse the trust account within three business days, before any disbursement) and the platform cannot represent the cure: firm money onto a client's matter leaf is either bare commingling or a mechanism nobody has designed. Recorded as an open compliance gap rather than papered over.

**Consequences:** payments reuses billing's correction machinery wholesale and adds nothing to it. Two questions stay open for the owner in `docs/specs/2026-08-15-payments-design.md`: flag K3, whether `trust_movement` gains a `returned_deposit` kind so a clawback is recordable at all (today a processor clawing back a deposit is money out with no authorizer, which the shape CHECK forbids), and flag K2, whether the trust rail ships before it does. Builds on **ADR-0008** and the billing correction model.
