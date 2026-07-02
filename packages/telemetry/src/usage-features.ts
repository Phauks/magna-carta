// The product-usage feature taxonomy: one stable key per feature surface we measure adoption of.
// String literals only — this module takes no domain dependency. Adding a key here is how a new
// feature becomes measurable; the route->feature and topic->feature maps (in the worker) and the
// beacon request schema all resolve against this list, and a fitness test rejects any drift.
export const FEATURE_KEYS = [
  "matters.list",
  "matters.detail",
  "locations.manage",
  "files.manager",
  "files.upload",
  "billing.invoice",
  "ledger.posting",
  "tools.firmUsage",
  "tools.speedTest",
  "incidents.report",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

const featureKeySet: ReadonlySet<string> = new Set(FEATURE_KEYS);

export function isFeatureKey(value: string): value is FeatureKey {
  return featureKeySet.has(value);
}
