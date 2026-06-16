import { describe, expect, it } from "vitest";
import {
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
