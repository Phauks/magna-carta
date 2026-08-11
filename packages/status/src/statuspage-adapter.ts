// Reads an Atlassian Statuspage `summary.json` and turns it into one Provider row.
//
// The subtlety this module exists to handle: a Statuspage's whole-page `status.indicator` is a
// rollup over EVERY component on the page, and some providers list hundreds of components that a
// consumer does not depend on. Cloudflare lists each edge location as its own component, and a
// handful of them is re-routed at any moment, so its page indicator sits at "minor" more or less
// permanently while its own page headline reads "All systems operational" and every service
// component is healthy. Consuming the page indicator therefore reports a provider as degraded on a
// day when the provider says it is fine — so when a provider definition names the component groups
// we actually depend on, the severity is computed from those instead. See provider-registry.ts.
import { type ComponentStatus, worstStatus } from "./vocabulary.ts";
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

// Per-component status ∈ operational|degraded_performance|partial_outage|major_outage|
// under_maintenance. An unrecognized value takes the pessimistic reading, the same way the
// indicator does: a vocabulary we do not know is not evidence of health.
export function normalizeStatuspageComponentStatus(status: string): ComponentStatus {
  switch (status) {
    case "operational":
      return "operational";
    case "under_maintenance":
      return "maintenance";
    case "degraded_performance":
      return "degraded";
    case "partial_outage":
      return "partial_outage";
    case "major_outage":
      return "major_outage";
    default:
      return "degraded";
  }
}

// Incident impact ∈ none|minor|major|critical. Only UNRESOLVED incidents appear in summary.json, so
// every incident this sees is live.
function normalizeIncidentImpact(impact: string): ComponentStatus {
  return impact === "none" ? "operational" : normalizeStatuspageIndicator(impact);
}

// The subset of the Statuspage payload this adapter reads. Everything is optional: the feed is a
// third party's, and a shape change must degrade to a coarser answer rather than throw.
interface StatuspageComponent {
  id?: string;
  name?: string;
  status?: string;
  group?: boolean;
  group_id?: string | null;
}
interface StatuspageIncident {
  impact?: string;
  components?: readonly { id?: string }[];
}
export interface StatuspageSummary {
  status?: { indicator?: string };
  components?: readonly StatuspageComponent[];
  incidents?: readonly StatuspageIncident[];
}

// The component ids inside the named top-level groups, plus the group rows themselves (a group
// carries its own rolled-up status, which is the cheapest read of "is anything under here unwell").
function componentIdsInScope(
  components: readonly StatuspageComponent[],
  groupNames: readonly string[],
): Set<string> {
  const wanted = new Set(groupNames);
  const groupIds = new Set(
    components
      .filter((component) => component.group === true && wanted.has(component.name ?? ""))
      .map((component) => component.id ?? ""),
  );
  groupIds.delete("");
  const inScope = new Set<string>(groupIds);
  for (const component of components) {
    const parent = component.group_id;
    if (typeof parent === "string" && groupIds.has(parent) && component.id !== undefined) {
      inScope.add(component.id);
    }
  }
  return inScope;
}

// An incident with no component list is page-wide and always counts; one that names components
// counts only when it touches something in scope.
function incidentIsInScope(incident: StatuspageIncident, inScope: ReadonlySet<string>): boolean {
  const named = incident.components ?? [];
  if (named.length === 0) return true;
  return named.some((component) => component.id !== undefined && inScope.has(component.id));
}

/**
 * The provider's severity, as this platform should read it. Returns null when the payload carries
 * no usable severity at all, which the caller reports as an unreachable feed rather than a guess.
 */
export function statuspageSeverity(
  body: StatuspageSummary,
  serviceComponentGroups: readonly string[] | undefined,
): ComponentStatus | null {
  const indicator = body.status?.indicator;
  const pageSeverity =
    typeof indicator === "string" ? normalizeStatuspageIndicator(indicator) : null;

  if (serviceComponentGroups === undefined || serviceComponentGroups.length === 0) {
    return pageSeverity;
  }

  const components = body.components ?? [];
  const inScope = componentIdsInScope(components, serviceComponentGroups);
  // The scope named groups that are not on the page any more (a rename on their side, a typo on
  // ours). Reporting "operational" from a scope that matched nothing would be inventing a green out
  // of a configuration error, so fall back to the whole-page reading.
  if (inScope.size === 0) return pageSeverity;

  const componentSeverities = components
    .filter((component) => component.id !== undefined && inScope.has(component.id))
    .map((component) => normalizeStatuspageComponentStatus(component.status ?? ""));
  const incidentSeverities = (body.incidents ?? [])
    .filter((incident) => incidentIsInScope(incident, inScope))
    .map((incident) => normalizeIncidentImpact(incident.impact ?? "none"));

  return worstStatus([...componentSeverities, ...incidentSeverities]);
}

export async function pollStatuspageProvider(
  def: ProviderDefinition,
  fetchImpl: typeof fetch,
  now: string,
): Promise<Provider> {
  const feedUrl = def.feedUrl ?? "";
  const base = {
    id: def.id,
    name: def.name,
    upstreamUrl: feedUrl,
    ...(def.statusPageUrl === undefined ? {} : { statusPageUrl: def.statusPageUrl }),
    fetchedAt: now,
  };
  const unavailable: Provider = { ...base, status: "status_unavailable", reachable: false };
  try {
    const response = await fetchImpl(feedUrl, { method: "GET" });
    if (!response.ok) return unavailable;
    const body = (await response.json()) as StatuspageSummary;
    const severity = statuspageSeverity(body, def.serviceComponentGroups);
    if (severity === null) return unavailable;
    return { ...base, status: severity, reachable: true };
  } catch {
    return unavailable;
  }
}

export async function pollProviders(fetchImpl: typeof fetch, now: string): Promise<Provider[]> {
  const statuspage = PROVIDER_REGISTRY.filter((p) => p.kind === "statuspage");
  return Promise.all(statuspage.map((def) => pollStatuspageProvider(def, fetchImpl, now)));
}
