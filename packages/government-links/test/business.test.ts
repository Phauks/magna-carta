import { describe, expect, it } from "vitest";
import {
  BUSINESS_STATES,
  allBusinessSites,
  assessorSiteForJurisdiction,
  businessEntitySiteForState,
  siteForSystem,
  uccSiteForState,
} from "../src/registry.ts";
import { portalUrl } from "../src/resolve.ts";

describe("business domain — Secretary of State portals", () => {
  it("resolves Nevada's business-entity search keyed by the 2-digit state FIPS (32)", () => {
    const site = businessEntitySiteForState("32");
    expect(site?.name).toContain("Nevada");
    expect(site?.category).toBe("business");
    expect(site?.system).toBe("businessEntity");
    expect(site?.jurisdictionType).toBe("state");
    expect(site && portalUrl(site)).toBe("https://esos.nv.gov/EntitySearch/OnlineEntitySearch");
  });

  it("resolves Nevada's UCC search as a second system on the same state jurisdiction", () => {
    const site = uccSiteForState("32");
    expect(site?.system).toBe("ucc");
    expect(site?.jurisdictionId).toBe("32");
    expect(site && portalUrl(site)).toBe("https://projectorion.nv.gov/");
  });

  it("a search-only business site returns its search page even when given a key", () => {
    const site = businessEntitySiteForState("32");
    expect(site && portalUrl(site, { key: "E0123452020-1" })).toBe(site?.searchUrl);
  });

  it("business (state 32) and property (county 32xxx) coexist in the registry without colliding", () => {
    expect(businessEntitySiteForState("32")?.jurisdictionId).toBe("32");
    expect(assessorSiteForJurisdiction("32031")?.system).toBe("assessor");
    // No assessor at the state level, no Secretary-of-State register at the county level.
    expect(siteForSystem("32", "assessor")).toBeUndefined();
    expect(siteForSystem("32031", "businessEntity")).toBeUndefined();
  });
});

describe("business coverage — all 50 states + DC", () => {
  it("registers every state plus DC, exactly once, sorted by FIPS", () => {
    expect(BUSINESS_STATES).toHaveLength(51);
    const prefixes = BUSINESS_STATES.map((state) => state.fipsPrefix);
    expect(new Set(prefixes).size).toBe(51);
    expect(prefixes).toEqual([...prefixes].sort());
  });

  it("gives every registered state a business-entity search", () => {
    for (const state of BUSINESS_STATES) {
      const site = businessEntitySiteForState(state.fipsPrefix);
      expect(site).toBeDefined();
      expect(site?.searchUrl).toMatch(/^https?:\/\//);
    }
  });

  it("tags every business site as a state-level business portal with a 2-digit FIPS id", () => {
    for (const site of allBusinessSites()) {
      expect(site.category).toBe("business");
      expect(site.jurisdictionType).toBe("state");
      expect(site.jurisdictionId).toMatch(/^\d{2}$/);
      expect(["businessEntity", "ucc"]).toContain(site.system);
      expect(site.searchUrl).toMatch(/^https?:\/\//);
      expect(site.jurisdictionId).toBe(
        BUSINESS_STATES.find((state) => state.code === site.state)?.fipsPrefix,
      );
    }
  });
});
