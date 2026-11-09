import type { MiddlewareHandler } from "hono";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { Bindings } from "../bindings.ts";
import { runInBackground } from "./deferred-work.ts";
import {
  optionalChokepointFirmContext,
  optionalChokepointFirmId,
  optionalChokepointUserId,
} from "./chokepoint/context-accessors.ts";
import type { AppVariables } from "./chokepoint/ports.ts";
import { emitUsage } from "../usage/emit.ts";
import { routeFeature } from "../usage/feature-map.ts";

interface ReachedDeps {
  readonly pepperFor: (env: Bindings) => string | undefined;
  readonly consent: {
    resolve(database: SqlDatabase, firmId: string, userId: string): Promise<boolean>;
  };
  readonly now?: () => string;
}

// Server-side "reached": runs on the OUTBOUND pass (after next()), once the chokepoint has populated
// tenancy and the request authorized. A request with no firm context (public / 401 / 404), an
// unmapped route, or no request logger emits nothing. Mapped + authorized -> one reached event.
export function usageReachedMiddleware(
  deps: ReachedDeps,
): MiddlewareHandler<{ Bindings: Bindings; Variables: AppVariables }> {
  const now = deps.now ?? (() => new Date().toISOString());
  return async (c, next) => {
    await next();
    const firmId = optionalChokepointFirmId(c);
    const firmContext = optionalChokepointFirmContext(c);
    const userId = optionalChokepointUserId(c);
    if (firmId === undefined || firmContext === undefined || userId === undefined) return;
    const feature = routeFeature(c.req.routePath);
    if (feature === null) return;
    const logger = c.get("logger") as Logger | undefined;
    if (logger === undefined) return;

    // Telemetry is never allowed to disturb the response the route already produced. The consent read
    // is a database call and the emit hashes identifiers — either can fail, and both run AFTER the
    // handler has committed its status and body, so a throw here would turn a delivered 2xx into a 500.
    // The work is therefore moved off the response path (the platform keeps it alive past the return)
    // and its failure is reported through the standard background-failure pipeline instead of thrown.
    const correlationId = c.get("correlationId") ?? "";
    const pepper = deps.pepperFor(c.env);
    const emittedAt = now();
    const work = (async () => {
      const consented = await deps.consent.resolve(firmContext.firmDatabase, firmId, userId);
      await emitUsage({
        logger,
        consented,
        pepper,
        correlationId,
        now: emittedAt,
        feature,
        phase: "reached",
        surface: null,
        appVersion: null,
        firmId,
        userId,
      });
    })().catch((caught: unknown) => {
      logOperationFailed(logger, "usage-reached", caught, correlationId);
    });
    runInBackground(c, work);
  };
}
