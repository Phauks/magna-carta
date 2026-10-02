---
number: 353
slug: an-unbuilt-credential-read-is-a-dispatch-outcome-not-a-throw
status: Proposed
date: 2026-08-15
area: Integrations
summary: "The integration framework gains a fourth `Dispatch` failure reason, `credential-store-not-implemented`, for a deployment that has no per-firm credential read at all — distinct from `not-connected`, which is about a firm that has not connected an account. The per-firm secret-store seam stops throwing: `SecretStoreForFirm` returns `SecretStore | null`, the worker hands the registry the framework's `unbuiltCredentialStore` value when it is null, and every credentialed resolution answers the new reason instead of the registry construction blowing up on whichever request first needed a credential. Shipping maps it to `501 not-implemented` on connect, rate, purchase, track and refund; drafting a shipment deliberately still succeeds, because a draft is the firm's own addresses and parcel and needs no carrier. The seam itself stays unbuilt — this makes its absence legible rather than fatal."
---

**A seam nobody has built is a fact about the platform. Stating it is cheap; throwing at it converts
every downstream request into an unexplained 500 and moves the refusal to after the work.**

**Context.** The per-firm `firm_secret` credential read is a named, deliberate seam — the marketplace
slice wires it, because it needs a firm-key-bearing read context that does not exist yet. Until then
`firmSecretStoreNotYetAvailable` threw, and `buildIntegrationRegistry` called it eagerly while
assembling the registry. The consequences ran in the wrong order:

- `POST /api/v1/shipments` created a draft and returned `201`. It never touches the registry.
- `POST /api/v1/shipments/{id}/rates` returned `500` with an Error ID, because the registry could not
  be constructed. Purchase, tracking and refund were the same.
- `POST /api/v1/integrations/shipping/connection` — the act that would supposedly fix it — also
  returned `500`, for the same reason, before storing anything.

So a member committed to a shipment where the platform was silent and discovered the problem where it
was loud, and the remedy the loud message pointed at was itself unreachable. A real EasyPost key and
every worker deployed would have changed none of it: the code that reads a stored key does not exist.

**Decision.** Three parts, all narrow.

**The framework names the state.** `DispatchFailureReason` gains
`credential-store-not-implemented`. It is deliberately not folded into `not-connected`: the two are
fixed by different people. A firm clears `not-connected` by connecting an account; only a build
clears this one, and a surface that said "connect your account" would send a member at a door that
cannot open. This is the same first-class deferred-seam state the conversion and search ports already
carry as `engine-not-implemented` — reaching that idiom rather than minting a second one is the point.

**The seam reports rather than throws.** `SecretStoreForFirm` returns `SecretStore | null`.
`unbuiltCredentialStore` is a value the registry can be handed in the credential-store slot,
structurally distinct from a `CredentialStore` (it has no `get`/`put`), and resolution checks it
**before** the connection lookup — with no credential read there is no connection that could ever
resolve, so "not connected" would be a true-sounding sentence pointing at the wrong remedy. A
credential-less adapter is unaffected and still resolves.

**The refusal lands where the commitment is, not where the work is.** Shipping maps the outcome to
`501 not-implemented`, an existing registered problem type meaning "known, not built" — not `503
service-unavailable`, whose contract promises the condition clears at deploy time, which is false
here. Connect refuses before it writes anything, so no connection row is recorded over a key that was
never stored. Rate, purchase, track and refund refuse through the same mapping.

**A draft without a carrier still succeeds, and that is deliberate.** A draft is the firm's own
addresses, parcel and options in its own database; preparing one before a carrier exists is a
legitimate thing to want, and refusing it would forbid it permanently to buy a marginal improvement
in one deployment's messaging. Refusing the draft would also not have fixed the ordering — it would
have relocated a 500 while the actually-blocking act, connecting an account, still failed the same
way. The honest ordering is: connecting refuses first and by name, and every carrier call refuses in
a shape a surface can render.

**Consequences.** Callers that branch on `Dispatch` see a fourth reason; the union is exhaustive, so
a caller that must handle it fails to typecheck rather than silently defaulting. The shipping routes
declare `501` in their contract (snapshot and generated client regenerated). Nothing about the
credential store is built here — the seam is unchanged in scope, only in how it answers.

**Alternatives rejected.** Reusing `not-connected` needs no framework change and tells a firm to do
again the thing it already did. A bare `if (noCredentials) throw` at the top of the draft route fixes
the symptom and leaves the platform with two vocabularies for the same absence. Mapping to `503`
promises a deploy will fix it, and no deploy will.
