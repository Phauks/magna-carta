import { assessorSiteForJurisdiction } from "@magna-carta/government-links/property";
import { assessorUrl } from "@magna-carta/government-links/resolve";
import { describe, expect, it } from "vitest";
import { countyAssessorProvider } from "../src/providers/county-assessor.ts";

describe("countyAssessorProvider", () => {
  it("declares its id and label", () => {
    expect(countyAssessorProvider.id).toBe("countyAssessor");
    expect(countyAssessorProvider.label).toBe("County Assessor");
  });

  it("returns null without a jurisdictionId (an address alone can't pick a county portal)", () => {
    expect(
      countyAssessorProvider.build({ street: "123 Main St", city: "Reno", region: "NV" }),
    ).toBeNull();
  });

  it("returns null for a jurisdiction the registry does not cover", () => {
    expect(countyAssessorProvider.build({ jurisdictionId: "99999" })).toBeNull();
  });

  it("links to the covered jurisdiction's assessor search when only the jurisdiction is known", () => {
    // Allen County, Kansas (20001) — a search-only portal.
    const site = assessorSiteForJurisdiction("20001");
    expect(site).toBeDefined();
    expect(countyAssessorProvider.build({ jurisdictionId: "20001" })).toBe(assessorUrl(site!));
  });

  it("deep-links to the parcel when an apn is supplied for a deep-link-capable jurisdiction", () => {
    // Cowley County, Kansas (20035) — Beacon, deep-links by parcel key.
    const site = assessorSiteForJurisdiction("20035");
    const withApn = countyAssessorProvider.build({ jurisdictionId: "20035", apn: "R12345" });
    const withoutApn = countyAssessorProvider.build({ jurisdictionId: "20035" });
    expect(withApn).toBe(assessorUrl(site!, { apn: "R12345" }));
    expect(withApn).not.toBe(withoutApn);
    expect(withApn).toContain("KeyValue=");
  });
});
