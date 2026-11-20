# api-worker routes/session — CLAUDE.md

**Purpose.** The joining and identity surface — the member's own bootstrap and name, the member list and its administration, the anonymous registration pair, invitations and the signed-in half of joining. One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and the rules below are this surface's own. The Worker-wide rules (the chokepoint, the seam, the fitness tests) are in [`../../../CLAUDE.md`](../../../../CLAUDE.md); the design is [`docs/specs/2026-09-18-api-worker-domain-modules-design.md`](../../../../../../docs/specs/2026-09-18-api-worker-domain-modules-design.md).

## Human verification — built, wired, and off until both Turnstile keys exist

`src/http/human-verification/` gates the two anonymous WRITES — `POST /api/v1/registrations` and `POST
/api/v1/invitations/redemptions` — on a Cloudflare Turnstile solution presented in the
`X-Human-Verification-Token` header, and the same gate rides Better Auth's `POST /api/auth/sign-in/email`
and `POST /api/auth/request-password-reset` as middleware (`sign-in-verification.ts`, mounted in
`src/http/app.ts` behind the attempt budget). `resolveHumanVerificationPort(env)` turns the check on only
when `resolveTurnstileKeys(env)` finds BOTH `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`; otherwise it
returns `verifierNotConfigured` and every gated endpoint serves exactly as before. `GET
/api/v1/human-verification` (`human-verification-settings.ts`) hands the screens the site key under the
same rule, so a screen draws the widget exactly when the server will ask for its solution. Activation
steps live in [`docs/deploy-queue.md`](../../../../../../docs/deploy-queue.md).

Local rules for this surface:

- **Three outcomes, and only two of them are about the caller.** `verified`/`refused` are verdicts;
  `unavailable` is a fact about this deployment. Never collapse the third into either — as a pass it
  makes any outbound failure a bypass, as a refusal it blames a visitor for our outage.
- **The gate is called from the HANDLER, not mounted as route middleware.** Route-specific middleware
  runs ahead of the chokepoint, so a gate there would make an outbound call before the IP-keyed rate
  limit had a say. Adding it to a third `/api/v1` route means one call at the top of that handler.
  Better Auth's routes are the exception because they have no handler of ours; their middleware sits
  behind the attempt budget for the same reason.
- **Never a 500.** A refusal is `403`; a live verifier that will not answer, or that rejects our
  secret, is a retryable `503`. An Error ID for a fault the caller cannot act on is the failure mode
  this replaced. This is why Better Auth's own captcha plugin is not used: it answers its faults with a 500.
- **Both keys or neither.** Never switch the check on from the secret alone: a server that asks for a
  solution no screen can mint refuses every sign-in.
- **A dormant gate is counted, not silent.** Every decision — the unprotected passes most of all —
  records one `human_verification.decided` point. Adding a path that returns without recording is the
  one change that would put this back where it started.
- **The token never reaches a log, a counter dimension, an error message, or a URL.** It is a bearer
  credential; the telemetry catalogs give it no field, and nothing should add one.
