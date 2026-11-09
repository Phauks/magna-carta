import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  optionalChokepointFirmId,
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { readJoiningState } from "../../../joining-state.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import type { AppVariables, FirmContext } from "../../chokepoint/ports.ts";
import { Problem } from "../../contracts/problem.ts";
import { loadEffectivePermissions } from "../../../effective-permissions.ts";
import { readFirmReleaseChannelStatement } from "@magna-carta/data-access/firm-release-channel-statements";
import { selectMemberStatusStatement } from "@magna-carta/data-access/member-statements";
import { OUTBOX_TABLE } from "@magna-carta/data-access/outbox-statements";
// The topic's home is beside the health panel that reports its backlog, and this is the same fact:
// which message the wait is on. Naming it twice would let the two drift into different strings.
import { MEMBER_PROVISION_TOPIC } from "../shared/member-provision-topic.ts";
import { evaluateCatalog, isReleaseChannel, type ReleaseChannel } from "@magna-carta/feature-flags";
import { resolveFlagEvaluator } from "../../../flags/flag-evaluator.ts";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";

// HOW FAR THE BUILD HAS GOT, as facts rather than as a fraction. Provisioning is a handful of steps
// of unequal length, so there is no percentage to quote honestly — but each step leaves its own mark
// on the firm's record, and naming them is what lets a waiting screen say what it is waiting for.
// The fields are ordered as the build performs them and each is monotone, so the first false is the
// step in flight. Every word a person reads is chosen in the browser, beside the screen that shows
// them; the wire carries only what is true.
const FirmBuildProgress = z
  .object({
    firmRecord: z.boolean().openapi({ description: "The firm's own record exists." }),
    fileStorage: z.boolean().openapi({ description: "Its file storage has been allocated." }),
    encryptionKey: z.boolean().openapi({ description: "Its encryption key has been minted." }),
    activated: z
      .boolean()
      .openapi({ description: "The firm is active and its owner is recorded — the last step." }),
    stalled: z.boolean().openapi({
      description:
        "The build stopped and is no longer being retried. Reported because it is the one state " +
        "on a waiting screen that will not clear by waiting.",
    }),
  })
  .openapi("FirmBuildProgress");

const JoiningState = z
  .object({
    state: z.enum(["chooseFirm", "firmProvisioning"]).openapi({
      description:
        "What this person still has to do: choose how they join a firm, or wait while the firm " +
        "they asked for is built.",
    }),
    build: FirmBuildProgress.optional().openapi({
      description: "Present only while a firm is being built; how far it has got.",
    }),
  })
  .openapi("JoiningState");

// THIS ACCOUNT'S STANDING IN THE FIRM IT BELONGS TO, which is not the same question as which firm it
// belongs to. The two are written by different steps: activation attaches the account to the firm in
// the control plane, and a queued message afterwards mirrors it into the firm's OWN database as a
// member. Between the two the person is a member of a firm that has never heard of them, every
// permission read resolves to nothing, and each screen they open refuses for a reason that sounds
// like an administrator has to fix it. So the gap is named on the bootstrap rather than left to be
// inferred from an empty permission list, which a member who genuinely holds no role also has.
const Membership = z
  .object({
    state: z.enum(["active", "provisioning", "stalled", "unknown"]).openapi({
      description:
        "Whether this account's member record has reached the firm's own database. " +
        "`provisioning` is a wait, not a permission somebody has to grant; `stalled` is that write " +
        "having been given up on, which waiting will not fix; `unknown` is a read that did not " +
        "answer, which is not a verdict about the account.",
    }),
  })
  .openapi("Membership");

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
    // Present only alongside a firm: whether this account's member record has landed in it. The
    // guards read it to keep somebody out of a workspace that would refuse them everything.
    membership: Membership.optional(),
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

/**
 * Whether this account's member record has reached the firm's own database.
 *
 * A HELD PERMISSION IS ITSELF THE ANSWER, and it is the answer nearly every caller gets: every
 * permission resolves through a join onto an ACTIVE member row (data-access/member-statements.ts),
 * so a non-empty set cannot exist without one. That is why the count is passed in rather than the
 * row being read on every bootstrap — the extra statements are spent only in the one ambiguous case,
 * where the set is empty and "no member record yet" and "a member holding no role" look identical
 * from the outside and mean opposite things to the person reading the screen.
 *
 * A READ THAT FAILS IS `unknown`, NEVER `provisioning`. The guards send a provisioning member back
 * to the waiting screen, and doing that on the strength of a transient fault would bounce a working
 * member out of a working workspace.
 */
async function readMembershipState(
  env: Bindings,
  firmDatabase: FirmContext["firmDatabase"],
  userId: UserId,
  permissionCount: number,
): Promise<{ state: "active" | "provisioning" | "stalled" | "unknown" }> {
  if (permissionCount > 0) return { state: "active" };
  let memberRows: { status: string }[];
  try {
    // The data-access layer's own read, which the chokepoint already makes on every request through
    // this route — the same question, so it must not be asked in two different dialects. Zero rows
    // is the never-mirrored window; a DEACTIVATED member never reaches this handler, because the
    // chokepoint answers the reserved absence for one before the route runs.
    const { results } = await selectMemberStatusStatement(firmDatabase, userId).all<{
      status: string;
    }>();
    memberRows = results;
  } catch {
    return { state: "unknown" };
  }
  if (memberRows.length > 0) return { state: "active" };

  // A WAIT AND A DEAD END LOOK THE SAME FROM THE MEMBER ROW, and telling somebody to keep waiting
  // for a message the relay has given up on is the failure this whole field exists to avoid. The
  // row is found by the user id its payload carries, the same way the health panel finds the firm's
  // backlog; `failed` is terminal, so this is the one answer here that will not change by itself.
  // A read that will not answer degrades to `provisioning` rather than `stalled`: the wait is the
  // state they are already in, and claiming a build has died on the strength of a failed SELECT is
  // the worse of the two mistakes.
  try {
    const abandoned = await env.DB_CONTROL.prepare(
      `SELECT 1 AS present FROM ${OUTBOX_TABLE} WHERE topic = ?1 AND status = 'failed' ` +
        `AND json_extract(payload, '$.userId') = ?2 LIMIT 1`,
    )
      .bind(MEMBER_PROVISION_TOPIC, userId)
      .first<{ present: number }>();
    return { state: abandoned === null ? "provisioning" : "stalled" };
  } catch {
    return { state: "provisioning" };
  }
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
          joining: await readJoiningState(c.env.DB_CONTROL, userRow.email),
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
        membership: await readMembershipState(
          c.env,
          firmContext.firmDatabase,
          userId,
          permissions.size,
        ),
      },
      200,
    );
  });
}
