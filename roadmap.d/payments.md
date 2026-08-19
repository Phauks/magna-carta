# Payments

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Payments -->

- id: payments
  name: Payments
  scope: Payment acceptance as a swappable-adapter port, ACH-default with card fallback, structured so processor fees never touch trust.
  status: designed
  adrs: ADR-0032
  spec: docs/specs/2026-08-15-payments-design.md
  evidence: Design spec and implementation plan exist; no payments package, adapter, or rail code, and the invoicing substrate on main processes no money. Seven build-gating owner flags stand between the plan and a first commit.
  audience: public
  public-name: Client payments
  public-summary: Let a client pay a bill by bank transfer or card, with card fees kept away from trust money.
  awaiting-owner: The order the area is built in, which is the one question every other payments flag hangs off. The design's sequence is the manually recorded receipt first with no processor involved at all, then the operating electronic rail, then the trust rail once a returned-deposit movement kind exists — and it says so out loud rather than letting the trust rail slip in beside the operating one, because the trust rail additionally needs a merchant configuration confirmed with the processor. Confirm or reorder; the per-node lines below carry what each step is separately blocked on. Payments design flags K1 and K2.

- id: payments.port
  name: Payments port
  scope: Vendor-swappable payments adapter behind the plugin/port system.
  status: designed
  slices: integration-port-system
  adrs: ADR-0091
  spec: docs/specs/2026-08-15-payments-design.md
  evidence: The integration port system it will sit behind is shipped; no payments port defined. The port's five methods and its capability descriptor are specified.
  awaiting-owner: Can both deposit destinations live inside one connection's credential payload, or must the registry's one-connection-per-category resolution widen? Payments design flag K9.

- id: payments.manual-receipt
  name: Manually recorded receipt
  scope: Record a cheque, cash, wire or in-person terminal payment against a finalized invoice, with no processor, port or adapter involved.
  status: designed
  slices: 3-4-billing-and-invoicing
  spec: docs/specs/2026-08-15-payments-design.md
  evidence: The invoice_application kind, its CHECK constraint, the entry-pairing trigger and the billing:apply capability all exist; composeInvoiceApplication refuses the payment kind for every rail, so a firm cannot record a cheque.
  audience: public
  public-name: Record a payment
  public-summary: Mark a bill as paid when a client sends a cheque, cash or a bank transfer.
  awaiting-owner: Does this ship as the first payments slice, ahead of any processor work? Payments design flag K1.

- id: payments.ach
  name: ACH rail (default)
  scope: Bank-transfer rail presented as the default, prominent option with small flat/capped fees.
  status: designed
  adrs: ADR-0032
  spec: docs/specs/2026-08-15-payments-design.md
  evidence: Decision recorded; no code. Designed for the operating destination; the trust destination is gated.
  awaiting-owner: Who presses the button on the first electronic payment, given the client portal is not started. Staff-operated only, where the firm opens the hosted modal on the client's behalf in the office or over the phone; a one-time pay link, on the precedent of the one-time link that already proves a mailbox; or wait for the portal and ship no electronic rail until then. This decides whether the first payments slice has any client-facing surface at all. Payments design flag K7.

- id: payments.card
  name: Card rail (fallback)
  scope: Card acceptance as the convenience fallback.
  status: designed
  adrs: ADR-0032
  spec: docs/specs/2026-08-15-payments-design.md
  evidence: Decision recorded; no code. Designed for the operating destination; the trust destination is gated.
  awaiting-owner: Is the trust rail in scope at all before a returned-deposit movement kind exists, given a chargeback against trust is unrecordable today? Payments design flags K2 and K3.

- id: payments.trust-separation
  name: Fees never touch trust
  scope: Trust/IOLTA deposits land gross; card fees debit operating only, enforced by separate deposit destinations per rail.
  status: designed
  adrs: ADR-0032
  spec: docs/specs/2026-08-15-payments-design.md
  evidence: Already enforced structurally by the trust composition guard for every caller including a rail that does not exist; what is missing is not the enforcement but the fee's operating home and the record joining the two halves.

- id: payments.surcharge
  name: Operating-only surcharge
  scope: Optional card surcharge/convenience fee on operating (never trust) payments, gated by jurisdiction config; debit never surcharged.
  status: not-started
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: No surcharge logic. The jurisdiction requirement it needs does not exist in the trust-jurisdictions typed contract at all, and card-network registration is a procurement prerequisite.
  awaiting-owner: Confirm surcharge stays out of the first slice — it needs a new typed jurisdiction requirement in the restriction bucket, 56 jurisdictions of primary-source research with attorney review, and card-network registration. Payments design flag K6.

- id: payments.helcim
  name: Helcim launch adapter
  scope: Launch adapter covering both rails — interchange-plus cards and capped-fee ACH.
  status: not-started
  adrs: ADR-0032
  evidence: Vendor decided; no adapter code. The adapter must declare gross per-transaction trust settlement and a separate fee account before the trust rail dispatches at all.

- id: payments.pci-scope
  name: PCI scope minimization
  scope: Card capture exclusively via the processor's hosted payment modal returning a cardToken; store token plus last-four/brand only; script-clean payment page; SAQ A.
  status: designed
  adrs: ADR-0032, ADR-0181
  spec: docs/specs/2026-08-15-payments-design.md
  evidence: ADR-0181 (Accepted, 2026-07-02) refines ADR-0032 onto the hosted modal, including planned fitness functions; no code. The pending fragment it was assembled from is gone, as fragments are.
  notes: The white paper's Payments area has been corrected to match — it now names HelcimPay.js as the only capture path and rejects the in-DOM Helcim.js tokenizer by name as SAQ A-EP.

- id: payments.alternate-adapters
  name: Alternate adapter seams
  scope: Stripe/Dwolla for cheaper ACH at scale, Adyen for high card volume, Confido/Gravity Legal as trust-compliance fallback.
  status: not-started
  adrs: ADR-0032
  evidence: Named as swap options in the decision; no code.
