# Payments

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: payments
  name: Payments
  scope: Payment acceptance as a swappable-adapter port, ACH-default with card fallback, structured so processor fees never touch trust.
  status: not-started
  adrs: ADR-0032
  evidence: No payments package, adapter, or rail code; billing-core (invoicing substrate) is on main but processes no money.

- id: payments.port
  name: Payments port
  scope: Vendor-swappable payments adapter behind the plugin/port system.
  status: not-started
  slices: integration-port-system
  adrs: ADR-0091
  evidence: The integration port system it will sit behind is shipped; no payments port defined.

- id: payments.ach
  name: ACH rail (default)
  scope: Bank-transfer rail presented as the default, prominent option with small flat/capped fees.
  status: not-started
  adrs: ADR-0032
  evidence: Decision recorded; no code.

- id: payments.card
  name: Card rail (fallback)
  scope: Card acceptance as the convenience fallback.
  status: not-started
  adrs: ADR-0032
  evidence: Decision recorded; no code.

- id: payments.trust-separation
  name: Fees never touch trust
  scope: Trust/IOLTA deposits land gross; card fees debit operating only, enforced by separate deposit destinations per rail.
  status: not-started
  adrs: ADR-0032
  evidence: Recorded as a hard invariant in docs/conventions/invariants.md; no payment code exists to enforce it yet.

- id: payments.surcharge
  name: Operating-only surcharge
  scope: Optional card surcharge/convenience fee on operating (never trust) payments, gated by jurisdiction config; debit never surcharged.
  status: not-started
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: No surcharge logic; the trust-engine jurisdiction machinery it gates on is in design (status.d/3-2 research/spec in progress).

- id: payments.helcim
  name: Helcim launch adapter
  scope: Launch adapter covering both rails — interchange-plus cards and capped-fee ACH.
  status: not-started
  adrs: ADR-0032
  evidence: Vendor decided; no adapter code.

- id: payments.pci-scope
  name: PCI scope minimization
  scope: Card capture exclusively via the processor's hosted payment modal returning a cardToken; store token plus last-four/brand only; script-clean payment page; SAQ A.
  status: designed
  adrs: ADR-0032
  evidence: Accepted decision fragment docs/decisions/pending/pci-saq-a-hosted-payment-modal.md (2026-07-02) refining ADR-0032, including planned fitness functions; no code.

- id: payments.alternate-adapters
  name: Alternate adapter seams
  scope: Stripe/Dwolla for cheaper ACH at scale, Adyen for high card volume, Confido/Gravity Legal as trust-compliance fallback.
  status: not-started
  adrs: ADR-0032
  evidence: Named as swap options in the decision; no code.
