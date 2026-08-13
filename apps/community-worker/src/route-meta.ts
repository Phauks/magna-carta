// Every route on this board declares who may call it, and the declaration is what the guard
// enforces — the same idea as the application worker's chokepoint, in the smaller form this surface
// needs. A handler never checks a caller itself, so a handler cannot forget to.
//
// There is no per-firm role in this list on purpose. The board has no firm-scoped permissions and
// must not grow any: a capability read out of a firm's own database would be a per-firm read from a
// cross-firm surface, and this worker holds no binding that could perform one. The three levels
// below are the whole access model.

import { createRoute } from "@hono/zod-openapi";
import type { RouteConfig } from "@hono/zod-openapi";
import { problemSchema } from "./problem.ts";

export type BoardAccess =
  // Anybody, signed in or not. Reading the board needs no account, which is the acquisition value
  // the whole surface exists for.
  | "public"
  // A signed-in member of a provisioned, active firm. The provisioned-firm requirement is the
  // board's highest-value anti-spam control and it is already built.
  | "member"
  // A platform operator. Moderation is a platform axis, never a firm one.
  | "operator";

export interface BoardRouteMeta {
  readonly operationId: string; // 'community.action'
  readonly access: BoardAccess;
  // The write budget this route spends, or null for a read. A route that writes and names no
  // bucket is refused at registration rather than discovered later to have been unlimited.
  readonly rateLimitBucket: "post" | "comment" | "vote" | "report" | "profile" | null;
}

const OPERATION_ID_PATTERN = /^community\.[a-z][a-zA-Z0-9]*$/;
const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"]);

const routeMetaByRoute = new WeakMap<object, BoardRouteMeta>();

export function boardRouteMetaOf(route: object): BoardRouteMeta | undefined {
  return routeMetaByRoute.get(route);
}

type DescribedRouteConfig<P extends string> = Omit<RouteConfig, "path"> & {
  path: P;
  description: string;
};

// The shared error replies every route can produce, so a route declares only what is unusual about
// it. The board-read-only refusal is on every mutating route because the kill switch is enforced
// before anything else, and a contract that did not admit it would be lying about the surface.
const SHARED_ERROR_RESPONSES = {
  429: {
    description: "Too many writes from this account or firm in the window.",
    content: { "application/problem+json": { schema: problemSchema } },
  },
  503: {
    description: "The board is temporarily read only. Reads are unaffected.",
    content: { "application/problem+json": { schema: problemSchema } },
  },
} as const;

const AUTHENTICATED_ERROR_RESPONSES = {
  401: {
    description: "No valid session.",
    content: { "application/problem+json": { schema: problemSchema } },
  },
  403: {
    description: "Signed in, but this account may not write to the board.",
    content: { "application/problem+json": { schema: problemSchema } },
  },
} as const;

export function boardRoute<P extends string, R extends DescribedRouteConfig<P>>(
  meta: BoardRouteMeta,
  routeConfig: R,
) {
  if (!OPERATION_ID_PATTERN.test(meta.operationId)) {
    throw new TypeError(
      `Malformed operationId ${JSON.stringify(meta.operationId)}: expected "community.action".`,
    );
  }
  const mutating = MUTATING_METHODS.has(routeConfig.method.toLowerCase());
  if (mutating && meta.access === "public") {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} mutates the board but is declared public — ` +
        `the board is public to READ and requires a signed-in member of a provisioned firm to write.`,
    );
  }
  if (mutating && meta.rateLimitBucket === null) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} mutates the board but names no rate-limit ` +
        `bucket, which would leave it unbudgeted; name one from BUCKET_POLICIES.`,
    );
  }
  const route = createRoute({
    ...routeConfig,
    operationId: meta.operationId,
    tags: ["community"],
    responses: {
      ...routeConfig.responses,
      ...(mutating ? SHARED_ERROR_RESPONSES : {}),
      ...(meta.access === "public" ? {} : AUTHENTICATED_ERROR_RESPONSES),
    },
    "x-mc-operationId": meta.operationId,
    "x-mc-access": meta.access,
    "x-mc-rateLimit": meta.rateLimitBucket,
  });
  routeMetaByRoute.set(route, meta);
  return route;
}
