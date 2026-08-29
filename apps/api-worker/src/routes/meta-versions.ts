/*
 * GET /api/v1/meta/versions — what is running, across the whole deployment: this API worker's own
 * build identity plus the build identity of every dedicated sibling worker it holds a service
 * binding to. The SPA's version overlay reads this to say, in one place, which commit each part is
 * on and whether the web app and the API have skewed apart (they deploy separately, so they can).
 *
 * Honesty rules the whole read follows:
 * - A service is REPORTED only from its own answer (each sibling serves the shared version route in
 *   packages/build-identity). Anything else is named for what it is: "unbound" (no service binding
 *   in this environment), "unreachable" (bound but failing or timing out), or "unreported" (answers
 *   but does not carry the version route — an older deploy). Never an invented version.
 * - One dead worker cannot slow the read: every probe carries a short timeout and they all run in
 *   parallel.
 * - The aggregate is cached briefly per isolate so an open overlay does not fan nine probes out on
 *   every click; `observedAt` carries the probe time so a cached answer never pretends to be fresh.
 */
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { BUILD_IDENTITY } from "@magna-carta/build-identity/build-identity";
import { VERSION_ROUTE_PATH } from "@magna-carta/build-identity/version-route";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

/** Every dedicated worker this API holds a service binding to, in display order. */
export const SERVICE_VERSION_ROSTER = [
  { id: "scan", label: "Malware Scan", binding: "SCAN_SERVICE" },
  { id: "bundle", label: "Bundle Build", binding: "BUNDLE_SERVICE" },
  { id: "convert", label: "Conversion Engines", binding: "CONVERT" },
  { id: "fileRepair", label: "File Repair", binding: "FILE_REPAIR_SERVICE" },
  { id: "recovery", label: "Password Recovery", binding: "RECOVERY_SERVICE" },
  { id: "ocr", label: "Text Recognition", binding: "OCR_SERVICE" },
  { id: "sign", label: "Document Sealing", binding: "SIGN_SERVICE" },
  { id: "discovery", label: "Discovery Engine", binding: "DISCOVERY_SERVICE" },
  { id: "search", label: "Keyword Search", binding: "SEARCH_SERVICE" },
] as const satisfies readonly { id: string; label: string; binding: keyof Bindings }[];

const ServiceVersion = z
  .object({
    id: z.string(),
    label: z.string(),
    state: z.enum(["reported", "unbound", "unreachable", "unreported"]),
    commit: z.string().nullable(),
    commitTime: z.string().nullable(),
    buildTime: z.string().nullable(),
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
    return { id: entry.id, label: entry.label, state: "unbound", ...absent };
  }
  try {
    // The hostname is decorative on a service binding (the bound worker reads only the path), but
    // a Request still requires an absolute URL — the same idiom the conversion engine port uses.
    const response = await fetcher.fetch(`https://${entry.id}${VERSION_ROUTE_PATH}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    if (response.status === 404) {
      // Deployed and answering, but from a build older than the version route.
      return { id: entry.id, label: entry.label, state: "unreported", ...absent };
    }
    if (!response.ok) {
      return { id: entry.id, label: entry.label, state: "unreachable", ...absent };
    }
    const parsed = RemoteVersion.safeParse(await response.json());
    if (!parsed.success) {
      return { id: entry.id, label: entry.label, state: "unreported", ...absent };
    }
    return { id: entry.id, label: entry.label, state: "reported", ...parsed.data };
  } catch {
    // Network failure, timeout, a placeholder worker, a non-JSON body — all one honest answer.
    return { id: entry.id, label: entry.label, state: "unreachable", ...absent };
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

// The per-isolate aggregate cache. Small and briefly held: nine parallel sub-requests per probe is
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
): Promise<{ observedAt: string; services: ServiceVersionReport[] }> {
  const now = Date.now();
  if (cachedServiceVersions !== null && now < cachedServiceVersions.freshUntilEpochMilliseconds) {
    return cachedServiceVersions;
  }
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
};

export const metaVersionsRoute = defineOpenAPIRoute(metaVersionsMeta, {
  method: "get",
  path: "/api/v1/meta/versions",
  description:
    "The build identity of every part of the deployment: this API worker's own commit, commit " +
    "time, and build time, plus the same identity for each dedicated service worker it is bound " +
    "to. A service that is not bound, not reachable, or too old to answer is reported as exactly " +
    "that, never as an invented version. The service list is briefly cached; observedAt says when " +
    "the services were actually probed.",
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
      const { observedAt, services } = await readServiceVersionsThroughCache(c.env);
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
