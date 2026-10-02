---
number: 361
slug: an-unprovisioned-human-check-fails-open-and-counts-itself
status: Proposed
date: 2026-08-15
area: Authentication
summary: "Human verification on the platform's anonymous writes is a port with a three-valued outcome — verified, refused, unavailable — resolved by the presence of a Turnstile secret and never by a construction-time throw, so the not-configured path is the default in every environment and is reachable and tested rather than theoretical. When no verifier is provisioned the protected endpoints FAIL OPEN: they serve exactly as they did before the gate existed, and every unprotected pass records a `human_verification.decided` point with outcome `unenforced`. The rejected alternative, fail-closed, is one deployment variable (`HUMAN_VERIFICATION_POSTURE`) away and is covered by its own test, because the choice is a security posture with a product consequence rather than an implementation detail. The reasoning is that these endpoints include the platform's ONLY self-serve way in, so a fail-closed default would make the act of adding abuse protection its own outage — before the owner has touched the Cloudflare dashboard — while fail-open leaves the endpoint exactly as protected as it is today and converts the gap from an unticked runbook box into a number somebody can alert on. A verifier that is live but does not answer, or that rejects our own secret, is NOT covered by this posture: it is a retryable 503, because reading an outbound failure as a pass would mean anyone who can break one call has turned the gate off, and reading it as a refusal would blame a visitor for our fault. Owner ratification is requested on the fail-open default specifically."
---

**An abuse control that is not provisioned should leave the door exactly as it was and say so loudly
— not close the door, and not pretend to be guarding it.**

**Context:** Cloudflare Turnstile has been treated as adopted since it was approved, and four merged
designs — self-serve firm provisioning, unified identity, client intake, community surfaces — name
it as the write gate their threat model rests on. It existed as an unticked box in the operations
runbook, a static placeholder row in the sign-in mock-up, and an entry in the sign-in surface's
register of unbuilt capabilities. Nothing issued a token and nothing validated one. The platform's
only anonymous write that costs money to serve — founding a firm, which writes a control-plane row
and sends mail — was defended by an IP-keyed rate limit alone.

Building the verification is not the decision. The decision is what a protected endpoint does on the
day the code lands, when no widget exists and therefore no secret can.

**Decision:** A `HumanVerificationPort` whose outcome is three-valued. `verified` and `refused` are
verdicts about the caller. `unavailable` is a fact about the deployment, and keeping it a separate
value is the load-bearing part: it is what makes the following two rules expressible at all.

**When no verifier is provisioned, the endpoint FAILS OPEN and the pass is counted.** The endpoint
behaves precisely as it did before the gate was written. Every request through it records one
`human_verification.decided` point with outcome `unenforced`, so "these endpoints are unprotected" is
a number on a dashboard rather than a sentence in a document.

**When a verifier IS provisioned and does not answer, the endpoint FAILS CLOSED with a retryable
503.** The two are not the same question and must not share an answer. An owner who provisions a
secret has deliberately switched protection on; passing traffic whenever the outbound call fails
would mean an attacker who can induce one failure has switched it back off. A 503 with a retry window
is honest and actionable, and is specifically not a 500 — the caller did nothing wrong and there is
nothing for them to report.

**The posture is a deployment variable, not a constant.** `HUMAN_VERIFICATION_POSTURE=fail-closed`
flips the first rule, no code change, no deploy. Both branches carry a test, so the road not taken
stays exercised rather than rotting into an untested claim.

**Why fail-open is the default.** The endpoints this gate protects include the platform's only
self-serve way in. Under a fail-closed default, merging the abuse protection would refuse every
visitor trying to found a firm from that moment until the owner created a widget and set a secret —
the act of adding protection would be the incident. Fail-open changes nothing about how exposed the
endpoint is: it is exactly as exposed as it is today, with the same rate limit and the same
deliberately small blast radius (an unconfirmed registration buys one control-plane row and one
email, no bucket, no key, no Durable Object). What changes is that the exposure is now measured. The
platform already takes this trade at its closest analogue: an unreachable malware-scan engine yields
an honest `unscanned`/`no-engine` verdict rather than refusing the member's upload or fabricating a
`clean`.

**Considered and rejected:** **Fail-closed by default** — defensible, and the right answer for an
endpoint that is not the front door; here it trades a hypothetical abuse run for a certain outage,
and it hides the gap rather than exposing it, because a refusing endpoint gets switched off or
worked around rather than fixed. **Throwing when the secret is absent** — the shape this codebase has
already been burned by: a throw in the composition root makes the not-configured path unreachable and
therefore untestable, which is exactly the defect the per-firm credential store was reworked to
remove. **Treating an unreachable verifier as a pass** — turns any outbound fault into a bypass.
**Treating an unreachable verifier as a caller refusal** — blames a visitor for our outage and gives
them an instruction ("try the check again") that cannot help. **Requiring the token as a body field
on the protected routes** — the request bodies are published contract with clients already built
against them; a header rides alongside and is simply absent until a client mints one. **Mounting
Better Auth's captcha plugin over the credential endpoints instead** — it wants its secret at
construction time, which reintroduces the throw; it would also gate sign-in, whose shipped screen
mints no token, breaking a working surface. That mounting remains the right move once the widget
exists and is left to the identity slice that owns those endpoints.

**Consequences.** The gate is live on `POST /api/v1/registrations` and `POST
/api/v1/invitations/redemptions` and dormant everywhere, including production. Activation has a
prerequisite the server cannot satisfy on its own: the client must render a widget and mint a token,
which is UI work reserved to the owner. Setting the secret before that exists would turn every
tokenless request into a `403` — so the activation order (widget first, secret second) is recorded in
the deploy queue rather than left to be discovered. The registration and redemption operations gain a
`403` and a `503` response and an optional request header, which is a contract change: the OpenAPI
snapshot and the generated client are re-emitted with it.
