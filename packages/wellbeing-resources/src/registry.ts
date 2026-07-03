import { JURISDICTIONS, NATIONAL_RESOURCES } from "./data.generated.ts";
import type { JurisdictionEntry, WellbeingResource } from "./types.ts";

// The package's read surface over the generated data table. Data lives in data.generated.ts (built from
// the research corpus); this module is the stable, hand-authored API.
export { JURISDICTIONS, NATIONAL_RESOURCES };

const BY_FIPS: ReadonlyMap<string, JurisdictionEntry> = new Map(
  JURISDICTIONS.map((jurisdiction) => [jurisdiction.fips, jurisdiction]),
);
const BY_CODE: ReadonlyMap<string, JurisdictionEntry> = new Map(
  JURISDICTIONS.map((jurisdiction) => [jurisdiction.code, jurisdiction]),
);

// The national safety net (988, SAMHSA, ABA CoLAP) — returned for every jurisdiction, covered or not,
// so a lawyer anywhere gets a real answer.
export function nationalResources(): readonly WellbeingResource[] {
  return NATIONAL_RESOURCES;
}

// A jurisdiction's wellbeing entry by 2-digit FIPS or 2-letter code (case-insensitive), or undefined
// where the key is unknown (the caller falls back to nationalResources()).
export function wellbeingResourcesForState(key: string): JurisdictionEntry | undefined {
  const normalized = key.trim().toUpperCase();
  return BY_FIPS.get(normalized) ?? BY_CODE.get(normalized);
}

// Every covered jurisdiction, in FIPS order.
export function allCoveredJurisdictions(): readonly JurisdictionEntry[] {
  return JURISDICTIONS;
}

// True when the jurisdiction has no dedicated program and resolves to the national safety net.
export function isNationalFallbackOnly(entry: JurisdictionEntry): boolean {
  return entry.nationalFallbackOnly;
}
