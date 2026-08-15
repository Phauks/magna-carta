---
category: Added
audience: internal
---

Human verification on the anonymous endpoints — a real server-side control where there had only been
an unticked box. Cloudflare Turnstile had been treated as adopted since the owner approved it, and
four merged designs name it as the write gate on registration, intake, community posting and the
credential endpoints. Nothing verified anything: the only Turnstile in the tree was a line in the
operations runbook, a static placeholder in the sign-in mock-up, and an entry in the sign-in
surface's own register of unbuilt capabilities. The platform's one self-serve write from the open
internet — founding a firm, which sends mail — had an IP-keyed rate limit and nothing else.

**What now exists.** A `HumanVerificationPort` with a three-valued outcome, a Turnstile siteverify
adapter behind it, and a gate the two anonymous writes call before they do anything: `POST
/api/v1/registrations` and `POST /api/v1/invitations/redemptions`. A client presents its challenge
solution in the `X-Human-Verification-Token` header — a header rather than a body field, so the
published request bodies and every client already building them are unchanged.

**Three decisions, not two, and only the first two are about the caller.** `verified` and `refused`
are verdicts on the request. `unavailable` is a fact about this deployment: nothing was asked, so
nothing was learned. Collapsing it into a refusal would turn our own outage into an accusation
against a visitor trying to sign up; collapsing it into a pass would mean an operator who can break
one outbound call has switched the gate off. A refusal is `403`. A live verifier that will not
answer, or that rejects our own secret, is a retryable `503` carrying a retry window — never a `500`
with an Error ID for a fault the caller cannot act on.

**It ships dormant, and dormant is loud.** No Turnstile widget exists, so no secret is provisioned,
so every environment resolves the not-configured verifier and the protected endpoints behave exactly
as they did before. The absence is not silent: every decision — including every unprotected pass —
records one `human_verification.decided` point carrying the route, the outcome and a closed-set
reason. An unprotected anonymous endpoint that says nothing is how this became a runbook checkbox in
the first place, so the dormant state is the one that is counted hardest. The missing credential is
reported, never thrown: a throw at composition-root construction is what makes a not-configured path
unreachable, which is the bug the credential-store seam was reworked to avoid.

**The posture when no verifier is provisioned is fail-open, and it is one deployment variable away
from fail-closed.** These endpoints include the platform's only self-serve way in; defaulting to
refusal would have made the act of adding abuse protection its own outage. Both branches are tested.
Recorded for ratification as a pending decision.

The challenge solution is a bearer credential and reaches no log, no counter dimension, no error
message and no URL — structurally, since the telemetry catalogs have no field it could occupy.
Activation is queued for the owner in `docs/deploy-queue.md`; the runbook no longer claims this is a
manual checkbox.
