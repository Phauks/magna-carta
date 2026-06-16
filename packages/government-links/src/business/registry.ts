import type { AssessorSite, PortalSite } from "../types.ts";
import { NEVADA_BUSINESS_SITES } from "./nevada.ts";

// One row registers a state's Secretary-of-State portals: 2-letter code, 2-digit state FIPS, sites
// (the business-entity register, the UCC index). Like the property STATES table, the national lookup
// derives from this — adding a state is one row plus its `business/<state>.ts` module.
export interface BusinessRegistration {
  readonly code: string;
  readonly fipsPrefix: string;
  readonly sites: readonly AssessorSite[];
}

// Kept sorted by FIPS prefix — insert a new state in numeric order, not appended.
export const BUSINESS_STATES: readonly BusinessRegistration[] = [
  { code: "NV", fipsPrefix: "32", sites: NEVADA_BUSINESS_SITES },
];

export function allBusinessSites(): readonly AssessorSite[] {
  return BUSINESS_STATES.flatMap((state) => state.sites);
}

const BUSINESS_BY_SYSTEM: ReadonlyMap<string, PortalSite> = new Map(
  allBusinessSites().map((site) => [`${site.system}:${site.jurisdictionId}`, site]),
);

// A state's Secretary-of-State business-entity register (2-digit state FIPS), or undefined where not
// yet covered.
export function businessEntitySiteForState(stateFips: string): PortalSite | undefined {
  return BUSINESS_BY_SYSTEM.get(`businessEntity:${stateFips}`);
}

// A state's UCC index (2-digit state FIPS), or undefined where not yet covered.
export function uccSiteForState(stateFips: string): PortalSite | undefined {
  return BUSINESS_BY_SYSTEM.get(`ucc:${stateFips}`);
}
