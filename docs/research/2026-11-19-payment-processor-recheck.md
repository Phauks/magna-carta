# Payment processor recheck: is Helcim still the right launch adapter? (2026-11-19)

The payments decision (ADR-0032) named Helcim as the launch adapter behind a swappable port, and
ADR-0181 fixed card capture on Helcim's hosted payment modal. Nothing is built yet (see
[`roadmap.d/payments.md`](../../roadmap.d/payments.md)), so switching costs nothing in code. This
note rechecks the choice against what each vendor publishes today, for a US law firm with trust
(IOLTA) money. Every figure is cited; where a figure comes from a review site rather than the vendor,
it says so.

## Verdict

**Keep Helcim as the launch adapter for the operating rail. Do not send trust money through it until
Helcim confirms in writing that the trust account is outside its debit rights, reserve and security
interest.** If Helcim will not, the trust rail is the place the named fallback (Confido Legal) earns
its keep, not a reason to move the operating rail.

Basis: Helcim is the cheapest published option on both rails, it already offers a lawyer feature that
deposits gross into trust and draws fees from operating, its hosted modal takes card and bank payment
in one iframe (holding SAQ A), and its API needs only `fetch` and Web Crypto, so it runs in a Worker.
The one new risk is contractual, and it lands exactly where the payments design already gated the
trust rail (design flags K2 and K3).

## Price, as published

| | Helcim | LawPay | Stripe (standard) | Confido Legal |
| --- | --- | --- | --- | --- |
| Monthly fee | $0 [H1] | $19 + $7.99 card-brand allocation [R1] | $0 [S1] | $0; $500 onboarding if not through a partner [C1] |
| Card, online | interchange + 0.50% + 25c at under $50K/month, falling to + 0.15% + 15c [H1] | 2.99% + 30c; Amex 3.90% + 30c [R1] | 2.9% + 30c [S1] | 2.95% [C1] |
| Bank payment (ACH) | 0.5% + 25c, capped at $6 under $25,000; 0.05% above [H1] | 1%; reviewers disagree on a $10 cap [R1][R2] | 0.8%, capped at $5 [S2] | 1%, capped at $30 [C1] |
| Recurring | + 0.4% [H1] | not found | not found | not found |
| Chargeback | $15, refunded if won [H1] | not found | $15 [S1] | $25 [C1] |
| Bank payment returned | $5 [H1] | not found | $4 failed, $15 disputed [S2] | $25 [C1] |

Helcim states that most merchants' total online effective rate is "below 2.5%" [H2]; that is
Helcim's own claim, not a guarantee. On a $3,000 bank payment the cap makes Helcim $6, Stripe $5,
LawPay $30 (or $10 if the reported cap holds) and Confido $30 (arithmetic on the rates above).

## Trust handling

- **Helcim** offers split deposits for lawyers at no extra fee: "payments will be deposited for the
  full amount while all fees are withdrawn from your designated operating account" [H3]. That is the
  ADR-0032 rule, offered by the vendor.
- **But Helcim's merchant terms define one "Bank Account"** that Helcim may debit "at any time without
  notice" for fees, chargebacks and reserves, and on which the merchant grants "a security interest
  and lien" [H4, sections 10(g)-(j), 11(a)-(e), 12(i)]. The terms do not mention trust or operating
  accounts. North Carolina's 97 Formal Ethics Opinion 9, as reported, bars a lawyer from a merchant
  agreement granting a security interest in trust [R2]. So whether the trust account counts as "the
  Bank Account" is the open question, and it needs Helcim's written answer (an addendum), not a
  reading of marketing pages. This is the "merchant configuration confirmed with the processor" the
  payments design already requires before the trust rail ships.
- **LawPay** states it "does not allow debits from the trust account at any time for any reason,
  including client disputes and chargebacks" [R1]. That is the guarantee Helcim's terms lack, bought
  at roughly four times the bank-payment price and a monthly fee.
- **Stripe** deducts fees from each payout, which leaves a trust deposit short; legal-payment reviews
  list it as not trust-capable [R2]. Its interchange-plus pricing is sales-only [S1]. Not a fit
  without building a fee-sweep around it.
- **Confido Legal** advertises "Split trust and operating payments" and "Fees routed to comply with
  the rules of professional conduct" [C1], and sells a single GraphQL API for legal software to embed
  payments and trust handling [C2]. It is the natural trust-rail fallback already named in ADR-0032.

## Fit with the platform

- **Hosted modal covers both rails.** HelcimPay.js takes `paymentMethod` of `cc`, `ach` or `cc-ach`
  (the client chooses) [H5], so one script-clean page serves the bank-payment default and the card
  fallback.
- **Worker-compatible.** Initialize is a server `POST` with an `api-token` header [H6]; the result is
  checked with SHA-256 of the response data plus the secret token [H7]; webhooks are HMAC-SHA256 over
  `id.timestamp.body` [H8]. All of it is `fetch` and Web Crypto. Helcim's samples use Node `crypto`
  and `Buffer`, so the adapter ports them.
- **Gap: webhooks cover card transactions only.** The documented events are `cardTransaction` and
  `terminalCancel` [H8]. A bank-payment settlement or return raises no webhook, so the adapter must
  poll for bank-payment status. Bank payments take 3 to 4 business days to deposit [H3], and returns
  arrive later still, so a daily scheduled poll fits.
- **Idempotency** keys are supported on the Payment API (25 to 36 characters, 5-minute life) [H9].
- **A narrow API token** is possible: "Positive Transaction" processing with no settings or general
  access is Helcim's recommendation for the modal [H6]; refunds need the separate "Admin" level.

## What would change the verdict

- Helcim refuses a trust-account carve-out in writing: keep Helcim for operating, take the trust rail
  to Confido through the port.
- Volume grows past roughly $1M/month in cards: Helcim's top tier is published to $5M before custom
  pricing [H1]; revisit Adyen then, as ADR-0032 already says.

## Sources

Vendor pages:

- [H1] Helcim fee disclosures (last updated 2026-02-02, effective 2026-04-01): https://legal.helcim.com/us/fee-disclosures/ ; pricing: https://www.helcim.com/pricing/
- [H2] Helcim pricing page FAQ: https://www.helcim.com/pricing/
- [H3] Helcim, payment deposits for lawyers: https://www.helcim.com/announcements/payment-deposits-for-lawyers/ ; ACH page: https://www.helcim.com/ach-payment-processing/
- [H4] Helcim US merchant terms of service (effective 2025-07-31): https://legal.helcim.com/us/terms-of-service/
- [H5] HelcimPay.js payment types: https://devdocs.helcim.com/docs/available-payment-types-and-methods-through-helcimpayjs
- [H6] Initialize and authentication: https://devdocs.helcim.com/docs/initialize-helcimpayjs , https://devdocs.helcim.com/docs/authentication-with-the-helcim-api-and-helcimpayjs
- [H7] Validate: https://devdocs.helcim.com/docs/validate-helcimpayjs
- [H8] Webhooks: https://devdocs.helcim.com/docs/webhooks
- [H9] Idempotency: https://devdocs.helcim.com/docs/idempotency
- [S1] Stripe pricing: https://stripe.com/pricing
- [S2] Stripe local payment methods: https://stripe.com/pricing/local-payment-methods ; https://docs.stripe.com/payments/ach-direct-debit
- [C1] Confido Legal pricing: https://confidolegal.com/pricing
- [C2] LawNext, 2026-02-26: https://www.lawnext.com/2026/02/exclusive-confido-legal-raises-9-million-to-expand-embedded-payments-and-disbursements-for-law-firms.html

Review sites (affiliate-supported; used for LawPay figures and trust-rule summaries, verify before relying):

- [R1] PaymentReview, LawPay review (fact-checked 2026-09-12): https://paymentreview.com/reviews/lawpay/
- [R2] Uptime Legal, law-firm payment processing compared (updated 2026-11-15): https://www.uptimelegal.com/best-law-firm-payment-processing-solutions/ ; Finix, law-firm payment processing: https://finix.com/resources/blogs/law-firm-payment-processing
