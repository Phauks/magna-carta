---
category: Fixed
---

- **A retried or duplicated label purchase can no longer buy a second label.** Double-buy protection
  rested on an `Idempotency-Key` header sent to EasyPost — an API with no idempotency facility of any
  kind, so the header was simply ignored and every retry was a fresh, separately billed purchase. The
  guard now lives on our side: a shipment takes an exclusive purchase claim (a guarded status
  transition committed before any money moves), so exactly one request out of any number of concurrent
  or retried attempts reaches the carrier, and a shipment whose label is already bought answers `409`
  instead of buying again. A buy the carrier definitively refused hands the claim back so the firm can
  correct and retry; an indeterminate failure — a provider `5xx`, a dropped connection, or a failure
  after the buy returned — keeps the claim, because the label may exist and be billed.

- **Requested parcel insurance is actually purchased.** `insuranceAmountMinor` was accepted by the API,
  stored on the draft, and shown back to the firm, but was never sent to the carrier — so a parcel of
  original documents recorded as insured was in fact uninsured. The declared value now rides the label
  purchase as the carrier's own insurance parameter (a decimal-dollar string), taken from the draft
  rather than from the purchase request, so what the firm was told it insured is what is bought.

- **The purchase is checked against the draft before any money is spent.** The route bought from the
  carrier before confirming the shipment existed and never reconciled the supplied carrier-shipment id
  with the draft, so postage could be bought against a nonexistent row or attached to another draft's
  addresses. Rate shopping now records the carrier-side shipment it quoted against, and a purchase
  naming a different one is refused with `422`. A label download that fails is no longer stored and
  served forever as the label — the transfer must succeed before the bytes are kept.

- **A firm can disconnect and reconnect its postage account.** Connecting always inserted a new
  connection row against a unique `(category, principal)` index, so every connect after the first
  failed with a `500` and there was no way to remove a connection at all — a firm rotating a
  compromised API key was dead-ended with the revoked one. Connect is now an upsert that rotates the
  credential in place and re-arms a connection the health model had parked, and a new
  `DELETE /api/v1/integrations/shipping/connection` removes it. The credential is addressed by firm
  rather than by a freshly minted connection id, so a rotation replaces the old key instead of
  orphaning it.

- **The whois IP path resolves the right RDAP server.** Bootstrap matching compared CIDR blocks as text
  prefixes, which is wrong for any delegation that does not land on an octet boundary: members of a
  block were missed, and unrelated addresses that merely shared leading characters were claimed.
  Matching is now real numeric containment over masked integers, longest prefix first, for both IPv4
  and IPv6 — and a hex-bearing IPv6 literal is no longer mis-routed to the domain bootstrap.
