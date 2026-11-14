import { describe, expect, it } from "vitest";
import { captionFor, labelFor, ordinalFor, runningPartFor } from "../src/label.ts";
import type { ExhibitScheme } from "../src/scheme.ts";

const letters: ExhibitScheme = {
  noun: "Exhibit",
  prefix: "",
  sequence: "upperLetter",
  startAt: 1,
  overflowForm: "doubled",
};

function first(count: number, scheme: ExhibitScheme): string[] {
  return Array.from({ length: count }, (_, index) => labelFor(index + 1, scheme));
}

describe("labelFor", () => {
  it("writes upper letters A to Z, then doubles them", () => {
    const labels = first(60, letters);
    expect(labels.slice(0, 26).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(labels.slice(25, 30)).toEqual(["Z", "AA", "BB", "CC", "DD"]);
    expect(labels[51]).toBe("ZZ");
    expect(labels[52]).toBe("AAA");
    expect(labels[59]).toBe("HHH");
  });

  it("counts like spreadsheet columns in the bijective form", () => {
    const scheme: ExhibitScheme = { ...letters, overflowForm: "bijective" };
    const labels = first(60, scheme);
    expect(labels.slice(25, 30)).toEqual(["Z", "AA", "AB", "AC", "AD"]);
    expect(labels[51]).toBe("AZ");
    expect(labels[52]).toBe("BA");
    expect(runningPartFor(702, scheme)).toBe("ZZ");
    expect(runningPartFor(703, scheme)).toBe("AAA");
  });

  it("writes lower letters with the same overflow", () => {
    const scheme: ExhibitScheme = { ...letters, sequence: "lowerLetter" };
    const labels = first(60, scheme);
    expect(labels.slice(0, 3)).toEqual(["a", "b", "c"]);
    expect(labels[26]).toBe("aa");
    expect(labels.every((label) => label === label.toLowerCase())).toBe(true);
  });

  it("writes arabic numbers and starts where the scheme says", () => {
    const scheme: ExhibitScheme = { ...letters, sequence: "arabic" };
    expect(first(60, scheme)).toEqual(Array.from({ length: 60 }, (_, index) => String(index + 1)));
    const defendant: ExhibitScheme = { ...scheme, startAt: 500 };
    expect(first(3, defendant)).toEqual(["500", "501", "502"]);
    expect(ordinalFor(3, defendant)).toBe(502);
  });

  it("starts a letter run past A", () => {
    expect(first(3, { ...letters, startAt: 4 })).toEqual(["D", "E", "F"]);
  });

  it("writes roman numerals at the subtractive boundaries and the ceiling", () => {
    const scheme: ExhibitScheme = { ...letters, sequence: "upperRoman" };
    const at = (ordinal: number): string => runningPartFor(ordinal, scheme);
    expect(at(4)).toBe("IV");
    expect(at(9)).toBe("IX");
    expect(at(14)).toBe("XIV");
    expect(at(40)).toBe("XL");
    expect(at(90)).toBe("XC");
    expect(at(400)).toBe("CD");
    expect(at(900)).toBe("CM");
    expect(at(3999)).toBe("MMMCMXCIX");
    expect(() => at(4000)).toThrow(RangeError);
    expect(first(60, scheme).slice(0, 5)).toEqual(["I", "II", "III", "IV", "V"]);
    expect(runningPartFor(14, { ...scheme, sequence: "lowerRoman" })).toBe("xiv");
  });

  it("puts the prefix before the running part and the noun before the label", () => {
    const scheme: ExhibitScheme = { ...letters, sequence: "arabic", prefix: "P-" };
    expect(labelFor(12, scheme)).toBe("P-12");
    expect(captionFor(labelFor(12, scheme), scheme)).toBe("Exhibit P-12");
    expect(captionFor("C", { noun: "" })).toBe("C");
  });

  it("refuses a position that is not a whole number from 1", () => {
    expect(() => labelFor(0, letters)).toThrow(RangeError);
    expect(() => labelFor(1.5, letters)).toThrow(RangeError);
  });

  it("never gives two positions in one scheme the same label", () => {
    for (const sequence of ["upperLetter", "lowerLetter", "arabic", "upperRoman"] as const) {
      for (const overflowForm of ["doubled", "bijective"] as const) {
        const scheme: ExhibitScheme = { ...letters, sequence, overflowForm };
        const labels = first(1500, scheme);
        expect(new Set(labels).size).toBe(labels.length);
      }
    }
  });
});
