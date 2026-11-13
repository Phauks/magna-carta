/*
 * The probing half of GET /api/v1/meta/versions: the fleet roster, the per-Worker version probe
 * and its states, and the brief per-isolate cache over the whole observation. The route
 * (src/http/routes/platform/meta-versions.ts) states the honesty rules this follows and owns the
 * wire response; this module is the machinery it calls.
 */
import { z } from "@hono/zod-openapi";
import { VERSION_ROUTE_PATH } from "@magna-carta/build-identity/version-route";
import type { Bindings } from "../bindings.ts";
import {
  type ConnectedServiceStatusReport,
  probeRealtimeService,
} from "../meetings/sfu/realtime-status.ts";

/**
 * Every dedicated worker in the fleet, in display order (alphabetical by deployed name). `service`
 * is the Cloudflare Worker name — the `name` field of the matching apps/<worker>/wrangler.jsonc,
 * which is the project someone would open in the dashboard to act on the row — and it is the only
 * name a row carries: the overlay shows the deployed unit itself, never an invented product name
 * for it. A fleet worker with no service binding here still appears, as an honest "unbound" row
 * (`magna-carta-email` and `magna-carta-community` today: binding a worker not yet on the account
 * fails this worker's deploy, so the binding line lands after that worker's first deploy). */
export const SERVICE_VERSION_ROSTER = [
  { id: "address", service: "magna-carta-address", binding: "ADDRESS_SERVICE" },
  { id: "bundle", service: "magna-carta-bundle", binding: "BUNDLE_SERVICE" },
  { id: "community", service: "magna-carta-community", binding: "COMMUNITY_SERVICE" },
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

export const ServiceVersion = z
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
  const row = (
    state: ServiceVersionReport["state"],
    latencyMilliseconds: number | null,
    version: Pick<ServiceVersionReport, "commit" | "commitTime" | "buildTime"> = {
      commit: null,
      commitTime: null,
      buildTime: null,
    },
  ): ServiceVersionReport => ({
    id: entry.id,
    service: entry.service,
    state,
    ...version,
    latencyMilliseconds,
  });
  // Never asked, so there is nothing to time. A zero here would read as an instant answer.
  if (fetcher === undefined) return row("unbound", null);
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
    // A 404 is a worker deployed and answering, but from a build older than the version route.
    if (response.status === 404) return row("unreported", elapsed());
    if (!response.ok) return row("unreachable", elapsed());
    // A 200 whose body is not the version shape is a worker ANSWERING from a build that does not
    // carry the route — the assets-only web worker's index.html fallback is the standing example —
    // so it reads as unreported (the same fact the 404 states), never as a transport fault.
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return row("unreported", elapsed());
    }
    const parsed = RemoteVersion.safeParse(body);
    return parsed.success ? row("reported", elapsed(), parsed.data) : row("unreported", elapsed());
  } catch {
    // Network failure, timeout, a placeholder worker — all one honest answer. It still carries what
    // it cost: a timeout is the slowest answer there is, and saying so distinguishes a worker that
    // ran out of time from one that refused immediately.
    return row("unreachable", elapsed());
  }
}

/** The slice of the environment the probes read: just the rostered service bindings. */
export type ServiceVersionBindings = Partial<
  Record<(typeof SERVICE_VERSION_ROSTER)[number]["binding"], Fetcher>
> &
  Partial<Pick<Bindings, "REALTIME_SFU_APP_ID" | "REALTIME_SFU_APP_SECRET">>;

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
  connectedServices: ConnectedServiceStatusReport[];
} | null = null;

/** Test seam: drop the per-isolate cache so a test starts from a cold read. */
export function resetServiceVersionsCache(): void {
  cachedServiceVersions = null;
}

export async function readServiceVersionsThroughCache(
  env: ServiceVersionBindings,
  options: { forceFresh?: boolean } = {},
): Promise<{
  observedAt: string;
  services: ServiceVersionReport[];
  connectedServices: ConnectedServiceStatusReport[];
}> {
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
  const [services, realtime] = await Promise.all([
    collectServiceVersions(env),
    probeRealtimeService(env, PROBE_TIMEOUT_MILLISECONDS),
  ]);
  cachedServiceVersions = {
    observedAt: new Date(now).toISOString(),
    freshUntilEpochMilliseconds: now + CACHE_TIME_TO_LIVE_MILLISECONDS,
    services,
    connectedServices: [realtime],
  };
  return cachedServiceVersions;
}

