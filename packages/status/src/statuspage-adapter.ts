import type { ComponentStatus } from "./vocabulary.ts";
import type { Provider } from "./schema.ts";
import { PROVIDER_REGISTRY, type ProviderDefinition } from "./provider-registry.ts";

// Atlassian Statuspage summary.json exposes status.indicator ∈ none|minor|major|critical.
export function normalizeStatuspageIndicator(indicator: string): ComponentStatus {
  switch (indicator) {
    case "none":
      return "operational";
    case "minor":
      return "degraded";
    case "major":
      return "partial_outage";
    case "critical":
      return "major_outage";
    default:
      return "degraded";
  }
}

export async function pollStatuspageProvider(
  def: ProviderDefinition,
  fetchImpl: typeof fetch,
  now: string,
): Promise<Provider> {
  const url = def.url ?? "";
  const unavailable: Provider = {
    id: def.id,
    name: def.name,
    status: "status_unavailable",
    upstreamUrl: url,
    fetchedAt: now,
    reachable: false,
  };
  try {
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) return unavailable;
    const body = (await response.json()) as { status?: { indicator?: string } };
    const indicator = body.status?.indicator;
    if (typeof indicator !== "string") return unavailable;
    return {
      id: def.id,
      name: def.name,
      status: normalizeStatuspageIndicator(indicator),
      upstreamUrl: url,
      fetchedAt: now,
      reachable: true,
    };
  } catch {
    return unavailable;
  }
}

export async function pollProviders(fetchImpl: typeof fetch, now: string): Promise<Provider[]> {
  const statuspage = PROVIDER_REGISTRY.filter((p) => p.kind === "statuspage");
  return Promise.all(statuspage.map((def) => pollStatuspageProvider(def, fetchImpl, now)));
}
