import { fetchHttpClient, type HttpClient } from "@magna-carta/integrations/http";
import {
  listAnthropicModels,
  providerRosterSnapshotSchema,
  type ProviderRosterSnapshot,
} from "@magna-carta/inference/provider-roster";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { Logger } from "@magna-carta/telemetry/logger";

// The composition root for the provider's live model list: the credential, the cache, the timeout and
// the logging that packages/inference/src/provider-roster.ts deliberately leaves out.
//
// OFF THE HOT PATH BY CACHING, NOT BY QUEUEING. The only reader is the AI settings screen, which an
// administrator opens rarely, so one provider call per cache lifetime per data centre is the whole
// cost. A list that answered is kept for six hours (the provider ships models on a scale of weeks), and
// a failure for five minutes, so an outage costs one slow read per five minutes rather than one per page
// view. The call itself is bounded by a short timeout: a settings page must render the curated roster
// promptly whatever the provider is doing.
//
// The Workers Cache API rather than a KV namespace, because the snapshot is platform-wide, small, and
// harmless to recompute per data centre — and that keeps this feature free of a new binding.
//
// ABSENT CREDENTIAL IS A SUPPORTED STATE, not a fault: without ANTHROPIC_MODELS_API_KEY the screen
// shows the curated roster alone and says the live check is not configured. Nothing here can make a
// model selectable, so no misconfiguration of this module can widen what a firm may choose.

const LIVE_TTL_SECONDS = 6 * 60 * 60;
const FAILURE_TTL_SECONDS = 5 * 60;
const PROVIDER_TIMEOUT_MILLISECONDS = 3000;
// A synthetic, never-fetched URL that names the cache slot. Versioned so a change to the snapshot's
// shape is a new slot rather than a parse failure on an old one.
const CACHE_KEY_URL = "https://provider-roster.magna-carta.internal/anthropic/v1";

const NOT_CONFIGURED: ProviderRosterSnapshot = {
  status: "not-configured",
  checkedAt: null,
  models: [],
};

export interface ProviderRosterSourceInput {
  readonly apiKey: string | undefined;
  readonly logger?: Logger;
  readonly correlationId?: string;
  readonly now?: () => string;
  // Test seams. Production uses global fetch and the default cache.
  readonly http?: HttpClient;
  readonly cache?: Cache | null;
}

function timedHttpClient(): HttpClient {
  const timedFetch = ((url: RequestInfo | URL, init?: RequestInit) =>
    fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MILLISECONDS),
    })) as typeof fetch;
  return fetchHttpClient(timedFetch);
}

function defaultCache(): Cache | null {
  return typeof caches === "undefined" ? null : caches.default;
}

async function readCached(cache: Cache | null): Promise<ProviderRosterSnapshot | undefined> {
  if (cache === null) return undefined;
  try {
    const hit = await cache.match(CACHE_KEY_URL);
    if (hit === undefined) return undefined;
    const parsed = providerRosterSnapshotSchema.safeParse(await hit.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    // A cache that cannot be read is a miss, never a failure of the page.
    return undefined;
  }
}

async function writeCached(cache: Cache | null, snapshot: ProviderRosterSnapshot): Promise<void> {
  if (cache === null) return;
  const ttl = snapshot.status === "live" ? LIVE_TTL_SECONDS : FAILURE_TTL_SECONDS;
  try {
    await cache.put(
      CACHE_KEY_URL,
      new Response(JSON.stringify(snapshot), {
        headers: { "content-type": "application/json", "cache-control": `max-age=${String(ttl)}` },
      }),
    );
  } catch {
    // Not caching costs one extra provider call next time; it is not worth failing the page over.
  }
}

// The provider's live roster, cached. Total: every path resolves to a snapshot.
export async function readProviderRoster(
  input: ProviderRosterSourceInput,
): Promise<ProviderRosterSnapshot> {
  const apiKey = input.apiKey?.trim();
  if (apiKey === undefined || apiKey === "") return NOT_CONFIGURED;
  const cache = input.cache === undefined ? defaultCache() : input.cache;
  const cached = await readCached(cache);
  if (cached !== undefined) return cached;

  const now = input.now ?? (() => new Date().toISOString());
  const outcome = await listAnthropicModels({ http: input.http ?? timedHttpClient(), apiKey });
  const snapshot: ProviderRosterSnapshot =
    outcome.kind === "ok"
      ? { status: "live", checkedAt: now(), models: outcome.models }
      : { status: "unreachable", checkedAt: now(), models: [] };
  if (outcome.kind === "failed" && input.logger !== undefined) {
    // The reason is a status code or a parse verdict, never a response body or the credential.
    logOperationFailed(
      input.logger,
      "inference:provider-roster",
      new Error(`provider model list unavailable (${outcome.reason})`),
      input.correlationId,
    );
  }
  await writeCached(cache, snapshot);
  return snapshot;
}
