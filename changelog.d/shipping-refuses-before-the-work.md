---
category: Fixed
audience: internal
---

**Shipping told a member their draft was fine and then broke. Connecting a postage account, rate
shopping, buying, tracking and refunding all returned `500` with an Error ID, because the per-firm
credential read is an unbuilt seam that threw when the integration registry was assembled. The
refusal now arrives first, by name, as a `501`.**

**The sequence that shipped.** `POST /api/v1/shipments` returns `201` — it never touches the
registry. `POST /api/v1/shipments/{id}/rates` then returned `500`, and so did purchase, tracking and
refund. So did `POST /api/v1/integrations/shipping/connection`, which is the remedy a member would
reach for: `firmSecretStoreNotYetAvailable` threw before anything was stored. A real EasyPost key
and every worker deployed would have changed nothing, because the code that reads a stored key does
not exist yet. `shipping-e2e.test.ts` injects an in-memory secret store, so it exercised none of
this; the new `shipping-unbuilt-credential-seam.test.ts` builds the app on the production default and
pins the whole sequence.

**The framework already had the shape, and now has the word.** `Dispatch` gains a fourth failure
reason, `credential-store-not-implemented`, beside `not-connected`, `capability-unsupported` and
`adapter-error` — the same first-class deferred-seam state the conversion and search ports carry as
`engine-not-implemented`. `SecretStoreForFirm` returns `SecretStore | null` instead of throwing, and
the worker hands the registry `unbuiltCredentialStore` when it is null. Resolution answers the new
reason **before** the connection lookup: with no credential read there is no connection that could
ever resolve, so "not connected" would be a true sentence pointing at the wrong remedy — that one a
firm fixes by connecting an account, this one only a build fixes. A credential-less adapter still
resolves.

**Why `501` and not `503`.** `service-unavailable` promises the condition clears when a binding is
activated at deploy time, and no deploy clears this. `not-implemented` is the registered type for
"known, and not built", the same correction WHOIS took for its registry-less TLDs.

**Drafting still works, on purpose.** A draft is the firm's own addresses, parcel and options in its
own database and needs no carrier, so refusing it would forbid a legitimate thing permanently. It
would also not have fixed the ordering — it would have relocated a 500 while connecting an account,
the act that actually blocks, still failed the same way.

**Not fixed here:** the credential store itself. This makes its absence legible, not present.
