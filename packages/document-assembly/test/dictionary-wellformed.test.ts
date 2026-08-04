import { describe, expect, it } from "vitest";
import { DICTIONARY, isLegalFormat, lookupDictionaryEntry } from "../src/dictionary.ts";
import { legalFormatsFor } from "../src/format.ts";

// A fitness function over the dictionary itself. The dictionary is a declaration, so the way it breaks
// is a row that is internally inconsistent — a default format its own value type does not support, a
// duplicate key that shadows another, an absence behaviour nobody declared — and none of those are
// visible from any single feature test.

describe("dictionary well-formedness (fitness)", () => {
  it("is not empty (guards the enumeration itself)", () => {
    expect(DICTIONARY.length).toBeGreaterThanOrEqual(10);
  });

  it("every key is unique", () => {
    const keys = DICTIONARY.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every key is a dotted, lower-camel token a paralegal can type", () => {
    for (const entry of DICTIONARY) {
      expect(entry.key, entry.key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });

  it("every entry declares a default format its own value type supports", () => {
    for (const entry of DICTIONARY) {
      expect(
        isLegalFormat(entry, entry.defaultFormat),
        `${entry.key} defaults to "${entry.defaultFormat}", which ${entry.valueType} does not support`,
      ).toBe(true);
    }
  });

  it("every value type has at least one legal format", () => {
    for (const entry of DICTIONARY) {
      expect(legalFormatsFor(entry.valueType).length, entry.valueType).toBeGreaterThan(0);
    }
  });

  it("every entry declares a source, a sensitivity, and an absence behaviour", () => {
    for (const entry of DICTIONARY) {
      expect(entry.source, entry.key).toBeTruthy();
      expect(["ordinary", "protected"], entry.key).toContain(entry.sensitivity);
      expect(["blank", "placeholder", "fail"], entry.key).toContain(entry.absence);
    }
  });

  it("every entry carries a description the field inspector can show", () => {
    for (const entry of DICTIONARY) {
      expect(entry.description.length, entry.key).toBeGreaterThan(10);
    }
  });

  it("no slice-1 entry binds a protected value, so no assembly can reach a decrypt path yet", () => {
    // Protected binding is designed for and gated on the decrypt-permission-plus-audit path; until that
    // arm is built, a `protected` entry here would be an unguarded route to an encrypted column.
    expect(DICTIONARY.filter((entry) => entry.sensitivity === "protected")).toEqual([]);
  });

  it("looks a key up by name and misses a key it does not have", () => {
    expect(lookupDictionaryEntry("matter.number")?.source).toBe("matter");
    expect(lookupDictionaryEntry("matter.numbre")).toBeUndefined();
  });
});
