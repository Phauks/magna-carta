import { describe, expect, it } from "vitest";
import { recognize } from "../src/recognize.ts";

describe("recognize — links", () => {
  it("reads a CourtListener opinion link and asks CourtListener for the rest", () => {
    const result = recognize(
      "https://www.courtlistener.com/opinion/105221/brown-v-board-of-education/",
    );
    expect(result).toEqual({
      kind: "case",
      source: "courtlistener",
      fields: { caseName: "Brown v. Board of Education" },
      lookup: { provider: "courtlistener", identifier: "105221" },
    });
  });

  it("names a Westlaw or Lexis link without guessing its kind", () => {
    expect(recognize("https://1.next.westlaw.com/Document/I123/View/FullText.html")).toMatchObject({
      kind: null,
      source: "westlaw",
      lookup: { provider: "westlaw" },
    });
    expect(recognize("https://advance.lexis.com/document/?pdmfid=1")).toMatchObject({
      kind: null,
      source: "lexis",
    });
  });

  it("reads govinfo link-service addresses whole", () => {
    expect(recognize("https://www.govinfo.gov/link/uscode/42/1983?link-type=html")).toMatchObject({
      kind: "united-states-code",
      fields: { title: "42", section: "1983" },
      lookup: null,
    });
    expect(
      recognize("https://www.govinfo.gov/link/cfr/29/1910?sectionnum=1200&year=mostrecent"),
    ).toMatchObject({
      kind: "code-of-federal-regulations",
      fields: { title: "29", part: "1910", section: "1910.1200" },
    });
    expect(recognize("https://www.govinfo.gov/link/fr/89/12345")).toMatchObject({
      kind: "federal-register",
      fields: { volume: "89", page: "12345" },
    });
    expect(recognize("https://www.govinfo.gov/link/plaw/117/public/58")).toMatchObject({
      kind: "public-law",
      fields: { congress: "117", lawNumber: "58" },
    });
  });

  it("reads Cornell LII and eCFR addresses", () => {
    expect(recognize("https://www.law.cornell.edu/uscode/text/42/1983")).toMatchObject({
      kind: "united-states-code",
      source: "cornell-legal-information-institute",
      fields: { title: "42", section: "1983" },
    });
    expect(recognize("https://www.law.cornell.edu/cfr/text/29/1910.1200")).toMatchObject({
      fields: { title: "29", part: "1910", section: "1910.1200" },
    });
    expect(recognize("https://www.ecfr.gov/current/title-29/section-1910.1200")).toMatchObject({
      kind: "code-of-federal-regulations",
      fields: { title: "29", part: "1910", section: "1910.1200" },
    });
  });

  it("reads a Nevada Revised Statutes section anchor", () => {
    expect(recognize("https://www.leg.state.nv.us/NRS/NRS-011.html#NRS011Sec190")).toMatchObject({
      kind: "nevada-revised-statutes",
      fields: { section: "11.190" },
    });
  });

  it("reads a California Legislative Information section link", () => {
    expect(
      recognize(
        "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=337.&lawCode=CCP",
      ),
    ).toMatchObject({ kind: "california-code", fields: { californiaCode: "CCP", section: "337" } });
  });

  it("returns null for a link it cannot read", () => {
    expect(recognize("https://example.com/some/page")).toBeNull();
  });
});

describe("recognize — rough citation text", () => {
  it("reads a bare case citation and asks for the rest", () => {
    expect(recognize("347 us 483")).toEqual({
      kind: "case",
      source: "citation-text",
      fields: { volume: "347", reporter: "U.S.", firstPage: "483" },
      lookup: { provider: "courtlistener", identifier: "347 U.S. 483" },
    });
  });

  it("reads a full case citation with name, pin cite, court and year", () => {
    expect(recognize("Smith v. Jones, 123 F.3d 456, 460 (9th Cir. 1997)")?.fields).toEqual({
      caseName: "Smith v. Jones",
      volume: "123",
      reporter: "F.3d",
      firstPage: "456",
      pinCite: "460",
      court: "9th Cir.",
      year: "1997",
    });
  });

  it("reads multi-word reporters however they are spaced", () => {
    expect(recognize("10 f supp 2d 20")?.fields.reporter).toBe("F. Supp. 2d");
    expect(recognize("1 cal app 4th 2")?.fields.reporter).toBe("Cal. App. 4th");
  });

  it("does not read an unknown reporter as a case", () => {
    expect(recognize("12 Main St 4")).toBeNull();
  });

  it("reads statutes, regulations and session laws", () => {
    expect(recognize("42 usc 1983")?.fields).toEqual({ title: "42", section: "1983" });
    expect(recognize("42 U.S.C. § 2000e-2(a)")?.fields).toEqual({
      title: "42",
      section: "2000e-2(a)",
    });
    expect(recognize("29 CFR 1910.1200")?.fields).toEqual({
      title: "29",
      part: "1910",
      section: "1910.1200",
    });
    expect(recognize("89 Fed. Reg. 12,345")?.fields).toEqual({ volume: "89", page: "12345" });
    expect(recognize("Pub. L. No. 117-58, 135 Stat. 429")?.fields).toEqual({
      congress: "117",
      lawNumber: "58",
      statutesAtLargeVolume: "135",
      statutesAtLargePage: "429",
    });
  });

  it("reads Nevada and California code citations", () => {
    expect(recognize("NRS 11.190(1)(b)")).toMatchObject({
      kind: "nevada-revised-statutes",
      fields: { section: "11.190(1)(b)" },
    });
    expect(recognize("Nev. Rev. Stat. § 11.190")?.fields).toEqual({ section: "11.190" });
    expect(recognize("Code Civ. Proc., § 337(a)")).toMatchObject({
      kind: "california-code",
      fields: { californiaCode: "CCP", section: "337(a)" },
    });
    expect(recognize("Cal. Civ. Code § 1714")?.fields).toEqual({
      californiaCode: "CIV",
      section: "1714",
    });
  });

  it("returns null for empty or unrecognized text", () => {
    expect(recognize("   ")).toBeNull();
    expect(recognize("the quick brown fox")).toBeNull();
  });
});
