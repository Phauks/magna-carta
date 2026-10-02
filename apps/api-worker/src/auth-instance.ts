import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "./app.ts";
import { createAuth } from "./auth.ts";
import { createCloudflareEmailAdapter } from "./email-cloudflare.ts";
import { deliverEmail } from "./email-delivery.ts";
import { createLoggingEmailAdapter, type SendEmail } from "./email-port.ts";

// THE ONE BETTER AUTH INSTANCE PER ENVIRONMENT, and the outbound-email port under it.
//
// It lived in app.ts, which is the composition root — and that is exactly why it could not stay
// there. A route-specific guard that has to resolve a session for itself (the platform-operator
// lane, which the per-firm chokepoint cannot serve because its caller belongs to no firm) has to
// reach this function, and app.ts imports every route module: a guard importing app.ts closed a
// cycle that grew by two findings every time a second route joined that lane. Moved here, the
// guard imports what it needs and app.ts goes on importing the guard's route.
//
// The only thing this module takes from app.ts is the `Bindings` TYPE, which every module in this
// worker takes and which carries no runtime edge.

// One Better Auth instance per worker env: the env object is stable across requests within an
// isolate, so a WeakMap-keyed cache builds the auth context once instead of on every request.
const authInstanceByEnv = new WeakMap<Bindings, ReturnType<typeof createAuth>>();

// One Workers logger per env (the env object is stable within an isolate), built over the optional
// TELEMETRY Analytics Engine binding. The single production wiring of createWorkersLogger.
const loggerInstanceByEnv = new WeakMap<Bindings, Logger>();

export function defaultLoggerForEnv(env: Bindings): Logger {
  let logger = loggerInstanceByEnv.get(env);
  if (logger === undefined) {
    logger = createWorkersLogger(env.TELEMETRY);
    loggerInstanceByEnv.set(env, logger);
  }
  return logger;
}

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
