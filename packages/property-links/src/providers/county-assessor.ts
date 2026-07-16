import { assessorSiteForJurisdiction } from "@magna-carta/government-links/property";
import { assessorUrl } from "@magna-carta/government-links/resolve";
import type { LinkProvider } from "../types.ts";

// The official county assessor property search, via @magna-carta/government-links. Given a
// jurisdictionId (5-digit county FIPS, or a 10-digit county-subdivision GEOID for the New-England
// town-assessed states) it returns the best link the jurisdiction supports: a parcel deep-link when
// an apn is in hand and the portal exposes a public key in its URL, otherwise the search page. Unlike
// the address-keyed providers, this one needs a jurisdictionId — which an address alone can't supply —
// so it returns null until the caller has resolved the address to a county; the registry then omits it.
export const countyAssessorProvider: LinkProvider = {
  id: "countyAssessor",
  label: "County Assessor",
  build(reference) {
    if (reference.jurisdictionId === undefined) return null;
    const site = assessorSiteForJurisdiction(reference.jurisdictionId);
    if (site === undefined) return null;
    return assessorUrl(site, { apn: reference.apn });
  },
};
