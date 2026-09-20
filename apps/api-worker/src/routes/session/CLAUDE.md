# api-worker routes/session — CLAUDE.md

**Purpose.** The joining and identity surface — the member's own bootstrap and name, the member list and its administration, the anonymous registration pair, invitations and the signed-in half of joining. One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and the rules below are this surface's own. The Worker-wide rules (the chokepoint, the seam, the fitness tests) are in [`../../../CLAUDE.md`](../../../CLAUDE.md); the design is [`docs/specs/2026-09-18-api-worker-domain-modules-design.md`](../../../../../docs/specs/2026-09-18-api-worker-domain-modules-design.md).

## Human verification — built, wired, and dormant until a secret exists

`src/human-verification/` gates the two anonymous WRITES — `POST /api/v1/registrations` and `POST
/api/v1/invitations/redemptions` — on a Cloudflare Turnstile solution presented in the
`X-Human-Verification-Token` header. `resolveHumanVerificationPort(env)` selects by the presence of
`TURNSTILE_SECRET_KEY`, on the same terms `resolveScanPort` selects an engine; absent (every
environment today) it returns `verifierNotConfigured` and both endpoints serve exactly as before.
Activation steps and their ordering live in [`docs/deploy-queue.md`](../../../../../docs/deploy-queue.md).

Local rules for this surface:

- **Three outcomes, and only two of them are about the caller.** `verified`/`refused` are verdicts;
  `unavailable` is a fact about this deployment. Never collapse the third into either — as a pass it
  makes any outbound failure a bypass, as a refusal it blames a visitor for our outage.
- **The gate is called from the HANDLER, not mounted as route middleware.** Route-specific middleware
  runs ahead of the chokepoint, so a gate there would make an outbound call before the IP-keyed rate
  limit had a say. Adding it to a third route means one call at the top of that handler.
- **Never a 500.** A refusal is `403`; a live verifier that will not answer, or that rejects our
  secret, is a retryable `503`. An Error ID for a fault the caller cannot act on is the failure mode
  this replaced.
- **A dormant gate is counted, not silent.** Every decision — the unprotected passes most of all —
  records one `human_verification.decided` point. Adding a path that returns without recording is the
  one change that would put this back where it started.
- **The token never reaches a log, a counter dimension, an error message, or a URL.** It is a bearer
  credential; the telemetry catalogs give it no field, and nothing should add one.
- **Better Auth's `/api/auth/*` endpoints are deliberately not gated** — the shipped sign-in screen
  mints no token, so gating them would break a working surface.
