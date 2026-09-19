import { createAuth } from "./auth.ts";
import type { Bindings } from "./bindings.ts";
import { createCloudflareEmailAdapter } from "./email-cloudflare.ts";
import { deliverEmail } from "./email-delivery.ts";
import { createLoggingEmailAdapter, type SendEmail } from "./email-port.ts";
import { defaultLoggerForEnv } from "./worker-logger.ts";

// The per-env Better Auth instance and the outbound-email port it sends through. Held apart from
// app.ts because the provisioning consumer needs the auth instance without the HTTP app: a consumer
// that imported the composition root to reach it would tie the background side to every route.
// One Better Auth instance per worker env: the env object is stable across requests within an
// isolate, so a WeakMap-keyed cache builds the auth context once instead of on every request.
// The dev logging email adapter is wired here for now; slice 0·6 swaps in real transactional
// email behind the same SendEmail port.
const authInstanceByEnv = new WeakMap<Bindings, ReturnType<typeof createAuth>>();

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

export function authForEnv(env: Bindings): ReturnType<typeof createAuth> {
  let auth = authInstanceByEnv.get(env);
  if (auth === undefined) {
    // THE PORT IS GUARDED BEFORE IT REACHES BETTER AUTH, and it has to be guarded HERE rather than
    // around the calls, because the library will not let a caller see a send fail. Its
    // `runInBackgroundOrAwait` awaits the send and then swallows whatever it throws into its own
    // logger (verified against the installed 1.6.22, context/create-context.mjs), so
    // `api.requestPasswordReset` resolves successfully whether or not a mail went out and a
    // try/catch at the call site is dead code. Wrapping the port is the only place the failure is
    // observable at all — so this is where it becomes a counted, correlated fact instead of a line
    // in a third-party logger that nothing aggregates.
    auth = createAuth(env, countingEmailPort(emailAdapterForEnv(env), env));
    authInstanceByEnv.set(env, auth);
  }
  return auth;
}

/**
 * Wrap a send so a failure is counted and correlated on its way past, then rethrown unchanged. The
 * rethrow matters: Better Auth catches it (see above), while a direct caller that awaits the port
 * still sees the throw and can answer for it.
 */
function countingEmailPort(send: SendEmail, env: Bindings): SendEmail {
  return async (message) => {
    const delivery = await deliverEmail({
      attempt: () => send(message),
      messageClass: message.messageClass ?? "unspecified",
      // Not a route: this guard sits under every Better Auth-originated send, and which endpoint
      // asked is not knowable from here. The message class is what distinguishes them.
      surface: "better-auth",
      logger: defaultLoggerForEnv(env),
    });
    if (!delivery.delivered) {
      throw new Error(`email send failed (${message.messageClass ?? "unspecified"})`);
    }
  };
}
