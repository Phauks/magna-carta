import type { AssessorSite, PortalSite } from "../types.ts";
import { ATTORNEY_LICENSE_SITES_BY_STATE } from "./attorney-license.ts";

// One row registers a state's professional-licensing lookup portals: 2-letter code, 2-digit state
// FIPS, sites. The national lookup derives from this; the rows come from the `attorney-license.ts`
// data table (one entry per state), kept sorted by FIPS.
export interface LicensingRegistration {
  readonly code: string;
  readonly fipsPrefix: string;
  /** The state's own name, for a consumer that has to let somebody choose one. */
  readonly name: string;
  readonly sites: readonly AssessorSite[];
}

export const LICENSING_STATES: readonly LicensingRegistration[] = ATTORNEY_LICENSE_SITES_BY_STATE;

export function allLicensingSites(): readonly AssessorSite[] {
  return LICENSING_STATES.flatMap((state) => state.sites);
}

const LICENSING_BY_SYSTEM: ReadonlyMap<string, PortalSite> = new Map(
  allLicensingSites().map((site) => [`${site.system}:${site.jurisdictionId}`, site]),
);

// A state's attorney-license lookup (the bar / judiciary directory), keyed by 2-digit state FIPS, or
// undefined where not yet covered.
export function attorneyLicenseSiteForState(stateFips: string): PortalSite | undefined {
  return LICENSING_BY_SYSTEM.get(`attorneyLicense:${stateFips}`);
}
