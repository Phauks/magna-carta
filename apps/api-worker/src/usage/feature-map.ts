import { type FeatureKey, isFeatureKey } from "@magna-carta/telemetry/usage-features";

// route TEMPLATE -> feature. Many routes may map to one feature; a route absent here emits no
// reached event (it is not a measured surface, or it is covered by the client beacon). Keep keys as
// the Hono routePath template, never a concrete path.
export const ROUTE_FEATURE: Readonly<Record<string, FeatureKey>> = {
  "/api/v1/matters": "matters.list",
  "/api/v1/matters/:id": "matters.detail",
  "/api/v1/locations": "locations.manage",
  "/api/v1/files": "files.manager",
  "/api/v1/firm-usage": "tools.firmUsage",
};

// outbox topic -> feature (the authoritative completion signal). firm-level; an unmapped topic emits
// no completed event.
export const TOPIC_FEATURE: Readonly<Record<string, FeatureKey>> = {
  "matter.closed": "matters.detail",
  "matter.held": "matters.detail",
  "matter.released": "matters.detail",
  "file.version_committed": "files.upload",
  "ledger.entry.posted": "ledger.posting",
  "location.created": "locations.manage",
  "incident.created": "incidents.report",
};

export function routeFeature(routePath: string): FeatureKey | null {
  const feature = ROUTE_FEATURE[routePath];
  return feature !== undefined && isFeatureKey(feature) ? feature : null;
}

export function topicFeature(topic: string): FeatureKey | null {
  const feature = TOPIC_FEATURE[topic];
  return feature !== undefined && isFeatureKey(feature) ? feature : null;
}
