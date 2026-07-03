import { describe, expect, it } from "vitest";
import {
  allCoveredJurisdictions,
  isNationalFallbackOnly,
  nationalResources,
  wellbeingResourcesForState,
} from "../src/registry.ts";

describe("registry accessors", () => {
  it("nationalResources includes the 988 lifeline and is always present", () => {
    const national = nationalResources();
    expect(national.length).toBeGreaterThanOrEqual(3);
    expect(national.some((r) => r.phones.some((p) => p.number === "988"))).toBe(true);
  });

  it("looks up a jurisdiction by 2-digit FIPS, 2-letter code, and lowercase code", () => {
    const byFips = wellbeingResourcesForState("06");
    const byCode = wellbeingResourcesForState("CA");
    const byLower = wellbeingResourcesForState("ca");
    expect(byFips?.name).toBe("California");
    expect(byCode).toBe(byFips);
    expect(byLower).toBe(byFips);
    expect(byFips?.resources.length).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown key", () => {
    expect(wellbeingResourcesForState("99")).toBeUndefined();
    expect(wellbeingResourcesForState("ZZ")).toBeUndefined();
  });

  it("marks a no-program territory as national-fallback-only with no resources", () => {
    const pr = wellbeingResourcesForState("PR");
    expect(pr).toBeDefined();
    expect(pr && isNationalFallbackOnly(pr)).toBe(true);
    expect(pr?.resources).toHaveLength(0);
  });

  it("marks a covered state as not fallback-only", () => {
    const ca = wellbeingResourcesForState("CA");
    expect(ca && isNationalFallbackOnly(ca)).toBe(false);
  });

  it("covers 56 jurisdictions", () => {
    expect(allCoveredJurisdictions()).toHaveLength(56);
  });
});
