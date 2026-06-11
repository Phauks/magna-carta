import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { createAuth } from "../auth.ts";
import { resolveFirmDatabase } from "../firm-binding-resolver.ts";
import { Problem, notFoundProblemResponse, unauthenticatedProblemResponse } from "../problem.ts";
import { loadEffectivePermissions, resolveSession } from "../session-context.ts";

const MeResponse = z
  .object({
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    firm: z.object({ id: z.string(), name: z.string() }),
    permissions: z.array(z.string()),
  })
  .openapi("MeResponse");

// Route metadata is declared twice on purpose (docs/conventions/api.md): the x-mc-* extensions
// feed the ADR-0067 chokepoint + CI fitness functions (slice 0·5); the OpenAPI-native operationId
// is what SDK generators key method names off (spike finding #1). x-mc-rateLimit is omitted until
// named buckets exist (slice 0·5); x-mc-permission is null — any authenticated member may read
// their own bootstrap.
const meRoute = createRoute({
  method: "get",
  path: "/api/v1/me",
  operationId: "me.get",
  tags: ["me"],
  description:
    "The session user, their firm, and their effective permissions — the SPA's bootstrap call.",
  responses: {
    200: {
      description: "The session user, firm, and effective permissions",
      content: { "application/json": { schema: MeResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session's firm is not reachable from this deployment (ADR-0052 — absent, never an existence oracle)",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
  "x-mc-operationId": "me.get",
  "x-mc-surface": "app",
  "x-mc-authenticated": true,
  "x-mc-permission": null,
  "x-mc-resource": "firm",
  "x-mc-audited": false,
  "x-mc-idempotency": "optional",
});

interface UserAndFirmRow {
  readonly user_name: string;
  readonly user_email: string;
  readonly firm_name: string;
  readonly database_identifier: string;
}

// The auth accessor is injected by app.ts (which owns the per-env Better Auth cache) so the route
// module never imports app.ts at value level — types only, no module cycle.
export function registerMeRoute(
  app: OpenAPIHono<{ Bindings: Bindings }>,
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): void {
  app.openapi(meRoute, async (c) => {
    const sessionContext = await resolveSession(authForEnv(c.env), c);
    if (sessionContext === null) return unauthenticatedProblemResponse(c);

    // One control-plane read for the session user's display fields plus the firm registry row.
    // The JOIN folds a missing firm row and a missing user row onto the same absent path below.
    const row = await c.env.DB_CONTROL.prepare(
      'SELECT "user".name AS user_name, "user".email AS user_email, firm.name AS firm_name, firm.database_identifier AS database_identifier FROM "user" JOIN firm ON firm.id = "user".firm_id WHERE "user".id = ?1 AND firm.id = ?2',
    )
      .bind(sessionContext.userId, sessionContext.firmId)
      .first<UserAndFirmRow>();

    const firmDatabase = row === null ? null : resolveFirmDatabase(c.env, row.database_identifier);
    if (row === null || firmDatabase === null) {
      // ADR-0052: a firm row this control plane does not carry, or a firm database this
      // deployment has no binding for, is ABSENT — 404, never a 500 and never an oracle.
      return notFoundProblemResponse(c);
    }

    const permissions = await loadEffectivePermissions(firmDatabase, sessionContext.userId);

    return c.json(
      {
        user: { id: sessionContext.userId, name: row.user_name, email: row.user_email },
        firm: { id: sessionContext.firmId, name: row.firm_name },
        // Sorted for a deterministic wire shape (a Set has insertion order, not a contract).
        permissions: [...permissions].sort(),
      },
      200,
    );
  });
}
