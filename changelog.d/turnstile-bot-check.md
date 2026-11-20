---
category: Security
audience: public
---

**A bot check on sign-in and the signed-out forms, ready to switch on.** The Cloudflare Turnstile widget (`apps/web/src/lib/auth/human-check.svelte`) now sits above the main button on Sign In, Forgot Password, Register, the founding door and Redeem Invitation, and sends its solution with the submit. The server already checked registration and invitation redemption; `apps/api-worker/src/http/human-verification/sign-in-verification.ts` adds Better Auth's sign-in and reset-request endpoints. `GET /api/v1/human-verification` hands the screens the public site key. The check turns on only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set (`resolveTurnstileKeys`), so a secret without its site key can never lock the door, and both are read from the Secrets Store with the Worker secret as the fallback. System Status lists the feature as Bot check. `apps/api-worker/test/human-verification-sign-in.test.ts` covers the both-keys rule, the site-key read and the sign-in gate.

## Public

Signing in, resetting a password, registering and redeeming an invitation can now be protected by a Cloudflare security check. For most people it runs out of sight; now and then it asks you to tick a box.
