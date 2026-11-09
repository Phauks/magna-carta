---
category: Security
audience: internal
---

**Only an administrator can connect, replace or disconnect the firm's postage account, and the
platform's fee on a label is the server's number, not the caller's.** Two findings from a security
review of shipping, both closed before any firm could reach them.

**The account.** The connect and disconnect routes were gated on `shipping:manage` — the same
permission as drafting a shipment — and the credential store does no check of its own on a write, by
design, because it defers to the route. So any member who could draft a shipment could replace the
firm's EasyPost key with one on an account they control, and every shipment an administrator bought
afterwards, with its clients' names and addresses, would go to that account; or disconnect the firm's
postage outright. Both routes now require `firm:manageSecrets`, the right the Settings navigation
already tagged the page "View" without — but whose controls the page itself never checked, so it also
now shows that member the account's health and a sentence saying only an administrator can change it,
instead of a key field the server would refuse. Reading whether an account is connected stays on
`shipping:manage`, since the register uses it to tell exactly that member when no account is
connected. Not reachable under the
default roles, where only Owner/Admin holds `shipping:manage`.

**The fee.** `POST /api/v1/shipments/{id}/purchase` took `serviceFeeMinor` from the request, with no
upper bound, and a positive fee becomes a billable charge on the shipment's matter when the firm
recovers the shipping service fee. A member who could buy a label could put any amount on a client's
bill without `costs:track`. The field is gone from the request, and the fee is set on the server:
zero, since the platform charges nothing per label today. A client that still sends it has it
ignored rather than refused, so a browser tab left open on the old page can still buy its label.

Both are pinned by tests that fail when the hole is put back.
