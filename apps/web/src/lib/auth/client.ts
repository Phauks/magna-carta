/*
 * The Better Auth browser client — the ONE home for every call the SPA makes into the auth surface.
 *
 * The Worker mounts Better Auth at its default base path (`/api/auth`, see apps/worker/src/auth.ts)
 * and serves this SPA from the same origin, so the client's defaults already point at it: no
 * baseURL, no basePath, and the session cookie rides along as a same-origin credential. That is
 * also why the auth surface is NOT reached through @magna-carta/api-client — the Better Auth routes
 * are not part of the OpenAPI contract that client is generated from.
 *
 * The twoFactor plugin is wired because the server enables it: with it, a sign-in whose account has
 * two-factor enabled resolves to `{ twoFactorRedirect: true }` instead of a session, and the client
 * gains the `twoFactor.verifyTotp` call that completes the challenge. It is deliberately configured
 * with NEITHER `twoFactorPage` nor `onTwoFactorRedirect`: both of those navigate away, and the
 * sign-in surface must stay on one URL — a second URL would tell an observer (or a shoulder) which
 * factor the visitor is being asked for, and which one failed.
 */
import { createAuthClient } from "better-auth/svelte";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
