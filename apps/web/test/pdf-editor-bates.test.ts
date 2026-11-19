import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATES,
  batesCopyName,
  batesFont,
  batesLabel,
  batesProblems,
  batesRange,
} from "../src/lib/pdf-editor/bates.ts";

describe("Bates labels", () => {
  it("writes the prefix, the zero-padded number and the suffix", () => {
    expect(batesLabel({ prefix: "SMITH-", suffix: "-C", digits: 6 }, 41)).toBe("SMITH-000041-C");
    expect(batesLabel({ prefix: "", suffix: "", digits: 2 }, 1234)).toBe("1234");
  });

  it("gives the first and last labels and the number the next production starts at", () => {
    const settings = { ...DEFAULT_BATES, prefix: "ABC", startNumber: 100, digits: 4 };
    expect(batesRange(settings, 16)).toEqual({ first: "ABC0100", last: "ABC0115", next: 116 });
  });

  it("asks the engine for a bold standard font", () => {
    expect(batesFont("sans")).toBe("helvetica-bold");
    expect(batesFont("serif")).toBe("times-bold");
    expect(batesFont("mono")).toBe("courier-bold");
  });
});

describe("checking the settings before the engine is asked", () => {
  it("accepts the defaults", () => {
    expect(batesProblems(DEFAULT_BATES)).toEqual({});
  });

  it("refuses characters the standard fonts cannot print, naming the field", () => {
    // A letter from another script is outside the engine's font encoding.
    const problems = batesProblems({ ...DEFAULT_BATES, prefix: "Ж-", suffix: "-中" });
    expect(Object.keys(problems).toSorted()).toEqual(["prefix", "suffix"]);
    // Latin-1 letters and the word processor's dashes and quotes are inside it.
    expect(batesProblems({ ...DEFAULT_BATES, prefix: "Müller—", suffix: "“C”" })).toEqual({});
  });

  it("refuses numbers out of range", () => {
    const problems = batesProblems({ ...DEFAULT_BATES, startNumber: -1, digits: 0, sizePt: 40 });
    expect(Object.keys(problems).toSorted()).toEqual(["digits", "sizePt", "startNumber"]);
  });
});

describe("naming the numbered copy", () => {
  it("names the range, and keeps file-name characters safe", () => {
    expect(batesCopyName("Production.pdf", "SMITH-000001", "SMITH-000016")).toBe(
      "Production (SMITH-000001 to SMITH-000016).pdf",
    );
    expect(batesCopyName("One.pdf", "A/1", "A/1")).toBe("One (A-1).pdf");
  });
});
