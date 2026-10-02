---
number: 332
slug: payments-settle-through-a-clearing-account
status: Proposed
date: 2026-08-15
area: Payments
summary: "An operating card or ACH payment posts against a payments-clearing account at capture and clears against the operating bank at settlement, so one settlement entry corresponds to one bank line. Capture is Dr Payments Clearing / Cr Accounts Receivable, named by the invoice_application of kind `payment`; settlement is Dr Operating Bank (net) plus Dr Merchant Fees (the fee) against Cr Payments Clearing (gross). Posting gross straight against the operating bank and the fee as a second entry would make one bank line correspond to two entries in opposite directions — the shape a one-line-clears-one-entry reconciliation cannot express, and the shape trust already records as unexpressible. Two new firm_account_role members, payments_clearing and merchant_fees, resolved through the existing map, which refuses by name when unmapped. The trust rail has no clearing account and cannot: a clearing account is not a trust account, so an entry pairing it with a matter leaf is refused."
---

**A processor holds money between capture and deposit, so the books hold it too.**

**Context:** a processor captures now and deposits later, often netting its fee at deposit, so the bank line a firm sees is a net figure for a settlement batch. Two postings are unavoidable — the gross receipt against accounts receivable, and the fee as an expense — and the question is what they post against.

The naive answer posts both against the operating bank: `Dr Operating Bank / Cr Accounts Receivable` for the gross, and `Dr Merchant Fees / Cr Operating Bank` for the fee. The arithmetic is right and the reconciliation is wrong. One bank line then corresponds to two entries moving the bank balance in opposite directions, and `composeTrustReconciliationMatch`'s one-line-clears-one-entry rule is not a trust quirk — it is the shape any bank reconciliation takes. `packages/trust/CLAUDE.md` already records the one-line-covers-several-items case as a real shape the platform does not express, where the proof reports the difference rather than hiding it. Designing a new subsystem straight into that shape, on purpose, when an operating bank reconciliation does not yet exist to complain, would be building the retrofit in.

**Decision:**

(1) **Capture posts `Dr Payments Clearing / Cr Accounts Receivable`**, for the gross amount, named by the `invoice_application` of kind `payment` through the `entry_id` the pairing trigger already requires.

(2) **Settlement posts `Dr Operating Bank` for the net plus `Dr Merchant Fees` for the fee, against `Cr Payments Clearing` for the gross** — one entry, matching one bank line, whatever the processor's netting behaviour.

(3) **The clearing balance means something.** It is money the processor is holding, and a fitness query proves it equals the sum of captured-but-unsettled payments. A drifting clearing balance is the first symptom of a lost settlement event, which is exactly the failure a webhook-only subsystem has.

(4) **Two new account roles, refusing when unmapped.** `payments_clearing` and `merchant_fees` join `ACCOUNT_ROLES` and resolve through `firm_account_role`. An unmapped role refuses by name and says where to set it, on the existing reasoning that the product chart of accounts does not exist and a fact we do not have is not a fact we invent. A firm that has not mapped them cannot take a card payment, which is the correct order of operations.

(5) **The trust rail has no clearing account, and this is not a gap.** A clearing account is not a trust account, so an entry pairing it with a matter leaf is refused by the composition guard. A trust deposit is recorded when the money reaches the trust bank, gross, and its fee is the unrelated operating entry. The asymmetry between the rails follows from the guard.

**Consequences:** an operating bank reconciliation, when the operating general ledger builds one, sees one entry per bank line without any payments change. The clearing account is a foundation added while in the area rather than a retrofit, which is the build-when-in-the-area rule applied to an accounting shape. Confirming the two roles rather than posting straight to the bank is flag K8 in `docs/specs/2026-08-15-payments-design.md`. Builds on **ADR-0072** and billing's account-role seam.
