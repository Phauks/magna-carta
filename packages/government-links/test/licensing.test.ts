import { describe, expect, it } from "vitest";
import {
  LICENSING_STATES,
  allLicensingSites,
  attorneyLicenseSiteForState,
  businessEntitySiteForState,
  siteForSystem,
} from "../src/registry.ts";
import { portalUrl } from "../src/resolve.ts";

describe("licensing domain — attorney-license lookup", () => {
  it("resolves a state's attorney-license search keyed by the 2-digit state FIPS (CA = 06)", () => {
    const site = attorneyLicenseSiteForState("06");
    expect(site?.name).toContain("California");
    expect(site?.category).toBe("licensing");
    expect(site?.system).toBe("attorneyLicense");
    expect(site?.jurisdictionType).toBe("state");
    expect(site && portalUrl(site)).toBe(
      "https://apps.calbar.ca.gov/attorney/LicenseeSearch/QuickSearch",
    );
  });

  it("a search-only attorney-license site returns its search page even when given a key", () => {
    const site = attorneyLicenseSiteForState("06");
    expect(site && portalUrl(site, { key: "123456" })).toBe(site?.searchUrl);
  });

  it("coexists with business + property on the same state without colliding", () => {
    // Nevada the state has an attorney directory and a SoS register; both keyed at FIPS 32.
    expect(attorneyLicenseSiteForState("32")?.system).toBe("attorneyLicense");
    expect(businessEntitySiteForState("32")?.system).toBe("businessEntity");
    expect(siteForSystem("32", "attorneyLicense")).toBeDefined();
    // No attorney-license register at the county level.
    expect(siteForSystem("32031", "attorneyLicense")).toBeUndefined();
  });
});

describe("licensing coverage — all 50 states + DC", () => {
  it("registers every state plus DC, exactly once, sorted by FIPS", () => {
    expect(LICENSING_STATES).toHaveLength(51);
    const prefixes = LICENSING_STATES.map((state) => state.fipsPrefix);
    expect(new Set(prefixes).size).toBe(51);
    expect(prefixes).toEqual([...prefixes].sort());
  });

  it("gives every registered state an attorney-license lookup with an http(s) URL", () => {
    for (const state of LICENSING_STATES) {
      const site = attorneyLicenseSiteForState(state.fipsPrefix);
      expect(site).toBeDefined();
      expect(site?.searchUrl).toMatch(/^https?:\/\//);
    }
  });

  it("tags every licensing site as a state-level attorney portal with a 2-digit FIPS id", () => {
    for (const site of allLicensingSites()) {
      expect(site.category).toBe("licensing");
      expect(site.system).toBe("attorneyLicense");
      expect(site.jurisdictionType).toBe("state");
      expect(site.jurisdictionId).toMatch(/^\d{2}$/);
      expect(site.jurisdictionId).toBe(
        LICENSING_STATES.find((state) => state.code === site.state)?.fipsPrefix,
      );
    }
  });
});
