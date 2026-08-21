import type { Logger } from "@magna-carta/telemetry/logger";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "./app.ts";

// One Workers logger per env, built over the optional TELEMETRY Analytics Engine binding. The env
// object is stable within an isolate, so a WeakMap-keyed cache builds it once rather than per call.
// The single production wiring of createWorkersLogger.
//
// It lives beside the app rather than inside it because the background half of this Worker — the
// queue consumers and the Cron sweeps — needs a logger without needing the route tree. A factory
// exported from app.ts is a runtime edge into every route registered there, and a bundle that pulls
// in the whole application to send one email is a bundle nobody can reason about.
const loggerInstanceByEnv = new WeakMap<Bindings, Logger>();

export function defaultLoggerForEnv(env: Bindings): Logger {
  let logger = loggerInstanceByEnv.get(env);
  if (logger === undefined) {
    logger = createWorkersLogger(env.TELEMETRY);
    loggerInstanceByEnv.set(env, logger);
  }
  return logger;
}
