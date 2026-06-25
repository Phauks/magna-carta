import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { Problem } from "../contracts/problem.ts";
import { loadEffectivePermissions } from "../session-context.ts";
import { readFirmReleaseChannelStatement } from "@magna-carta/data-access/firm-release-channel-statements";
import { evaluateCatalog, isReleaseChannel, type ReleaseChannel } from "@magna-carta/feature-flags";
import { resolveFlagEvaluator } from "../flags/flag-evaluator.ts";

const MeResponse = z
  .object({
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    firm: z.object({ id: z.string(), name: z.string() }),
    permissions: z.array(z.string()),
    channel: z.enum(["stable", "beta", "alpha"]),
    flags: z.record(z.string(), z.boolean()),
  })
  .openapi("MeResponse");

// The route metadata: the chokepoint reads it at registration to enforce
// tenancy/authn/RBAC/idempotency/rate-limit; the document emits each field as an x-mc-* extension.
// permission: null — any authenticated member may read their OWN bootstrap (a non-mutating read,
// the legitimate authenticated-null case the route-meta guard permits); the chokepoint resolves the
// session and firm (404 on structural absence / deactivation) and skips the permission gate, and
// this handler loads the effective permissions itself.
export const meMeta: RouteMeta = {
  operationId: "me.get",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const meRoute = defineOpenAPIRoute(meMeta, {
  method: "get",
  path: "/api/v1/me",
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
        "The session's firm is not reachable from this deployment, or the session user is a " +
        "deactivated member of it (absent, never an existence oracle)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Registers GET /api/v1/me through the chokepoint. The handler runs ONLY after the chokepoint
// passed it (session resolved, firm present, member not deactivated). The inline
// session/firm/member-active checks an earlier version of this handler carried are GONE — the
// chokepoint owns them now. The handler reads the resolved tenancy from the chokepoint context and
// does business logic only: the user's display fields plus the effective permissions in their firm. A
// never-mirrored user (sweep-lag window) reads empty permissions — the chokepoint let them through
// (only a DEACTIVATED member is absent), and the permission statements join nothing.
export function registerMeRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi({ ...meRoute, middleware: chokepointMiddleware(chokepoint, meRoute) }, async (c) => {
    const userId = requireChokepointUserId(c);
    const firmId = requireChokepointFirmId(c);
    const firmContext = requireChokepointFirmContext(c);

    const userRow = await c.env.DB_CONTROL.prepare('SELECT name, email FROM "user" WHERE id = ?1')
      .bind(userId)
      .first<{ name: string; email: string }>();
    // The session resolved a user id the control plane carries (the chokepoint read the same firm
    // row); an absent user row here would be control-plane corruption, not a routine 404.
    if (userRow === null) {
      throw new Error(
        `session user ${userId} resolved by the chokepoint but absent from the control plane`,
      );
    }

    const permissions = await loadEffectivePermissions(firmContext.firmDatabase, userId);

    const channelRow = await readFirmReleaseChannelStatement(c.env.DB_CONTROL, firmId).first<{
      release_channel: string;
    }>();
    const rawChannel = channelRow?.release_channel ?? "stable";
    const channel: ReleaseChannel = isReleaseChannel(rawChannel) ? rawChannel : "stable";
    const flags = await evaluateCatalog(resolveFlagEvaluator(c.env), {
      targetingKey: userId,
      firmId,
      channel,
    });

    return c.json(
      {
        user: { id: userId, name: userRow.name, email: userRow.email },
        firm: { id: firmId, name: firmContext.firmName },
        // Sorted for a deterministic wire shape (a Set has insertion order, not a contract).
        permissions: [...permissions].sort(),
        channel,
        flags,
      },
      200,
    );
  });
}
