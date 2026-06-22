import type { AssessorSite } from "../types.ts";

// Site builder for a state's professional-licensing lookup portals, keyed by 2-digit state FIPS
// (licenses are issued per state). The attorney-license register is the official bar-association or
// judiciary directory where a lawyer's license status and standing are verified by name or bar
// number. Search-only — the consumer (e.g. an attorney profile listing multi-state admissions) links
// out per state. This is the one way to author a licensing-domain module.
export function licensingSites(stateFips: string, state: string) {
  return {
    attorneyLicense: (name: string, searchUrl: string): AssessorSite => ({
      jurisdictionId: stateFips,
      jurisdictionType: "state",
      category: "licensing",
      system: "attorneyLicense",
      state,
      name,
      searchUrl,
      deepLink: { kind: "searchPage" },
    }),
  };
}
