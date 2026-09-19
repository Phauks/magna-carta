import type { MiddlewareHandler } from "hono";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import type { Bindings } from "./bindings.ts";
import type { AppVariables } from "./chokepoint/ports.ts";
import { controlPlaneMigrations } from "./control-plane-migrations.ts";
import { devUploadEmulationActive } from "./files/presigner-wiring.ts";

/*
 * DEVELOPMENT-ONLY control-plane schema bootstrap.
 *
 * Production brings the control-plane schema to head on the five-minute cron (scheduled.ts runs the
 * migration pass first, error-isolated). `wrangler dev` never fires cron, so a fresh Miniflare
 * control-plane database has no tables at all, and the first thing a person tries — registering a
 * firm, signing in — answers a 500 ("no such table") until somebody knows to curl
 * /cdn-cgi/handler/scheduled by hand. This middleware closes that gap: in local development it
 * applies the same idempotent migration lineage before the first API request is served.
 *
 * Gated on devUploadEmulationActive — the fail-closed "this is not production" signal the dev seed
 * and dev upload routes already select on — so a production deploy never runs a migration pass on
 * the request path. The pass itself runs once per worker isolate (the promise is cached per env);
 * on a warm database the runner reads the migration ledger and applies nothing.
 *
 * A failed pass clears the cache and rethrows, so the visitor sees the real migration error with an
 * Error ID rather than a "no such table" symptom several tables downstream of the cause — and the
 * next request retries rather than caching the failure forever.
 */

const migrationPassByEnv = new WeakMap<Bindings, Promise<unknown>>();

export const devControlPlaneMigrationMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = async (c, next) => {
  if (devUploadEmulationActive(c.env)) {
    let pass = migrationPassByEnv.get(c.env);
    if (pass === undefined) {
      pass = runPendingMigrations(d1MigrationTarget(c.env.DB_CONTROL), controlPlaneMigrations());
      migrationPassByEnv.set(c.env, pass);
    }
    try {
      await pass;
    } catch (caught) {
      migrationPassByEnv.delete(c.env);
      throw caught;
    }
  }
  await next();
};
