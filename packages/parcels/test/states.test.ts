import { describe, expect, it } from "vitest";
import { STATES, allAssessorSites, assessorSiteForJurisdiction } from "../src/registry.ts";
import { assessorUrl } from "../src/resolve.ts";

describe("state coverage (derived from the STATES registry — no per-state test edits)", () => {
  for (const { code, count } of STATES) {
    it(`covers all ${count} ${code} county-equivalents`, () => {
      expect(allAssessorSites().filter((site) => site.state === code)).toHaveLength(count);
    });
  }
});

describe("deep-link and fallback spot checks", () => {
  it("Maricopa County, AZ resolves to its parcel deep-link", () => {
    const site = assessorSiteForJurisdiction("04013");
    expect(site && assessorUrl(site, { apn: "21167062E" })).toBe(
      "https://mcassessor.maricopa.gov/mcs/?q=21167062E",
    );
  });

  it("a search-only county returns its search page even when given an APN", () => {
    const coconino = assessorSiteForJurisdiction("04005");
    expect(coconino && assessorUrl(coconino, { apn: "100-00-001" })).toBe(coconino?.searchUrl);
  });

  it("a Hawaii county falls back to its qPublic search page when no TMK is given", () => {
    const honolulu = assessorSiteForJurisdiction("15003");
    expect(honolulu?.searchUrl).toContain("qpublic.schneidercorp.com");
    expect(honolulu && assessorUrl(honolulu)).toBe(honolulu?.searchUrl);
  });

  it("a Hawaii county (Honolulu) deep-links to its qPublic parcel report by TMK", () => {
    const honolulu = assessorSiteForJurisdiction("15003");
    expect(honolulu && assessorUrl(honolulu, { apn: "(1) 9-4-044-078" })).toBe(
      "https://qpublic.schneidercorp.com/Application.aspx?AppID=1045&LayerID=23342&PageTypeID=4&KeyValue=940440780000",
    );
  });

  it("a Washington TaxSifter county deep-links by parcel", () => {
    const lincoln = assessorSiteForJurisdiction("53043");
    expect(lincoln && assessorUrl(lincoln, { apn: "08010-32002-000" })).toBe(
      "https://lincolnwa-taxsifter.publicaccessnow.com/Search/Results.aspx?q=0801032002000",
    );
  });

  it("a Washington PropertyAccess county is search-only (keyed on an internal id, not the APN)", () => {
    const benton = assessorSiteForJurisdiction("53005");
    expect(benton?.deepLink.kind).toBe("searchPage");
  });

  it("Salt Lake County, UT deep-links by parcel id (separators kept)", () => {
    const saltLake = assessorSiteForJurisdiction("49035");
    expect(saltLake && assessorUrl(saltLake, { apn: "16-05-100-001-0000" })).toBe(
      "https://apps.saltlakecounty.gov/assessor/new/javaapi2/parcelviewext.cfm?parcel_ID=16-05-100-001-0000&query=Y",
    );
  });

  it("Washington County, UT reuses the GSA adapter built for Nevada", () => {
    const washington = assessorSiteForJurisdiction("49053");
    expect(washington && assessorUrl(washington, { apn: "SG-1234-567" })).toBe(
      "https://washingtonco-search.gsacorp.io/parcel/SG1234567",
    );
  });

  it("a Utah Tyler Eagle county is search-only (deep-links only by internal account number)", () => {
    const boxElder = assessorSiteForJurisdiction("49003");
    expect(boxElder?.deepLink.kind).toBe("searchPage");
  });

  it("a California Megabyte MBAP county (Sonoma) deep-links by APN, dashes stripped", () => {
    const sonoma = assessorSiteForJurisdiction("06097");
    expect(sonoma && assessorUrl(sonoma, { apn: "004-011-001-000" })).toBe(
      "https://common1.mptsweb.com/mbap/sonoma/asr/AsrMain/004011001000",
    );
  });

  it("Los Angeles deep-links by AIN (stripped) on its custom portal", () => {
    const la = assessorSiteForJurisdiction("06037");
    expect(la && assessorUrl(la, { apn: "1234-567-890" })).toBe(
      "https://portal.assessor.lacounty.gov/parceldetail/1234567890",
    );
  });
});
