---
number: 32
slug: payments-payments-lowest-fee-build-on-raw
status: Accepted
date:
area: Payments
---

**Payments — lowest-fee, build on a raw processor:** payments as a port; **ACH / "direct deposit" is the default rail** (no interchange — the real cost lever), **card a convenience fallback**. **Interchange is the network floor** no processor beats; minimize fees by steering off cards + interchange-plus pricing + **surcharge on operating-only where jurisdiction-legal** (never trust, never debit). **Fees never touch trust** — trust deposits land gross, fees debited from operating, enforced by separate deposit routing. **Launch adapter: Helcim** (interchange-plus, no monthly/PCI fees, ACH 0.5%+25¢ capped $6); swappable to Stripe/Dwolla (cheaper ACH), Adyen (card volume), or Confido/Gravity Legal (trust-compliance fallback). PCI minimized via hosted-fields tokenization (SAQ A). **LawPay-style turnkey processors rejected** as the primary (markup), kept only as fallback.
