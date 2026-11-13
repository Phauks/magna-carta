import type { OpenAPIHono } from "@hono/zod-openapi";
import { communityHandoffResponseSchema } from "@magna-carta/community/contract";
import { mintHandoffToken } from "@magna-carta/community/session";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointUserId } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// THE WAY A SIGNED-IN MEMBER CROSSES TO THE COMMUNITY BOARD. The board is its own host
// (community.magnacarta.esq) and cannot read this app's session cookie, so this route mints a
// one-minute, one-use token naming the person and answers the board's address with it. The board's
// worker (apps/community-worker) verifies it, records it as used, and sets its own cookie. Nothing
// about the person's firm crosses: the board reads that afresh from the control plane each time.
//
// The token is signed with COMMUNITY_HANDOFF_SECRET, shared with the board's worker alone, and never
// with AUTH_SECRET: a leak from the board must not be able to forge an app session or any other
// token this worker signs. The secret is optional, so a deployment without it still deploys; the
// route then answers 503 and the board stays readable to everyone.

const meta: RouteMeta = {
  operationId: "me.communityHandoff",
  surface: "app",
  authenticated: true,
  // A read about the person asking; it changes nothing here. The board decides what they may do.
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
  // A person with no firm may still go and read; the board refuses them a write itself.
  firmlessSession: "allow",
};

const route = defineOpenAPIRoute(meta, {
  method: "get",
  path: "/api/v1/me/community-handoff",
  description:
    "A one-minute, one-use address on the community board that signs the session member in there. " +
    "Fetched at the moment they choose to go, never ahead of time.",
  responses: {
    200: {
      description: "The address to send the browser to",
      content: { "application/json": { schema: communityHandoffResponseSchema } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "Signing in to the board is not set up on this deployment",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const DEFAULT_COMMUNITY_BASE_URL = "https://community.magnacarta.esq";

export function registerMeCommunityHandoffRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi({ ...route, middleware: chokepointMiddleware(chokepoint, route) }, async (c) => {
    const secret = c.env.COMMUNITY_HANDOFF_SECRET;
    if (secret === undefined || secret === "") {
      return problemJson(c, {
        type: "community-sign-in-not-configured",
        title: "Board sign-in is not set up",
        status: 503,
        detail: "Signing in to the community board is not set up yet. You can still read it.",
      });
    }
    const userId = requireChokepointUserId(c);
    const token = await mintHandoffToken(secret, userId, Math.floor(Date.now() / 1000));
    const base = c.env.COMMUNITY_BASE_URL ?? DEFAULT_COMMUNITY_BASE_URL;
    c.header("Cache-Control", "no-store");
    return c.json({ url: `${base}/session/begin?token=${encodeURIComponent(token)}` }, 200);
  });
}
