import { describe, expect, it } from "vitest";
import { STATES, allAssessorSites, assessorSiteForJurisdiction } from "../src/registry.ts";
import { assessorUrl } from "../src/resolve.ts";

describe("assessor-site registry", () => {
  it("resolves a custom-template county by jurisdiction id (Washoe = 32031)", () => {
    const site = assessorSiteForJurisdiction("32031");
    expect(site?.name).toBe("Washoe");
    expect(site?.deepLink.kind).toBe("template");
  });

  it("resolves a platform county by jurisdiction id (Nye = 32023 on DevNet Wedge)", () => {
    const site = assessorSiteForJurisdiction("32023");
    expect(site?.name).toBe("Nye");
    expect(site?.deepLink).toMatchObject({ kind: "platform", platform: "devnetWedge" });
  });

  it("returns undefined for a jurisdiction not in the registry", () => {
    expect(assessorSiteForJurisdiction("48201")).toBeUndefined(); // Harris County, TX — not covered
  });

  it("covers all 17 Nevada county-equivalents", () => {
    const nevada = allAssessorSites().filter((site) => site.state === "NV");
    expect(nevada).toHaveLength(17);
  });

  it("end-to-end: resolves a county by jurisdiction id then builds its deep-link", () => {
    const site = assessorSiteForJurisdiction("32023");
    expect(site && assessorUrl(site, { apn: "00123456", year: 2026 })).toBe(
      "https://nyenv-assessor.devnetwedge.com/parcel/view/00123456/2026",
    );
  });
});

describe("registry data integrity", () => {
  const sites = allAssessorSites();

  it("keys every site by a unique FIPS id (5-digit county or 10-digit municipal subdivision)", () => {
    const ids = sites.map((site) => site.jurisdictionId);
    for (const id of ids) {
      // A 5-digit county FIPS, or a 10-digit county-subdivision (MCD) GEOID for the town-assessed
      // New England states — both share the leading 2-digit state FIPS.
      expect(id).toMatch(/^\d{5}(\d{5})?$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every site an http(s) search URL and a 2-letter state matching its FIPS prefix", () => {
    const statePrefix = Object.fromEntries(STATES.map((state) => [state.code, state.fipsPrefix]));
    for (const site of sites) {
      // https preferred, but a few county sites are genuinely http-only (broken or absent certs).
      expect(site.searchUrl).toMatch(/^https?:\/\//);
      expect(site.state).toMatch(/^[A-Z]{2}$/);
      expect(site.jurisdictionId.slice(0, 2)).toBe(statePrefix[site.state]);
    }
  });

  it("tags every site with a jurisdiction type", () => {
    for (const site of sites) {
      expect(["county", "municipality", "district"]).toContain(site.jurisdictionType);
    }
  });

  it("gives every platform site a non-empty host", () => {
    for (const site of sites) {
      if (site.deepLink.kind === "platform") {
        expect(site.deepLink.host.length).toBeGreaterThan(0);
      }
    }
  });

  it("registers each state once, with a unique code and FIPS prefix", () => {
    const codes = STATES.map((state) => state.code);
    const prefixes = STATES.map((state) => state.fipsPrefix);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("keeps the STATES table sorted by FIPS prefix", () => {
    const prefixes = STATES.map((state) => state.fipsPrefix);
    expect(prefixes).toEqual([...prefixes].sort());
  });

  it("every site belongs to a registered state", () => {
    const codes = new Set(STATES.map((state) => state.code));
    for (const site of sites) {
      expect(codes.has(site.state)).toBe(true);
    }
  });
});
