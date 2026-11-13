/*
 * GET /api/v1/meta/versions — what is running, across the whole deployment: this API worker's own
 * build identity plus the build identity of every dedicated sibling worker in the fleet. The SPA's
 * version overlay reads this to say, in one place, which commit each part is on and whether the web
 * app and the API have skewed apart (they deploy separately, so they can).
 *
 * Honesty rules the whole read follows:
 * - The roster is the WHOLE FLEET (every wrangler.jsonc under apps/ except this worker's own), not
 *   just the workers this deployment happens to be wired to — a worker missing from the overlay
 *   reads as "everything is listed and healthy", which is worse than an honest "Not deployed" row.
 * - A service is REPORTED only from its own answer (each sibling serves the shared version route in
 *   packages/build-identity; the assets-only web worker serves the same shape as a static file the
 *   SPA build emits). Anything else is named for what it is: "unbound" (no service binding in this
 *   environment), "unreachable" (bound but failing or timing out), or "unreported" (answers but
 *   does not carry the version route — an older deploy). Never an invented version.
 * - One dead worker cannot slow the read: every probe carries a short timeout and they all run in
 *   parallel.
 * - The aggregate is cached briefly per isolate so an open overlay does not fan a dozen probes out
 *   on every click; `observedAt` carries the probe time so a cached answer never pretends to be
 *   fresh.
 */
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { BUILD_IDENTITY } from "@magna-carta/build-identity/build-identity";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { requireChokepointUserId } from "../../chokepoint/context-accessors.ts";
import {
  FeatureRequirements,
  FeatureStatus,
  reportFeatures,
} from "../../../system-status/feature-report.ts";
import { ConnectedServiceStatus } from "../../../meetings/sfu/realtime-status.ts";
import {
  readServiceVersionsThroughCache,
  ServiceVersion,
} from "../../../system-status/service-versions.ts";

const MetaVersionsResponse = z
  .object({
    api: z.object({
      commit: z.string(),
      commitTime: z.string().nullable(),
      buildTime: z.string().nullable(),
    }),
    services: z.array(ServiceVersion),
    // The outside services the deployment depends on, which run no build of ours to report.
    connectedServices: z.array(ConnectedServiceStatus),
    // Every feature and its state; what each needs, for a platform operator only (feature-report.ts).
    features: z.array(FeatureStatus),
    featureRequirements: z.array(FeatureRequirements).nullable(),
    observedAt: z.string(),
  })
  .openapi("MetaVersionsResponse");

// permission: null — any authenticated member may ask what is running (a non-mutating read, the
// same authenticated-null case as GET /api/v1/me); the chokepoint still resolves session and firm.
export const metaVersionsMeta: RouteMeta = {
  operationId: "meta.versions",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
  // The read must survive the fault it reports. This route is firm-scoped for its session
  // and permission handling, but it reads no firm data, so the chokepoint's member-active
  // check — a read against the very database that may be down — must not be what decides
  // whether it answers. Without this the diagnostic surfaces went dark exactly when they
  // were the only thing worth looking at.
  firmDatabaseOutage: "tolerate",
};

export const metaVersionsRoute = defineOpenAPIRoute(metaVersionsMeta, {
  method: "get",
  path: "/api/v1/meta/versions",
  request: {
    // fresh=true skips the brief cache and re-probes every worker now. It exists for the panel's
    // explicit Refresh gesture: a member who pressed the button asked what is running NOW, and
    // handing the same cached observation back with its age still climbing reads as a broken
    // button. The automatic on-open read stays on the cached path, which is what the cache is for.
    query: z.object({ fresh: z.enum(["true"]).optional() }),
  },
  description:
    "The build identity of every part of the deployment: this API worker's own commit, commit " +
    "time, and build time, plus the same identity for every dedicated sibling worker in the " +
    "fleet, each named by the Cloudflare Worker it deploys as. A worker that is not bound, not " +
    "reachable, or too old to answer is reported as exactly that, never as an invented version. " +
    "connectedServices says whether each outside service the deployment depends on (Cloudflare " +
    "Realtime, which carries meetings) is configured and accepting it. features gives each feature's " +
    "state; featureRequirements (platform operators only, else null) says which settings are set. " +
    "The service list is briefly cached; observedAt says when the services were actually probed.",
  responses: {
    200: {
      description: "The deployment's build identities",
      content: { "application/json": { schema: MetaVersionsResponse } },
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

export function registerMetaVersionsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...metaVersionsRoute, middleware: chokepointMiddleware(chokepoint, metaVersionsRoute) },
    async (c) => {
      const { fresh } = c.req.valid("query");
      const { observedAt, services, connectedServices } = await readServiceVersionsThroughCache(
        c.env,
        {
          forceFresh: fresh === "true",
        },
      );
      const { features, featureRequirements } = await reportFeatures(c.env, {
        userId: requireChokepointUserId(c),
        services,
        connectedServices,
      });
      return c.json(
        {
          api: {
            commit: BUILD_IDENTITY.commit,
            commitTime: BUILD_IDENTITY.commitTime,
            buildTime: BUILD_IDENTITY.buildTime,
          },
          services,
          connectedServices,
          features,
          featureRequirements,
          observedAt,
        },
        200,
      );
    },
  );
}
