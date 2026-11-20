// The bot check on the two signed-out Better Auth endpoints a script would hammer: signing in with a
// password, and asking for a password reset email.
//
// Better Auth's own routes are outside the chokepoint, so the check rides as middleware on the auth
// base path instead of being called from a handler. It is registered AFTER the attempt budget
// (app.ts), so a visitor who is already locked out is answered by the lockout and costs no outbound
// call. A refusal here is a failed attempt as far as that budget is concerned, which is right: a
// script that sends no solution should run out of tries as fast as one that guesses passwords.
//
// Better Auth ships a captcha plugin that does the same job. It is not used because it answers its
// own faults with a 500 and has no not-configured state, while this gate already answers a refusal
// with a 403, an outage with a retryable 503, and counts every decision, the unprotected ones
// included (human-verification-gate.ts).

import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "../../bindings.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import {
  enforceHumanVerification,
  type HumanVerificationGateOptions,
} from "./human-verification-gate.ts";

// The path suffixes Better Auth serves the two endpoints at. Everything else under the base path
// (session reads, sign-out, the second-factor code, the reset itself, which arrives with an emailed
// token) is left alone: none of it is reached from a form a script could fill without a credential.
const VERIFIED_AUTH_SUFFIXES: readonly string[] = ["/sign-in/email", "/request-password-reset"];

export function isVerifiedAuthPath(path: string): boolean {
  return VERIFIED_AUTH_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

export function signInVerificationMiddleware(
  options: HumanVerificationGateOptions = {},
): MiddlewareHandler<{ Bindings: Bindings; Variables: AppVariables }> {
  return async (c, next) => {
    if (c.req.method !== "POST" || !isVerifiedAuthPath(c.req.path)) {
      await next();
      return;
    }
    const refusal = await enforceHumanVerification(
      c as Context<{ Bindings: Bindings; Variables: AppVariables }>,
      options,
    );
    if (refusal !== null) {
      c.res = refusal;
      return;
    }
    await next();
  };
}
