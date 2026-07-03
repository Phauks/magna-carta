// The component/provider status vocabulary mirrors public status pages so a status reads as
// familiar. "operational" is the resting default; a component only leaves it on positive
// evidence of a problem (an operator, a telemetry error signal, or a failed probe).
export const COMPONENT_STATUS = [
  "operational",
  "maintenance",
  "degraded",
  "partial_outage",
  "major_outage",
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUS)[number];

// A provider row can additionally be "status_unavailable" when the provider's OWN status feed is
// unreachable — an honest fetch failure about their feed, not a verdict about our components.
export const PROVIDER_STATUS = [...COMPONENT_STATUS, "status_unavailable"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUS)[number];

export const EVENT_LIFECYCLE = ["investigating", "identified", "monitoring", "resolved"] as const;
export type EventLifecycle = (typeof EVENT_LIFECYCLE)[number];

export const EVENT_IMPACT = ["minor", "major", "critical", "maintenance"] as const;
export type EventImpact = (typeof EVENT_IMPACT)[number];

// Severity ordering for the overall rollup: higher = worse. "status_unavailable" is deliberately
// absent — an unreachable provider feed must never worsen the overall rollup.
const RANK: Record<ComponentStatus, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

export function statusRank(status: ComponentStatus): number {
  return RANK[status];
}

export function worstStatus(statuses: readonly ComponentStatus[]): ComponentStatus {
  return statuses.reduce<ComponentStatus>(
    (worst, s) => (statusRank(s) > statusRank(worst) ? s : worst),
    "operational",
  );
}

// An event's impact contributes to the overall rollup via this mapping while the event is active.
export function impactAsStatus(impact: EventImpact): ComponentStatus {
  switch (impact) {
    case "minor":
      return "degraded";
    case "major":
      return "partial_outage";
    case "critical":
      return "major_outage";
    case "maintenance":
      return "maintenance";
  }
}
