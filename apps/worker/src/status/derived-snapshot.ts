// The cron-owned status:derived snapshot: probes the cheap, always-warm core primitives (never
// boots a container just to check it — see COMPONENT_REGISTRY's core-probe/engine split), polls
// the upstream provider feeds, derives every component's status, and writes the result to
// STATUS_KV. The read path (the merge with status:authored) lives at
// @magna-carta/status — this module is the one writer of status:derived.
import {
  type DerivedSnapshot,
  deriveComponents,
  emptyDerived,
  pollProviders,
  type ProbeOutcome,
  SCHEMA_VERSION,
  STATUS_KV_KEYS,
} from "@magna-carta/status";
import type { Bindings } from "../app.ts";

// Probe only the cheap, always-warm core primitives; never boot a container to check it.
async function probeCore(env: Bindings): Promise<Record<string, ProbeOutcome>> {
  const probes: Record<string, ProbeOutcome> = {};
  probes["api"] = { ok: true }; // reached only if this worker is running
  probes["control-plane-database"] = {
    ok: await tryOk(() => env.DB_CONTROL.prepare("SELECT 1").first()),
  };
  // Reachability, not presence, is the signal: a HEAD on a missing key still proves the bucket is
  // reachable. Verified empirically under Miniflare (apps/worker/test/derived-snapshot.test.ts) —
  // env.R2.head on an absent key RESOLVES to null rather than throwing, so tryOk's plain try/await
  // already treats "resolved null" as ok:true with no special-casing needed.
  probes["object-storage"] = { ok: await tryOk(() => env.R2.head("__status_probe__")) };
  probes["status-store"] = { ok: await tryOk(() => env.STATUS_KV.get("__status_probe__")) };
  return probes;
}

async function tryOk(op: () => Promise<unknown>): Promise<boolean> {
  try {
    await op();
    return true;
  } catch {
    return false;
  }
}

export async function buildAndStoreDerivedSnapshot(
  env: Bindings,
  now: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DerivedSnapshot> {
  const probes = await probeCore(env);
  const providers = await pollProviders(fetchImpl, now);
  const components = deriveComponents({
    now,
    probes,
    signals: {}, // telemetry-derived engine health is a conservative v1: no signal => operational
    degradedThreshold: 0.1,
    outageThreshold: 1,
  });
  const snapshot: DerivedSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now,
    components,
    providers,
  };
  // Guard against a partial build clobbering a good snapshot with nothing: deriveComponents always
  // maps the full COMPONENT_REGISTRY (never partial — a probe failure is a status value, not a
  // thrown error), so an empty components array can only mean the registry itself is empty; in that
  // case write the explicit empty doc rather than a snapshot claiming zero known components.
  const safe = components.length > 0 ? snapshot : emptyDerived(now);
  await env.STATUS_KV.put(STATUS_KV_KEYS.derived, JSON.stringify(safe));
  return safe;
}
