---
category: Added
audience: internal
---

**The payments subsystem is designed, and the finding that matters most is not about payments: billing
shipped four fee models, credit notes, client credits, write-offs and the trust application, and a firm
still cannot record a client's cheque.**

`composeInvoiceApplication` refuses the `payment` application kind for **every** rail, not only the
electronic ones. A manual receipt needs no port, no adapter, no webhook, no merchant account and no PCI
posture — one composer, one ledger entry through the account-role map, and one application. It closes
the "a firm can produce an invoice and has no way to be paid for it" gap on its own, and it is the first
stage of the plan for that reason. Owner flag K1.

**Where the processor's fee lands for a trust-destined payment, which is the question the design lives
or dies on.** It lands on the firm's operating account, borne by the firm, always. A trust-destined
payment is two independent ledger entries — the gross deposit through `composeTrustEntry`, and
`Dr Merchant Fees / Cr Operating Bank` touching no trust account — and **they cannot be joined by a
ledger entry, because an entry joining them is exactly the commingling the guard refuses.** So they are
joined by a payment record instead, and that is the central move of the whole subsystem. The firm's
cushion inside the trust account may not bear it either: the second door's category is closed at
`firm_funds_deposit` and `bank_charge`, and a card processor's discount rate is not the institution's
service charge. The one shape that is dangerous because it _is_ expressible — a firm depositing its own
money onto a client's matter leaf through `composeTrustDeposit`'s free-text `source`, which the guard
cannot catch because the other leg is the trust bank — is refused by name.

**What could not be established, and is flagged rather than defaulted.** `processorFees` in
`@magna-carta/trust-jurisdictions` is exactly the field that would settle whether a fee may reduce
client principal, and Nevada — the only jurisdiction the platform ships — records it as `GAP`: four
sources searched for five terms with no hit, and the ethics-opinions index never worked through. The
corpus states the principle everywhere and verifies it almost nowhere, and the four jurisdictions that
address it expressly **disagree** — Arizona permits a merchant-fee cushion inside trust outright, Texas
and Maine instead permit a non-trust transit account with a two-business-day window and Texas adds a
three-business-day chargeback reimbursement duty. So the design implements only the arrangement that is
safe under every possible answer and refuses by name every arrangement that would need the field to
resolve. The `GAP` stands.

**A processor that debits the trust account is surfaced, never absorbed.** The fee arrives as a bank
statement line nothing can clear, the three-way proof reports a `bank-to-book` difference of exactly that
amount, and a close freezes the unbalanced answer. That is the existing posture applied to a condition
reconciliation exists to catch.

**The trust rail's hard requirement is a reconciliation requirement, not a compliance one.**
`composeTrustReconciliationMatch` ties one statement line to one ledger entry, so a batch-settling
processor leaves nine of ten deposits outstanding forever and one bank line unmatched, and a firm learns
that its trust reconciliation always disagrees. The gross-deposit rules want the same arrangement, but
the compliance reason is satisfied by arrangements that would destroy the reconciliation — so the
reconciliation reason is the one recorded, because it is the one that gets relaxed by somebody being
helpful.

Also settled: a payments-clearing account so one settlement entry matches one bank line; receipt recorded
before it is applied, because the `invoice_matter_balance` bounds CHECK aborts a whole batch and would
otherwise abort the record of money the firm already holds; no status column on a payment, with state
derived from an append-only event log; a partial refund as a full reversal plus a smaller re-application,
on the trust partial-release precedent; and a chargeback dated when it happened, never backdated into a
period whose reconciliation is already frozen.

**The platform's first inbound webhook** is specified here because there is none to copy: raw-byte
signature verification before parsing, the firm named by an unguessable path segment (the signing secret
is per-firm and the body is attacker-controlled until it verifies), idempotency keyed on the processor's
event id and settled by a UNIQUE at commit, and a scheduled settlement pull because webhooks are lost.
One concrete hazard is recorded rather than left to be rediscovered: `idempotencyMiddleware` reads the
body through `context.req.json()` and consumes the raw stream the signature is computed over, so mounting
the house idiom in front of a webhook route fails looking like a wrong secret.

Two documentation drifts found: the white paper's _Payments_ area still describes in-DOM hosted-fields
tokenization, which ADR-0181 rejected by name as SAQ A-EP; and `packages/trust-jurisdictions/CLAUDE.md`
together with the comment in `src/data/nevada.ts` still say the bank-charge carve-out is not wired and
that the composition guard refuses every posting to a firm-funds node, which stopped being true when
`composeTrustFirmFundsEntry` landed.

No feature code, no schema, no migration, no route. Twelve owner flags in a new `K` series; seven decide
what gets built and the plan does not start until they are answered.
