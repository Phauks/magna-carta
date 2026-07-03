import type { AuthoredSnapshot, DerivedSnapshot, PublishedSnapshot } from "./schema.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { type ComponentStatus, impactAsStatus, worstStatus } from "./vocabulary.ts";

export interface MergeOptions {
  audience: "public" | "internal";
  now: string;
  stalenessThresholdMs: number;
}

export function mergeSnapshot(
  derived: DerivedSnapshot,
  authored: AuthoredSnapshot,
  opts: MergeOptions,
): PublishedSnapshot {
  const overrideByComponent = new Map(authored.overrides.map((o) => [o.componentId, o]));

  const components = derived.components.map((component) => {
    const override = overrideByComponent.get(component.id);
    const status = override ? override.status : component.status;
    const note = override ? override.note : component.note;
    return { id: component.id, name: component.name, group: component.group, status, note };
  });

  const activeEvents = authored.events.filter((e) => e.lifecycle !== "resolved");

  // Overall = worst of component statuses + active-event impacts. Providers that are merely
  // status_unavailable never worsen it (their feed is down, not our platform).
  const overallInputs: ComponentStatus[] = [
    ...components.map((c) => c.status),
    ...derived.providers
      .filter((p) => p.status !== "status_unavailable")
      .map((p) => p.status as ComponentStatus),
    ...activeEvents.map((e) => impactAsStatus(e.impact)),
  ];
  const overall = worstStatus(overallInputs);

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
    events,
    stale,
  };
}
