import { JURISDICTIONS, NATIONAL_RESOURCES } from "./data.generated.ts";

// A coverage snapshot derived from the shipped data at call time, so it can never drift from the data
// table (unlike a hand-maintained manifest).
export interface CoverageManifest {
  readonly jurisdictions: number; // total covered jurisdictions (states + DC + territories)
  readonly covered: number; // with at least one dedicated resource
  readonly nationalFallbackOnly: number; // no program → resolves to the national safety net
  readonly nationalResources: number;
  readonly totalResources: number; // national + all jurisdiction resources
  readonly newestVerifiedOn: string;
  readonly oldestVerifiedOn: string;
}

export function coverageManifest(): CoverageManifest {
  const verifiedDates = [
    ...NATIONAL_RESOURCES.map((r) => r.verifiedOn),
    ...JURISDICTIONS.flatMap((j) => j.resources.map((r) => r.verifiedOn)),
  ].sort();
  const jurisdictionResourceCount = JURISDICTIONS.reduce((n, j) => n + j.resources.length, 0);
  return {
    jurisdictions: JURISDICTIONS.length,
    covered: JURISDICTIONS.filter((j) => !j.nationalFallbackOnly).length,
    nationalFallbackOnly: JURISDICTIONS.filter((j) => j.nationalFallbackOnly).length,
    nationalResources: NATIONAL_RESOURCES.length,
    totalResources: NATIONAL_RESOURCES.length + jurisdictionResourceCount,
    newestVerifiedOn: verifiedDates[verifiedDates.length - 1] ?? "",
    oldestVerifiedOn: verifiedDates[0] ?? "",
  };
}
