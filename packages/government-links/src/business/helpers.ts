import type { AssessorSite, PortalSystem } from "../types.ts";

// Site builders for a state's Secretary-of-State portals. The jurisdiction is the state itself, keyed
// by its 2-digit state FIPS, so these sit beside that state's counties' property portals in the one
// registry without colliding (the registry keys on system + jurisdiction). Both registers are
// search-only today — neither exposes a public deep-link by entity name. This is the one way to
// author a business-domain module.
export function businessSites(stateFips: string, state: string) {
  const make = (system: PortalSystem, name: string, searchUrl: string): AssessorSite => ({
    jurisdictionId: stateFips,
    jurisdictionType: "state",
    category: "business",
    system,
    state,
    name,
    searchUrl,
    deepLink: { kind: "searchPage" },
  });
  return {
    entitySearch: (name: string, searchUrl: string): AssessorSite =>
      make("businessEntity", name, searchUrl),
    uccSearch: (name: string, searchUrl: string): AssessorSite => make("ucc", name, searchUrl),
  };
}
