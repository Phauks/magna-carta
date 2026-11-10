import { describe, expect, it } from "vitest";
import { formatCitation } from "../src/format.ts";
import { CALIFORNIA_FORMAT, NEVADA_FORMAT, UNIFORM_FORMAT } from "../src/formats.ts";
import type { CitationFields } from "../src/types.ts";

const brown: CitationFields = {
  caseName: "Brown v. Board of Education",
  volume: "347",
  reporter: "U.S.",
  firstPage: "483",
  pinCite: "495",
  year: "1954",
};

describe("cases — uniform system", () => {
  it("abbreviates the case name, leaves out an implied court, and italicizes only the name", () => {
    const result = formatCitation("case", brown, UNIFORM_FORMAT, "full");
    expect(result.plainText).toBe("Brown v. Bd. of Educ., 347 U.S. 483, 495 (1954).");
    expect(result.runs[0]).toEqual({ text: "Brown v. Bd. of Educ.", italic: true });
    expect(result.missing).toEqual([]);
    expect(result.rules).toEqual(expect.arrayContaining(["R11", "T11", "R12"]));
  });

  it("gives the short and id. forms", () => {
    expect(formatCitation("case", brown, UNIFORM_FORMAT, "short").plainText).toBe(
      "Brown, 347 U.S. at 495.",
    );
    const id = formatCitation("case", brown, UNIFORM_FORMAT, "id");
    expect(id.plainText).toBe("Id. at 495.");
    expect(id.runs[0]).toEqual({ text: "Id.", italic: true });
  });

  it("uses the second party in a short form when the first is the government", () => {
    const fields = { ...brown, caseName: "United States v. Smith" };
    expect(formatCitation("case", fields, UNIFORM_FORMAT, "short").plainText).toBe(
      "Smith, 347 U.S. at 495.",
    );
  });

  it("requires the court when the reporter does not imply one", () => {
    const fields: CitationFields = {
      caseName: "Smith v. Jones",
      volume: "123",
      reporter: "F.3d",
      firstPage: "456",
      year: "1997",
    };
    expect(formatCitation("case", fields, UNIFORM_FORMAT, "full").missing).toEqual(["court"]);
    expect(
      formatCitation("case", { ...fields, court: "9th Cir." }, UNIFORM_FORMAT, "full").plainText,
    ).toBe("Smith v. Jones, 123 F.3d 456 (9th Cir. 1997).");
  });

  it("reports missing fields instead of inventing them", () => {
    const result = formatCitation(
      "case",
      { volume: "347", reporter: "U.S.", firstPage: "483" },
      UNIFORM_FORMAT,
      "full",
    );
    expect(result.missing).toEqual(["caseName", "year"]);
  });

  it("adds an explanatory parenthetical", () => {
    const fields = {
      ...brown,
      parenthetical: "holding segregated public schools unconstitutional",
    };
    expect(formatCitation("case", fields, UNIFORM_FORMAT, "full").plainText).toBe(
      "Brown v. Bd. of Educ., 347 U.S. 483, 495 (1954) (holding segregated public schools unconstitutional).",
    );
  });
});

describe("cases — Nevada unpublished dispositions (NRAP 36(c)(3))", () => {
  const disposition: CitationFields = {
    caseName: "Doe v. Roe",
    unpublished: "yes",
    docketNumber: "84512",
    databaseCitation: "2023 WL 1234567",
    court: "Nev.",
    dateDecided: "2023-03-01",
  };

  it("adds the notation and the parts the rule requires", () => {
    const result = formatCitation("case", disposition, NEVADA_FORMAT, "full");
    expect(result.plainText).toBe(
      "Doe v. Roe, No. 84512, 2023 WL 1234567 (Nev. Mar. 1, 2023) (unpublished disposition).",
    );
    expect(result.notices).toEqual([]);
  });

  it("flags a disposition from before the court's cut-off", () => {
    const result = formatCitation(
      "case",
      { ...disposition, dateDecided: "2015-06-01" },
      NEVADA_FORMAT,
      "full",
    );
    expect(result.notices).toEqual([
      expect.objectContaining({ severity: "error", rule: "NRAP 36(c)(3)" }),
    ]);
  });

  it("suggests the database citation when it is missing", () => {
    const { databaseCitation: _omitted, ...withoutDatabase } = disposition;
    const result = formatCitation("case", withoutDatabase, NEVADA_FORMAT, "full");
    expect(result.notices).toEqual([expect.objectContaining({ severity: "suggestion" })]);
  });

  it("does not add the Nevada notation under the uniform format", () => {
    expect(formatCitation("case", disposition, UNIFORM_FORMAT, "full").plainText).toBe(
      "Doe v. Roe, No. 84512, 2023 WL 1234567 (Nev. Mar. 1, 2023).",
    );
  });
});

describe("statutes and regulations", () => {
  it("formats the U.S. Code with and without a year", () => {
    expect(
      formatCitation(
        "united-states-code",
        { title: "42", section: "1983", year: "2018" },
        UNIFORM_FORMAT,
        "full",
      ).plainText,
    ).toBe("42 U.S.C. § 1983 (2018).");
    expect(
      formatCitation("united-states-code", { title: "42", section: "1983" }, UNIFORM_FORMAT, "id")
        .plainText,
    ).toBe("Id. § 1983.");
  });

  it("formats the CFR by section or by part", () => {
    expect(
      formatCitation(
        "code-of-federal-regulations",
        { title: "29", part: "1910", section: "1910.1200", year: "2024" },
        UNIFORM_FORMAT,
        "full",
      ).plainText,
    ).toBe("29 C.F.R. § 1910.1200 (2024).");
    expect(
      formatCitation(
        "code-of-federal-regulations",
        { title: "29", part: "1910" },
        UNIFORM_FORMAT,
        "full",
      ).plainText,
    ).toBe("29 C.F.R. pt. 1910.");
  });

  it("formats the Federal Register with a citation date", () => {
    expect(
      formatCitation(
        "federal-register",
        { volume: "89", page: "12345", date: "2024-03-01" },
        UNIFORM_FORMAT,
        "full",
      ).plainText,
    ).toBe("89 Fed. Reg. 12345 (Mar. 1, 2024).");
  });

  it("formats a public law with its Statutes at Large location", () => {
    const fields = {
      congress: "117",
      lawNumber: "58",
      statutesAtLargeVolume: "135",
      statutesAtLargePage: "429",
      year: "2021",
    };
    expect(formatCitation("public-law", fields, UNIFORM_FORMAT, "full").plainText).toBe(
      "Pub. L. No. 117-58, 135 Stat. 429 (2021).",
    );
  });

  it("formats Nevada statutes per format", () => {
    const fields = { section: "11.190(1)(b)", year: "2025" };
    expect(
      formatCitation("nevada-revised-statutes", fields, UNIFORM_FORMAT, "full").plainText,
    ).toBe("Nev. Rev. Stat. § 11.190(1)(b) (2025).");
    expect(formatCitation("nevada-revised-statutes", fields, NEVADA_FORMAT, "full").plainText).toBe(
      "NRS 11.190(1)(b).",
    );
  });

  it("formats California codes in the uniform system", () => {
    expect(
      formatCitation(
        "california-code",
        { californiaCode: "CCP", section: "337(a)" },
        UNIFORM_FORMAT,
        "full",
      ).plainText,
    ).toBe("Cal. Civ. Proc. Code § 337(a).");
  });
});

describe("California Style Manual", () => {
  it("puts the year after the name and wraps the citation in parentheses", () => {
    expect(formatCitation("case", brown, CALIFORNIA_FORMAT, "full").plainText).toBe(
      "(Brown v. Board of Education (1954) 347 U.S. 483, 495.)",
    );
    expect(formatCitation("case", brown, CALIFORNIA_FORMAT, "short").plainText).toBe(
      "(Brown, supra, 347 U.S. at p. 495.)",
    );
    expect(formatCitation("case", brown, CALIFORNIA_FORMAT, "id").plainText).toBe(
      "(Id. at p. 495.)",
    );
  });

  it("splits code subdivisions out", () => {
    expect(
      formatCitation(
        "california-code",
        { californiaCode: "CCP", section: "337(a)" },
        CALIFORNIA_FORMAT,
        "full",
      ).plainText,
    ).toBe("(Code Civ. Proc., § 337, subd. (a).)");
  });

  it("wraps federal statutes without the code year", () => {
    expect(
      formatCitation(
        "united-states-code",
        { title: "42", section: "1983", year: "2018" },
        CALIFORNIA_FORMAT,
        "full",
      ).plainText,
    ).toBe("(42 U.S.C. § 1983.)");
  });
});
