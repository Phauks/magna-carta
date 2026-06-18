import { describe, expect, it } from "vitest";
import {
  STATES,
  allGisSites,
  allRecorderSites,
  gisSiteForJurisdiction,
  recorderSiteForJurisdiction,
} from "../src/registry.ts";

describe("property systems — recorder (curated) + GIS (dormant seam)", () => {
  it("resolves Nevada recorder portals by county FIPS (Clark, Washoe, Lincoln)", () => {
    expect(recorderSiteForJurisdiction("32003")?.system).toBe("recorder");
    expect(recorderSiteForJurisdiction("32003")?.searchUrl).toContain("AcclaimWeb");
    expect(recorderSiteForJurisdiction("32031")?.searchUrl).toContain("icris.washoecounty");
    expect(recorderSiteForJurisdiction("32017")?.searchUrl).toContain("recording.lincolncountynv");
  });

  it("covers every Nevada county-equivalent with a recorder", () => {
    const nv = allRecorderSites().filter((s) => s.state === "NV");
    expect(nv).toHaveLength(17);
  });

  it("keeps GIS dormant — the accessor/aggregate exist but no state curates GIS data", () => {
    expect(allGisSites()).toHaveLength(0);
    expect(gisSiteForJurisdiction("32003")).toBeUndefined();
  });

  it("tags every recorder site as property with a 5-digit county FIPS and http(s) URL", () => {
    for (const site of allRecorderSites()) {
      expect(site.category).toBe("property");
      expect(site.system).toBe("recorder");
      expect(site.jurisdictionId).toMatch(/^\d{5}$/);
      expect(site.searchUrl).toMatch(/^https?:\/\//);
    }
  });

  it("only attaches a recorder to counties that already have an assessor", () => {
    const assessorIds = new Set(STATES.flatMap((s) => s.sites).map((s) => s.jurisdictionId));
    for (const site of allRecorderSites()) {
      expect(assessorIds.has(site.jurisdictionId)).toBe(true);
    }
  });
});
