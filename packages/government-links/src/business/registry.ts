import type { AssessorSite, PortalSite } from "../types.ts";
import { SECRETARY_OF_STATE_SITES_BY_STATE } from "./secretary-of-state.ts";

// One row registers a state's Secretary-of-State portals: 2-letter code, 2-digit state FIPS, sites
// (the business-entity register, the UCC index). The national lookup derives from this; the rows come
// from the `secretary-of-state.ts` data table (one entry per state), kept sorted by FIPS.
export interface BusinessRegistration {
  readonly code: string;
  readonly fipsPrefix: string;
  readonly sites: readonly AssessorSite[];
}

export const BUSINESS_STATES: readonly BusinessRegistration[] = SECRETARY_OF_STATE_SITES_BY_STATE;

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
