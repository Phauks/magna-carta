import type { FirmId } from "@magna-carta/identifiers/types";

// The provisioning port (slice 0·4 design spec §5): how the firm provisioner obtains a firm's
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
    // locally the bucket name only marks the provisioning step complete.
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

// ADR-0075 naming: magna-carta-<environment>-<scope>[-<purpose-or-slug>]. The slug must be
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

// Already-exists IS success for idempotent resume (slice 0·4 plan, Task 12): a crashed
// provisioning re-invokes createDatabase/createBucket for a resource the first run already
// created. Detection is by message ("already exists" / "already own") plus R2's documented
// 10004 code — the Cloudflare error catalog carries no stable cross-product duplicate code.
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
// one (slice 0·4 design spec §5); this adapter only guarantees the resource exists and is
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
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<{ status: number; envelope: CloudflareApiEnvelope<Result> }> {
    const response = await fetchImplementation(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = (await response.json()) as CloudflareApiEnvelope<Result>;
    return { status: response.status, envelope };
  }

  return {
    async createDatabase(firmId: FirmId): Promise<{ databaseIdentifier: string }> {
      const name = await firmResourceName(firmId);
      const created = await callApi<{ uuid: string }>("POST", `${accountBase}/d1/database`, {
        name,
      });
      if (created.envelope.success && created.envelope.result !== undefined) {
        return { databaseIdentifier: created.envelope.result.uuid };
      }
      if (isAlreadyExists(created.envelope)) {
        // Idempotent resume: the database exists from a prior run — recover its UUID by name.
        const listed = await callApi<readonly { name: string; uuid: string }[]>(
          "GET",
          `${accountBase}/d1/database?name=${name}`,
        );
        const existing = (listed.envelope.result ?? []).find((database) => database.name === name);
        if (existing !== undefined) return { databaseIdentifier: existing.uuid };
        throw new Error(
          `createDatabase failed: "${name}" reported already-exists but the list endpoint does not return it`,
        );
      }
      throw describeFailure("createDatabase", created.status, created.envelope);
    },

    async createBucket(firmId: FirmId): Promise<{ bucketName: string }> {
      const name = await firmResourceName(firmId);
      const created = await callApi<unknown>("POST", `${accountBase}/r2/buckets`, { name });
      // The bucket's name IS its identifier — already-exists needs no recovery lookup.
      if (created.envelope.success || isAlreadyExists(created.envelope)) {
        return { bucketName: name };
      }
      throw describeFailure("createBucket", created.status, created.envelope);
    },
  };
}
