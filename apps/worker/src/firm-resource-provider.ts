import type { FirmId } from "@magna-carta/identifiers/types";

// The provisioning port: how the firm provisioner obtains a firm's
// physical resources. Two adapters below — the dev pool-claimer (Miniflare cannot create D1/R2 at
// runtime) and the Cloudflare REST adapter (real resource creation, deploy-time credentials).
export interface FirmResourceProvider {
  createDatabase(firmId: FirmId): Promise<{ databaseIdentifier: string }>;
  createBucket(firmId: FirmId): Promise<{ bucketName: string }>;
}

// ---------------------------------------------------------------------------
// Dev adapter
// ---------------------------------------------------------------------------

export interface DevFirmResourceProviderOptions {
  // The pre-declared wrangler.jsonc pool, in claim order (see firm-binding-resolver.ts).
  readonly poolBindingNames: readonly string[];
  // Which database identifiers firm rows already hold — injected so the claim logic stays pure
  // and unit-testable; the worker wiring queries the control-plane firm table.
  readonly claimedDatabaseIdentifiers: () => Promise<readonly string[]>;
}

// "Creation" locally claims the next free pool binding: Miniflare cannot create D1 databases at
// runtime, so wrangler.jsonc pre-declares a fixed pool and a claimed firm's database_identifier
// IS the binding name. The claim becomes durable only when the provisioner records it on the firm
// row, whose UNIQUE(database_identifier) makes a double-claim fail loud.
export function createDevFirmResourceProvider(
  options: DevFirmResourceProviderOptions,
): FirmResourceProvider {
  return {
    async createDatabase(): Promise<{ databaseIdentifier: string }> {
      const claimed = new Set(await options.claimedDatabaseIdentifiers());
      const free = options.poolBindingNames.find((bindingName) => !claimed.has(bindingName));
      if (free === undefined) {
        throw new Error(
          `dev firm-database pool exhausted: all of [${options.poolBindingNames.join(", ")}] are claimed — ` +
            "add a pool member (wrangler.jsonc + Bindings in app.ts + firm-binding-resolver.ts, in lockstep)",
        );
      }
      return { databaseIdentifier: free };
    },

    // Miniflare cannot create R2 buckets at runtime either; every locally-provisioned firm shares
    // the single pre-declared R2 binding. Per-firm bucket isolation is a production property —
    // locally the bucket name only marks the provisioning step complete. The "R2" literal tracks
    // the binding key on Bindings in app.ts (and its wrangler.jsonc r2_buckets entry) — rename
    // them in lockstep.
    createBucket(): Promise<{ bucketName: string }> {
      return Promise.resolve({ bucketName: "R2" });
    },
  };
}

// ---------------------------------------------------------------------------
// Cloudflare REST adapter
// ---------------------------------------------------------------------------

export interface CloudflareRestFirmResourceProviderOptions {
  readonly accountId: string;
  // A deploy-time Worker secret (wrangler secret put CLOUDFLARE_API_TOKEN) — never needed
  // locally, where the dev adapter runs instead.
  readonly apiToken: string;
  readonly fetchImplementation?: typeof fetch;
}

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

// Resource naming: magna-carta-<environment>-<scope>[-<purpose-or-slug>]. The slug must be
// deterministic per firm (idempotent resume re-creates the SAME resource and hits already-exists)
// and valid in both the D1 and R2 name alphabets, which exclude the identifier alphabet's
// uppercase and underscore characters — so the firm id is folded through SHA-256 and the first
// 128 bits are spent as lowercase hex.
const FIRM_RESOURCE_NAME_PREFIX = "magna-carta-production-firm";

export async function firmResourceName(firmId: FirmId): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(firmId));
  const slug = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${FIRM_RESOURCE_NAME_PREFIX}-${slug}`;
}

interface CloudflareApiEnvelope<Result> {
  readonly success: boolean;
  readonly result?: Result;
  readonly errors?: readonly { readonly code?: number; readonly message?: string }[];
}

// RACE-WINDOW FALLBACK ONLY — deliberately demoted from the resume linchpin it once was.
// Idempotent resume now travels find-first: each create PROBES for the
// resource by its deterministic name and only creates when absent, so a crashed provisioning's
// retry never depends on this detection. It remains solely for the narrow race where a concurrent
// create lands between the probe and the POST. Detection is by message ("already exists" /
// "already own") plus R2's documented 10004 code — the Cloudflare error catalog carries no stable
// cross-product duplicate code, which is exactly why a vendor copy-edit must never be able to
// wedge a resume (it can only widen this benign race window).
function isAlreadyExists(envelope: CloudflareApiEnvelope<unknown>): boolean {
  return (envelope.errors ?? []).some(
    (error) => error.code === 10004 || /already (exists|own)/i.test(error.message ?? ""),
  );
}

function describeFailure(
  operation: string,
  status: number,
  envelope: CloudflareApiEnvelope<unknown>,
): Error {
  const messages = (envelope.errors ?? [])
    .map((error) => `${String(error.code ?? "?")}: ${error.message ?? "(no message)"}`)
    .join("; ");
  return new Error(
    `${operation} failed: HTTP ${String(status)} — ${messages || "(no error detail)"}`,
  );
}

// Real resource creation through the Cloudflare REST API. The new database still needs its
// per-firm BINDING added by a config commit + deploy — the documented manual step for a fleet of
// one; this adapter only guarantees the resource exists and is
// recorded on the firm row.
export function createCloudflareRestFirmResourceProvider(
  options: CloudflareRestFirmResourceProviderOptions,
): FirmResourceProvider {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const accountBase = `${CLOUDFLARE_API_BASE}/accounts/${options.accountId}`;
  const headers = {
    authorization: `Bearer ${options.apiToken}`,
    "content-type": "application/json",
  };

  async function callApi<Result>(
    operation: string,
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<{ status: number; envelope: CloudflareApiEnvelope<Result> }> {
    const response = await fetchImplementation(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Text first, parse second: an HTML edge error page (502/520) must surface as a described
    // failure carrying the operation and HTTP status — never an opaque JSON SyntaxError that
    // loses both.
    const text = await response.text();
    try {
      return {
        status: response.status,
        envelope: JSON.parse(text) as CloudflareApiEnvelope<Result>,
      };
    } catch {
      throw new Error(
        `${operation} failed: HTTP ${String(response.status)} — non-JSON response body (an edge error page?)`,
      );
    }
  }

  // The find-first probe: the database a prior (possibly crashed) provisioning run already
  // created, recovered by its deterministic name — or undefined when absent. A non-success list
  // envelope also answers undefined: the POST that follows is the authoritative error surface.
  async function findDatabaseByName(name: string): Promise<string | undefined> {
    const listed = await callApi<readonly { name: string; uuid: string }[]>(
      "createDatabase",
      "GET",
      `${accountBase}/d1/database?name=${name}`,
    );
    return (listed.envelope.result ?? []).find((database) => database.name === name)?.uuid;
  }

  return {
    // Find-first (idempotent resume): probe by the deterministic name, create only when absent.
    // The crash window between a successful create and the firm row's claim UPDATE is real
    // (separate commits) — resume must never hinge on parsing the vendor's duplicate-error prose.
    async createDatabase(firmId: FirmId): Promise<{ databaseIdentifier: string }> {
      const name = await firmResourceName(firmId);
      const existing = await findDatabaseByName(name);
      if (existing !== undefined) return { databaseIdentifier: existing };

      const created = await callApi<{ uuid: string }>(
        "createDatabase",
        "POST",
        `${accountBase}/d1/database`,
        { name },
      );
      if (created.envelope.success && created.envelope.result !== undefined) {
        return { databaseIdentifier: created.envelope.result.uuid };
      }
      if (isAlreadyExists(created.envelope)) {
        // The probe-create race: a concurrent create landed between the probe and this POST —
        // recover the winner's UUID by name (the benign fallback isAlreadyExists now exists for).
        const raced = await findDatabaseByName(name);
        if (raced !== undefined) return { databaseIdentifier: raced };
        throw new Error(
          `createDatabase failed: "${name}" reported already-exists but the list endpoint does not return it`,
        );
      }
      throw describeFailure("createDatabase", created.status, created.envelope);
    },

    // Find-first, same shape: probe the bucket (its name IS its identifier), create only when
    // the probe misses; already-exists on the create is the same benign probe-create race.
    async createBucket(firmId: FirmId): Promise<{ bucketName: string }> {
      const name = await firmResourceName(firmId);
      const probed = await callApi<unknown>(
        "createBucket",
        "GET",
        `${accountBase}/r2/buckets/${name}`,
      );
      if (probed.envelope.success) return { bucketName: name };

      const created = await callApi<unknown>("createBucket", "POST", `${accountBase}/r2/buckets`, {
        name,
      });
      if (created.envelope.success || isAlreadyExists(created.envelope)) {
        return { bucketName: name };
      }
      throw describeFailure("createBucket", created.status, created.envelope);
    },
  };
}
