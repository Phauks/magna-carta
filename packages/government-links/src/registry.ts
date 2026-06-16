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
import type { PortalSite, PortalSystem } from "./types.ts";

// The cross-domain registry root. Each domain (`property/registry.ts`, `business/registry.ts`) owns
// its own data table and accessors; this module composes them into one system-keyed lookup and
// re-exports the domain surface so a consumer has a single import for the whole engine.
export {
  STATES,
  allAssessorSites,
  assessorSiteForJurisdiction,
  BUSINESS_STATES,
  allBusinessSites,
  businessEntitySiteForState,
  uccSiteForState,
};
export type { StateRegistration };

// A portal is identified by its jurisdiction AND its system, so a state's Secretary-of-State register
// and its counties' assessors never collide (and a county can later carry an assessor + a recorder).
function systemKey(jurisdictionId: string, system: PortalSystem): string {
  return `${system}:${jurisdictionId}`;
}

// Every portal — property (assessor) and business (Secretary of State) — in one lookup.
const SITES_BY_SYSTEM: ReadonlyMap<string, PortalSite> = new Map(
  [...allAssessorSites(), ...allBusinessSites()].map((site) => [
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
