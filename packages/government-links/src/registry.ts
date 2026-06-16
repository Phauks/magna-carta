import {
  STATES,
  allAssessorSites,
  assessorSiteForJurisdiction,
  type StateRegistration,
} from "./property/registry.ts";
import {
  BUSINESS_STATES,
  allBusinessSites,
  businessEntitySiteForState,
  uccSiteForState,
} from "./business/registry.ts";
import {
  LICENSING_STATES,
  allLicensingSites,
  attorneyLicenseSiteForState,
} from "./licensing/registry.ts";
import type { PortalSite, PortalSystem } from "./types.ts";

// The cross-domain registry root. Each domain (`property/`, `business/`, `licensing/`) owns its own
// data table and accessors; this module composes them into one system-keyed lookup and re-exports the
// domain surface so a consumer has a single import for the whole engine.
export {
  STATES,
  allAssessorSites,
  assessorSiteForJurisdiction,
  BUSINESS_STATES,
  allBusinessSites,
  businessEntitySiteForState,
  uccSiteForState,
  LICENSING_STATES,
  allLicensingSites,
  attorneyLicenseSiteForState,
};
export type { StateRegistration };

// A portal is identified by its jurisdiction AND its system, so a state's Secretary-of-State register,
// its attorney-license directory, and its counties' assessors never collide (and a county can later
// carry an assessor + a recorder).
function systemKey(jurisdictionId: string, system: PortalSystem): string {
  return `${system}:${jurisdictionId}`;
}

// Every portal — property (assessor), business (Secretary of State), licensing (attorney) — in one
// lookup.
const SITES_BY_SYSTEM: ReadonlyMap<string, PortalSite> = new Map(
  [...allAssessorSites(), ...allBusinessSites(), ...allLicensingSites()].map((site) => [
    systemKey(site.jurisdictionId, site.system),
    site,
  ]),
);

// The portal for a jurisdiction + system, or undefined where not yet covered (the consumer falls
// back to a plain web search). Coverage is exactly the keys of this map.
export function siteForSystem(
  jurisdictionId: string,
  system: PortalSystem,
): PortalSite | undefined {
  return SITES_BY_SYSTEM.get(systemKey(jurisdictionId, system));
}
