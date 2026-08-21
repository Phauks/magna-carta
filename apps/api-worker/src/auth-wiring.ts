import type { Bindings } from "./app.ts";
import { createAuth } from "./auth.ts";
import { createCloudflareEmailAdapter } from "./email-cloudflare.ts";
import { createLoggingEmailAdapter, type SendEmail } from "./email-port.ts";
import { defaultLoggerForEnv } from "./logger-wiring.ts";

// The outbound-email adapter for an env: the real Cloudflare Email Service when its binding AND
// EMAIL_FROM are both present (production), otherwise the dev logging adapter. EMAIL_FROM is the
// selection key — unset in dev/test (.dev.vars omits it), so tests never touch the real binding and
// no domain onboarding is required to run locally. The Cloudflare adapter logs through the per-env
// Workers logger (email.sent — class + outcome, never body).
export function emailAdapterForEnv(env: Bindings): SendEmail {
  if (env.SEND_EMAIL !== undefined && env.EMAIL_FROM !== undefined && env.EMAIL_FROM !== "") {
    return createCloudflareEmailAdapter(env.SEND_EMAIL, env.EMAIL_FROM, defaultLoggerForEnv(env));
  }
  return createLoggingEmailAdapter();
}

// One Better Auth instance per worker env: the env object is stable across requests within an
// isolate, so a WeakMap-keyed cache builds the auth context once instead of on every request.
//
// THIS FILE EXISTS TO KEEP THE BACKGROUND HALF OF THE WORKER OUT OF THE ROUTE TREE. Both the request
// path and the firm-provisioning queue consumer need an auth instance. While this factory lived in
// app.ts it was the ONE runtime import that made the consumer — and through it every Cron sweep —
// depend on the whole Hono application: 162 of the 165 imports of app.ts are `import type
// { Bindings }` and vanish at build, so this single value import was what dragged the routes into
// the background bundle. Keep it here, and keep app.ts free of factories the background half needs.
// The rule is enforced by test/background-import-boundary.test.ts.
const authInstanceByEnv = new WeakMap<Bindings, ReturnType<typeof createAuth>>();

export function authForEnv(env: Bindings): ReturnType<typeof createAuth> {
  let auth = authInstanceByEnv.get(env);
  if (auth === undefined) {
    auth = createAuth(env, emailAdapterForEnv(env));
    authInstanceByEnv.set(env, auth);
  }
  return auth;
}
