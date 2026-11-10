import { describe, expect, it } from "vitest";
import {
  applyReading,
  draftFromReading,
  draftValues,
  isOverridingReading,
  overrideField,
  restoreField,
} from "../src/draft.ts";
import {
  CALIFORNIA_FORMAT,
  NEVADA_FORMAT,
  UNIFORM_FORMAT,
  resolveFormat,
  type CitationFormat,
} from "../src/formats.ts";

describe("draft — typing overrides what was read", () => {
  const fromLink = draftFromReading(
    "case",
    { caseName: "Brown v. Board of Education", year: "1955" },
    "link",
  );

  it("keeps a typed value when the link is read again", () => {
    const typed = overrideField(fromLink, "year", "1954");
    const reread = applyReading(
      typed,
      { caseName: "Brown v. Board of Education", year: "1955" },
      "link",
    );
    expect(draftValues(reread).year).toBe("1954");
    expect(reread.fields.year?.source).toBe("typed");
  });

  it("lets a lookup replace a link reading but never a typed value", () => {
    const looked = applyReading(
      fromLink,
      { caseName: "Brown v. Board of Education of Topeka" },
      "lookup",
    );
    expect(looked.fields.caseName).toEqual({
      value: "Brown v. Board of Education of Topeka",
      source: "lookup",
    });
    const linkAgain = applyReading(looked, { caseName: "Brown v. Board of Education" }, "link");
    expect(linkAgain.fields.caseName?.source).toBe("lookup");
  });

  it("restores the reading when the typed value is undone", () => {
    const typed = overrideField(fromLink, "year", "1954");
    expect(isOverridingReading(typed, "year")).toBe(true);
    const undone = restoreField(typed, "year");
    expect(undone.fields.year).toEqual({ value: "1955", source: "link" });
    expect(isOverridingReading(undone, "year")).toBe(false);
  });

  it("treats a field cleared by typing as absent", () => {
    expect(draftValues(overrideField(fromLink, "year", "")).year).toBeUndefined();
  });
});

describe("resolveFormat — document, then court, then state, then firm default", () => {
  it("prefers the document's own format, reviewed or not", () => {
    const draft: CitationFormat = { ...CALIFORNIA_FORMAT, identifier: "draft", reviewed: false };
    expect(
      resolveFormat({ documentFormat: "draft", matterState: "NV" }, [
        UNIFORM_FORMAT,
        NEVADA_FORMAT,
        draft,
      ]),
    ).toBe(draft);
  });

  it("uses the matter's court before its state", () => {
    expect(resolveFormat({ matterCourt: "california-court-of-appeal", matterState: "NV" })).toBe(
      CALIFORNIA_FORMAT,
    );
  });

  it("uses the matter's state", () => {
    expect(resolveFormat({ matterState: "nv" })).toBe(NEVADA_FORMAT);
  });

  it("falls back to the firm default, then the uniform system", () => {
    expect(resolveFormat({ firmDefault: "california-state-courts" })).toBe(CALIFORNIA_FORMAT);
    expect(resolveFormat({})).toBe(UNIFORM_FORMAT);
  });

  it("never picks an unreviewed format automatically", () => {
    const unreviewed: CitationFormat = {
      ...NEVADA_FORMAT,
      identifier: "arizona",
      reviewed: false,
      states: ["AZ"],
    };
    expect(
      resolveFormat({ matterState: "AZ", firmDefault: "arizona" }, [UNIFORM_FORMAT, unreviewed]),
    ).toBe(UNIFORM_FORMAT);
  });
});
