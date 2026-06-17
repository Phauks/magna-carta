import { describe, expect, it } from "vitest";
import {
  STATES,
  allGisSites,
  allRecorderSites,
  gisSiteForJurisdiction,
  recorderSiteForJurisdiction,
} from "../src/registry.ts";

describe("property systems — recorder + GIS", () => {
  it("resolves Nevada recorder portals by county FIPS (Clark, Washoe)", () => {
    expect(recorderSiteForJurisdiction("32003")?.system).toBe("recorder");
    expect(recorderSiteForJurisdiction("32003")?.searchUrl).toContain("AcclaimWeb");
    expect(recorderSiteForJurisdiction("32031")?.searchUrl).toContain("icris.washoecounty");
  });

  it("resolves Nevada GIS only where it is distinct from the assessor", () => {
    expect(gisSiteForJurisdiction("32003")?.system).toBe("gis"); // Clark has a distinct GIS
    expect(gisSiteForJurisdiction("32001")).toBeUndefined(); // Churchill GIS == assessor, omitted
  });

  it("tags every recorder/GIS site as property with a 5-digit county FIPS and http(s) URL", () => {
    for (const site of [...allRecorderSites(), ...allGisSites()]) {
      expect(site.category).toBe("property");
      expect(["recorder", "gis"]).toContain(site.system);
      expect(site.jurisdictionId).toMatch(/^\d{5}$/);
      expect(site.searchUrl).toMatch(/^https?:\/\//);
    }
  });

  it("only attaches recorder/GIS to counties that already have an assessor", () => {
    const assessorIds = new Set(STATES.flatMap((s) => s.sites).map((s) => s.jurisdictionId));
    for (const site of [...allRecorderSites(), ...allGisSites()]) {
      expect(assessorIds.has(site.jurisdictionId)).toBe(true);
    }
  });
});
