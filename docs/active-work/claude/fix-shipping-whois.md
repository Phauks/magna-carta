---
branch: claude/fix-shipping-whois
worktree: .claude/worktrees/agent-ac1c42499ef351c2c
area: Shipping purchase safety (double-buy claim, insurance, connect/disconnect) + whois RDAP CIDR matching
status: review
touches: apps/worker/src/routes/shipping.ts, apps/worker/src/per-firm-migrations.ts, apps/worker/test (shipping-e2e, conformance, firms), apps/worker/openapi, packages/api-client (generated), packages/shipping, packages/whois, packages/data-access (shipment + integration-connection statements), packages/database (per-firm schema + one additive migration), changelog.d
---

Closes four defects in the shipping integration and the whois tool.

The label purchase no longer trusts a carrier `Idempotency-Key` header — EasyPost has no idempotency
facility, so the header was ignored and every retry bought a second label. A per-shipment purchase
claim (guarded status transition, committed before the buy) is now the double-buy guard; the claim is
released only when the carrier definitively refused. Requested insurance is sent to the carrier at
buy time instead of being silently dropped. Rate shopping records the carrier-side shipment id so a
purchase can be reconciled against the draft, and a failed label download is no longer stored as the
label. Connect became an upsert and a `DELETE` disconnect route was added, so credential rotation and
reconnection work. In whois, RDAP bootstrap IP matching is now real masked-integer CIDR containment
(longest prefix, v4 + v6) instead of a text `startsWith`.

Schema: one additive per-firm migration (`shipment.purchase_claim_key`) plus a new `purchasing`
status value — no table rebuild. Contract: adds `shipping.disconnectCarrier`, so the OpenAPI snapshot
and the generated API client are regenerated in the same commit. A concurrent stream touching the
shipping routes, the per-firm migration journal, or the OpenAPI snapshot should coordinate.
