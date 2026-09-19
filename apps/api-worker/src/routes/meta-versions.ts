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
import { VERSION_ROUTE_PATH } from "@magna-carta/build-identity/version-route";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

/**
 * Every dedicated worker in the fleet, in display order (alphabetical by deployed name). `service`
 * is the Cloudflare Worker name — the `name` field of the matching apps/<worker>/wrangler.jsonc,
 * which is the project someone would open in the dashboard to act on the row — and it is the only
 * name a row carries: the overlay shows the deployed unit itself, never an invented product name
 * for it. A fleet worker with no service binding in this environment still appears, as an honest
 * "unbound" row (`magna-carta-email` today: the worker is not on the account yet, so binding it
 * would fail this worker's own deploy — the binding line lands with that worker's deploy).
 */
export const SERVICE_VERSION_ROSTER = [
  { id: "bundle", service: "magna-carta-bundle", binding: "BUNDLE_SERVICE" },
  { id: "convert", service: "magna-carta-convert", binding: "CONVERT" },
  { id: "discovery", service: "magna-carta-discovery", binding: "DISCOVERY_SERVICE" },
  { id: "edit", service: "magna-carta-edit", binding: "EDIT_SERVICE" },
  { id: "email", service: "magna-carta-email", binding: "EMAIL_SERVICE" },
  { id: "fileRepair", service: "magna-carta-file-repair", binding: "FILE_REPAIR_SERVICE" },
  { id: "ocr", service: "magna-carta-ocr", binding: "OCR_SERVICE" },
  { id: "recovery", service: "magna-carta-recovery", binding: "RECOVERY_SERVICE" },
  { id: "scan", service: "magna-carta-scan", binding: "SCAN_SERVICE" },
  { id: "search", service: "magna-carta-search", binding: "SEARCH_SERVICE" },
  { id: "sign", service: "magna-carta-sign", binding: "SIGN_SERVICE" },
  { id: "status", service: "magna-carta-status", binding: "STATUS_SERVICE" },
  { id: "web", service: "magna-carta-web", binding: "WEB_SERVICE" },
] as const satisfies readonly { id: string; service: string; binding: keyof Bindings }[];

const ServiceVersion = z
  .object({
    id: z.string(),
    service: z.string(),
    state: z.enum(["reported", "unbound", "unreachable", "unreported"]),
    commit: z.string().nullable(),
    commitTime: z.string().nullable(),
    buildTime: z.string().nullable(),
    /*
     * What the probe cost, in milliseconds — null where there was no probe to time (an unbound
     * worker was never asked). The number was already being paid for and thrown away, and it is
     * the difference between "this worker is answering" and "this worker is answering from just
     * inside the timeout, and will read as unreachable on the next slow day".
     */
    latencyMilliseconds: z.number().nullable(),
  })
  .openapi("ServiceVersion");

export type ServiceVersionReport = z.infer<typeof ServiceVersion>;

const MetaVersionsResponse = z
  .object({
    api: z.object({
      commit: z.string(),
      commitTime: z.string().nullable(),
      buildTime: z.string().nullable(),
    }),
    services: z.array(ServiceVersion),
    observedAt: z.string(),
  })
  .openapi("MetaVersionsResponse");

// What a sibling's version route answers (packages/build-identity/src/version-route.ts). Parsed
// strictly enough that a worker answering something else entirely reads as "unreported" rather
// than as a garbled version.
const RemoteVersion = z.object({
  commit: z.string(),
  commitTime: z.string().nullable(),
  buildTime: z.string().nullable(),
});

const PROBE_TIMEOUT_MILLISECONDS = 1500;
const CACHE_TIME_TO_LIVE_MILLISECONDS = 60_000;

async function probeService(
  entry: (typeof SERVICE_VERSION_ROSTER)[number],
  fetcher: Fetcher | undefined,
  timeoutMilliseconds: number,
): Promise<ServiceVersionReport> {
  const absent = { commit: null, commitTime: null, buildTime: null };
  if (fetcher === undefined) {
    // Never asked, so there is nothing to time. A zero here would read as an instant answer.
    return {
      id: entry.id,
      service: entry.service,
      state: "unbound",
      ...absent,
      latencyMilliseconds: null,
    };
  }
  // Timed around the WHOLE exchange, the body read included: a worker that answers its headers
  // promptly and then takes a second to produce a body is slow to the caller, and the caller is
  // what this row reports on.
  const startedAtEpochMilliseconds = Date.now();
  const elapsed = (): number => Date.now() - startedAtEpochMilliseconds;
  try {
    // The hostname is decorative on a service binding (the bound worker reads only the path), but
    // a Request still requires an absolute URL — the same idiom the conversion engine port uses.
    const response = await fetcher.fetch(`https://${entry.id}${VERSION_ROUTE_PATH}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    if (response.status === 404) {
      // Deployed and answering, but from a build older than the version route.
      return {
        id: entry.id,
        service: entry.service,
        state: "unreported",
        ...absent,
        latencyMilliseconds: elapsed(),
      };
    }
    if (!response.ok) {
      return {
        id: entry.id,
        service: entry.service,
        state: "unreachable",
        ...absent,
        latencyMilliseconds: elapsed(),
      };
    }
    // A 200 whose body is not the version shape is a worker ANSWERING from a build that does not
    // carry the route — the assets-only web worker's index.html fallback is the standing example —
    // so it reads as unreported (the same fact the 404 states), never as a transport fault.
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        id: entry.id,
        service: entry.service,
        state: "unreported",
        ...absent,
        latencyMilliseconds: elapsed(),
      };
    }
    const parsed = RemoteVersion.safeParse(body);
    if (!parsed.success) {
      return {
        id: entry.id,
        service: entry.service,
        state: "unreported",
        ...absent,
        latencyMilliseconds: elapsed(),
      };
    }
    return {
      id: entry.id,
      service: entry.service,
      state: "reported",
      ...parsed.data,
      latencyMilliseconds: elapsed(),
    };
  } catch {
    // Network failure, timeout, a placeholder worker — all one honest answer. It still carries what
    // it cost: a timeout is the slowest answer there is, and saying so distinguishes a worker that
    // ran out of time from one that refused immediately.
    return {
      id: entry.id,
      service: entry.service,
      state: "unreachable",
      ...absent,
      latencyMilliseconds: elapsed(),
    };
  }
}

/** The slice of the environment the probes read: just the rostered service bindings. */
export type ServiceVersionBindings = Partial<
  Record<(typeof SERVICE_VERSION_ROSTER)[number]["binding"], Fetcher>
>;

/** Probe every rostered service binding in parallel, each under its own short timeout. */
export async function collectServiceVersions(
  env: ServiceVersionBindings,
  timeoutMilliseconds: number = PROBE_TIMEOUT_MILLISECONDS,
): Promise<ServiceVersionReport[]> {
  return Promise.all(
    SERVICE_VERSION_ROSTER.map((entry) =>
      probeService(entry, env[entry.binding], timeoutMilliseconds),
    ),
  );
}

// The per-isolate aggregate cache. Small and briefly held: a dozen parallel sub-requests per probe is
// cheap, but an open overlay polling on every click should not multiply it (work stays off the hot
// path). The observedAt it stores is surfaced to the caller so a cached answer carries its age.
let cachedServiceVersions: {
  observedAt: string;
  freshUntilEpochMilliseconds: number;
  services: ServiceVersionReport[];
} | null = null;

/** Test seam: drop the per-isolate cache so a test starts from a cold read. */
export function resetServiceVersionsCache(): void {
  cachedServiceVersions = null;
}

export async function readServiceVersionsThroughCache(
  env: ServiceVersionBindings,
  options: { forceFresh?: boolean } = {},
): Promise<{ observedAt: string; services: ServiceVersionReport[] }> {
  const now = Date.now();
  if (
    options.forceFresh !== true &&
    cachedServiceVersions !== null &&
    now < cachedServiceVersions.freshUntilEpochMilliseconds
  ) {
    return cachedServiceVersions;
  }
  // A forced read still WRITES the cache: the probe it just paid for is the freshest observation
  // there is, so the next cached read serves it rather than an older one.
  const services = await collectServiceVersions(env);
  cachedServiceVersions = {
    observedAt: new Date(now).toISOString(),
    freshUntilEpochMilliseconds: now + CACHE_TIME_TO_LIVE_MILLISECONDS,
    services,
  };
  return cachedServiceVersions;
}

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
      const { observedAt, services } = await readServiceVersionsThroughCache(c.env, {
        forceFresh: fresh === "true",
      });
      return c.json(
        {
          api: {
            commit: BUILD_IDENTITY.commit,
            commitTime: BUILD_IDENTITY.commitTime,
            buildTime: BUILD_IDENTITY.buildTime,
          },
          services,
          observedAt,
        },
        200,
      );
    },
  );
}
