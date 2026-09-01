import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import {
  optionalChokepointFirmId,
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { readJoiningState } from "../joining-state.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { Problem } from "../contracts/problem.ts";
import { loadEffectivePermissions } from "../session-context.ts";
import { readFirmReleaseChannelStatement } from "@magna-carta/data-access/firm-release-channel-statements";
import { evaluateCatalog, isReleaseChannel, type ReleaseChannel } from "@magna-carta/feature-flags";
import { resolveFlagEvaluator } from "../flags/flag-evaluator.ts";
import type { FirmId } from "@magna-carta/identifiers/types";

const JoiningState = z
  .object({
    state: z.enum(["chooseFirm", "firmProvisioning"]).openapi({
      description:
        "What this person still has to do: choose how they join a firm, or wait while the firm " +
        "they asked for is built.",
    }),
  })
  .openapi("JoiningState");

const MeResponse = z
  .object({
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    // NULL for a person who belongs to no firm — an account that exists and has not yet founded a
    // firm or redeemed an invitation. Nullable rather than absent so a consumer has to read it.
    firm: z.object({ id: z.string(), name: z.string() }).nullable(),
    permissions: z.array(z.string()),
    channel: z.enum(["stable", "beta", "alpha"]),
    flags: z.record(z.string(), z.boolean()),
    // Present only alongside a null firm: what the joining surface should show. Server-held, so a
    // person who closes the tab while their firm is building reopens it on the waiting screen.
    joining: JoiningState.optional(),
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
  // The bootstrap has to answer for a person who has no firm yet, because the answer is what tells
  // the app to send them to the joining screen rather than into a workspace they do not have.
  firmlessSession: "allow",
};

export const meRoute = defineOpenAPIRoute(meMeta, {
  method: "get",
  path: "/api/v1/me",
  description:
    "The session user, their firm, and their effective permissions — the SPA's bootstrap call. A " +
    "person who has not yet joined a firm answers with a null firm, no permissions, and what the " +
    "joining surface should show them next.",
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

export async function resolveChannelAndFlags(
  env: Bindings,
  userId: string,
  firmId: FirmId,
): Promise<{ channel: ReleaseChannel; flags: Record<string, boolean> }> {
  let channel: ReleaseChannel = "stable";
  try {
    const channelRow = await readFirmReleaseChannelStatement(env.DB_CONTROL, firmId).first<{
      release_channel: string;
    }>();
    const rawChannel = channelRow?.release_channel ?? "stable";
    channel = isReleaseChannel(rawChannel) ? rawChannel : "stable";
  } catch {
    // The additive release_channel column can be briefly absent right after a deploy, before the
    // scheduled applier lands it (src/control-plane-migrations.ts). That is an expected transient,
    // not a bug, so we degrade to the stable channel without error-reporting (which would spam the
    // pipeline on every migration-bearing deploy); it self-heals on the next scheduled pass. Flag
    // evaluation below is intentionally OUTSIDE this catch: the flag provider already fail-safes per
    // flag, so a throw there is a genuine bug that must surface rather than be silently swallowed.
    channel = "stable";
  }
  const flags = await evaluateCatalog(resolveFlagEvaluator(env), {
    targetingKey: userId,
    firmId,
    channel,
  });
  return { channel, flags };
}

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

    // A person who belongs to no firm. There is no firm context to read, no member row to resolve
    // permissions from, and no firm whose release channel or flags could apply — so the answer is
    // the person, an explicit null, and what the joining surface should do about it. The empty
    // permission list is not a degraded read: a principal with no firm genuinely holds no
    // capability anywhere, which is what the reserved 404 on every other route already enforces.
    if (optionalChokepointFirmId(c) === undefined) {
      return c.json(
        {
          user: { id: userId, name: userRow.name, email: userRow.email },
          firm: null,
          permissions: [],
          channel: "stable" as const,
          flags: {},
          joining: { state: await readJoiningState(c.env.DB_CONTROL, userRow.email) },
        },
        200,
      );
    }

    const firmId = requireChokepointFirmId(c);
    const firmContext = requireChokepointFirmContext(c);
    const permissions = await loadEffectivePermissions(firmContext.firmDatabase, userId);

    const { channel, flags } = await resolveChannelAndFlags(c.env, userId, firmId);

    return c.json(
      {
        user: { id: userId, name: userRow.name, email: userRow.email },
        firm: { id: firmId, name: await firmContext.readFirmName() },
        // Sorted for a deterministic wire shape (a Set has insertion order, not a contract).
        permissions: [...permissions].sort(),
        channel,
        flags,
      },
      200,
    );
  });
}
