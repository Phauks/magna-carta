---
number: 334
slug: the-trust-rail-requires-gross-per-transaction-settlement
status: Proposed
date: 2026-08-15
area: Payments
summary: "A processor serving the trust rail must deposit each payment to the trust bank account gross and individually, and an adapter that cannot declare it in its capability descriptor returns capability-unsupported for that rail. The binding reason is reconciliation, not compliance: composeTrustReconciliationMatch ties one statement line to one ledger entry, so a batched net deposit covering ten clients' payments leaves nine entries outstanding forever and one bank line unmatched, and the three-way proof reports a difference every month until a firm learns to ignore the one report that would also catch a real misappropriation. The gross-deposit rules want the same thing, but the reconciliation is the reason that will be forgotten first, so it is the reason recorded. The operating rail is unaffected and settles through a clearing account instead."
---

**The trust rail's hard requirement is a reconciliation requirement that happens to agree with the rules.**

**Context:** `composeTrustReconciliationMatch` exists only because a caller named both ends; there is deliberately no composer that takes a suggestion, because a wrong automatic match is worse than no match — the totals tie out while the ledger and the bank disagree about which events happened, and the reconciliation then certifies the discrepancy it exists to find. The rule underneath it is one line clears one entry, checked in the composer and re-proved over stored rows, and `packages/trust/CLAUDE.md` already records the one-line-covers-several-items case as a real shape the platform does not express.

A batch-settling processor produces exactly that shape, at scale, every night. One deposit to the trust bank covers ten clients' card payments; ten `trust_movement` deposits exist on ten different matter leaves; one bank line exists. Nine of the ten entries are outstanding forever, the bank line is unmatched forever, and the three-way proof reports a difference every month. The failure mode is not an error — it is a firm learning that its trust reconciliation always disagrees and is safe to ignore.

**Decision:**

(1) **Per-transaction gross settlement to the trust bank account is a hard requirement of the trust rail.** Each payment reaches the trust bank as its own deposit, for its full amount, with nothing withheld.

(2) **The capability descriptor is where the platform records it.** An adapter declares `grossTrustSettlement` and `separateFeeAccount`; one that cannot returns `capability-unsupported` for the trust rail — a first-class dispatch outcome the caller branches on rather than an error it catches. The operating rail is unaffected by either declaration.

(3) **The reason recorded is the reconciliation one.** The gross-deposit rules in the jurisdiction corpus want the same arrangement, and a future reader will assume that is the whole story. It is not: the compliance reason is satisfied by any arrangement that keeps the fee off client principal, including a monthly net deposit with the fee separately invoiced, and that arrangement would destroy the reconciliation. Naming the weaker reason and omitting the stronger one is how this requirement gets relaxed by somebody being helpful.

(4) **The platform cannot verify a processor's back-office configuration, and does not pretend to.** The descriptor is a declaration by the adapter's author, not a probe. What backs it is detection after the fact: a fitness query proves every payment-produced trust movement's entry amount equals the payment's gross amount, and the reconciliation surfaces any deposit the bank recorded differently from the book.

**Consequences:** the trust rail is available only through adapters whose author has confirmed the merchant configuration, which is the correct gate and is a procurement fact rather than an engineering one. The operating rail needs none of this and settles through a payments-clearing account instead, which gives it the same one-line-one-entry property by a different route. Whether the trust rail is in the first electronic slice at all is flag K2 in `docs/specs/2026-08-15-payments-design.md`. Builds on **ADR-0032** (separate deposit routing), **ADR-0091** (the capability descriptor), and the trust reconciliation model.
