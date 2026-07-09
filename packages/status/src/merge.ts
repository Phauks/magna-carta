import type {
  AuthoredSnapshot,
  ComponentOverride,
  DerivedSnapshot,
  PublishedSnapshot,
  ServiceEvent,
  StatusHistory,
  UpstreamAdvisory,
} from "./schema.ts";
import { HISTORY_WINDOW_DAYS, SCHEMA_VERSION } from "./schema.ts";
import { summarizeHistory } from "./history.ts";
import { type ComponentStatus, impactAsStatus, worstStatus } from "./vocabulary.ts";

export interface MergeOptions {
  audience: "public" | "internal";
  now: string;
  stalenessThresholdMs: number;
}

// The one resolution of "what is this component's status right now", shared by the merge (which
// paints the component row) and the cron's history append (which paints the day's uptime tick), so
// a row and the bar beneath it can never disagree.
//
// An operator who declares an event against a component without also setting an override would
// otherwise leave that component's row and its uptime bar green while the page's own banner
// announced an outage — the exact false greenness this page exists to avoid. So a declared event's
// impact is an input alongside the probe and the override, and the worst of them wins.
export function effectiveComponentStatus(
  derivedStatus: ComponentStatus,
  override: ComponentOverride | undefined,
  activeEventsAffecting: readonly ServiceEvent[],
): ComponentStatus {
  return worstStatus([
    derivedStatus,
    ...(override === undefined ? [] : [override.status]),
    ...activeEventsAffecting.map((event) => impactAsStatus(event.impact)),
  ]);
}

export function activeEvents(authored: AuthoredSnapshot): ServiceEvent[] {
  return authored.events.filter((event) => event.lifecycle !== "resolved");
}

// Every component's effective status, by component id — the input to both the published rows and the
// cron's history sample.
export function effectiveComponentStatuses(
  derived: DerivedSnapshot,
  authored: AuthoredSnapshot,
): Record<string, ComponentStatus> {
  const overrideByComponent = new Map(authored.overrides.map((o) => [o.componentId, o]));
  const live = activeEvents(authored);
  const statuses: Record<string, ComponentStatus> = {};
  for (const component of derived.components) {
    statuses[component.id] = effectiveComponentStatus(
      component.status,
      overrideByComponent.get(component.id),
      live.filter((event) => event.affectedComponentIds.includes(component.id)),
    );
  }
  return statuses;
}

// Providers report on THEMSELVES. A provider in trouble raises an advisory the page shows plainly and
// separately; it never enters the verdict. status_unavailable — their feed is unreachable — is honest
// uncertainty about them and raises nothing at all.
function upstreamAdvisoryFor(derived: DerivedSnapshot): UpstreamAdvisory | null {
  const troubled = derived.providers.filter(
    (provider) => provider.status !== "operational" && provider.status !== "status_unavailable",
  );
  if (troubled.length === 0) return null;
  const worst = worstStatus(troubled.map((provider) => provider.status as ComponentStatus));
  return { providers: troubled, worst };
}

export function mergeSnapshot(
  derived: DerivedSnapshot,
  authored: AuthoredSnapshot,
  history: StatusHistory,
  opts: MergeOptions,
): PublishedSnapshot {
  const overrideByComponent = new Map(authored.overrides.map((o) => [o.componentId, o]));
  const statuses = effectiveComponentStatuses(derived, authored);

  const components = derived.components.map((component) => {
    const override = overrideByComponent.get(component.id);
    const status = statuses[component.id] ?? component.status;
    const note = override ? override.note : component.note;
    return { id: component.id, name: component.name, group: component.group, status, note };
  });

  // Overall = the worst of OUR components and OUR active events. Upstream providers are absent by
  // design: a Cloudflare incident is not a Magna Carta outage, and if it becomes one, our own probes
  // are what will say so.
  const overall = worstStatus([
    ...components.map((c) => c.status),
    ...activeEvents(authored).map((e) => impactAsStatus(e.impact)),
  ]);

  const stripped = opts.audience === "public";
  const events = authored.events.map((event) => ({
    id: event.id,
    title: event.title,
    impact: event.impact,
    lifecycle: event.lifecycle,
    affectedComponentIds: event.affectedComponentIds,
    ...(stripped ? {} : { authorUserId: event.authorUserId }),
    startedAt: event.startedAt,
    resolvedAt: event.resolvedAt,
    updates: event.updates.map((u) => ({
      at: u.at,
      lifecycle: u.lifecycle,
      body: u.body,
      ...(stripped ? {} : { authorUserId: u.authorUserId }),
    })),
  }));

  const ageMs = Date.parse(opts.now) - Date.parse(derived.generatedAt);
  const stale = Number.isFinite(ageMs) && ageMs > opts.stalenessThresholdMs;

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: derived.generatedAt,
    overall,
    components,
    providers: derived.providers,
    upstreamAdvisory: upstreamAdvisoryFor(derived),
    events,
    history: {
      windowDays: HISTORY_WINDOW_DAYS,
      components: summarizeHistory(
        history,
        derived.components.map((component) => component.id),
        opts.now,
      ),
    },
    stale,
  };
}
