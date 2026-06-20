import type { MiddlewareHandler } from "hono";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../app.ts";
import {
  optionalChokepointFirmContext,
  optionalChokepointFirmId,
  optionalChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { emitUsage } from "./emit.ts";
import { routeFeature } from "./feature-map.ts";

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

    const consented = await deps.consent.resolve(firmContext.firmDatabase, firmId, userId);
    await emitUsage({
      logger,
      consented,
      pepper: deps.pepperFor(c.env),
      correlationId: c.get("correlationId") ?? "",
      now: now(),
      feature,
      phase: "reached",
      surface: null,
      appVersion: null,
      firmId,
      userId,
    });
  };
}
