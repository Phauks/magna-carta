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

  // Two value types are never rendered as text and therefore have no format at all: a `list`, which a
  // repeating block walks rather than writes, and an `image`, which REPLACES its placeholder with a
  // drawing. Both are carved out explicitly rather than by loosening the rule, so a scalar entry that
  // lost its default format still fails here.
  const UNRENDERED: readonly string[] = new Set(["list", "image"]);
  const RENDERED = DICTIONARY.filter((entry) => !UNRENDERED.has(entry.valueType));

  it("every entry that a document renders declares a default format its own value type supports", () => {
    for (const entry of RENDERED) {
      expect(
        isLegalFormat(entry, entry.defaultFormat),
        `${entry.key} defaults to "${entry.defaultFormat}", which ${entry.valueType} does not support`,
      ).toBe(true);
    }
  });

  it("every rendered value type has at least one legal format; a list and an image have none", () => {
    for (const entry of RENDERED) {
      expect(legalFormatsFor(entry.valueType).length, entry.valueType).toBeGreaterThan(0);
    }
    expect(legalFormatsFor("list")).toEqual([]);
    // An empty row is what makes `{{location.letterheadLogo:upper}}` a registration failure rather than
    // a format name that is quietly ignored.
    expect(legalFormatsFor("image")).toEqual([]);
  });

  it("every list entry declares the fields one of its items carries", () => {
    for (const entry of DICTIONARY.filter((candidate) => candidate.valueType === "list")) {
      expect(entry.itemFields?.length, entry.key).toBeGreaterThan(0);
      for (const field of entry.itemFields ?? []) {
        expect(field.valueType, `${entry.key}.${field.name}`).not.toBe("list");
        expect(field.description.length, `${entry.key}.${field.name}`).toBeGreaterThan(10);
      }
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

  it("every protected entry routes to the decrypt-permission-plus-audit source, and nothing else does", () => {
    // `sensitivity: protected` is not a label — it is the routing decision, and the ONE source that
    // honours it resolves through the protected-field chokepoint's permission gate and audited decrypt
    // (protected-bindings.ts). An entry marked protected under any other source would be an unguarded
    // route to an encrypted column, and an unmarked entry under this one would be a decrypt nobody
    // declared. The two sets are asserted equal so neither mistake can be made alone.
    expect(
      DICTIONARY.filter((entry) => entry.sensitivity === "protected")
        .map((entry) => entry.key)
        .sort(),
    ).toEqual(
      DICTIONARY.filter((entry) => entry.source === "protectedIdentifier")
        .map((entry) => entry.key)
        .sort(),
    );
    expect(
      DICTIONARY.filter((entry) => entry.source === "protectedIdentifier").length,
    ).toBeGreaterThan(0);
  });

  it("looks a key up by name and misses a key it does not have", () => {
    expect(lookupDictionaryEntry("matter.number")?.source).toBe("matter");
    expect(lookupDictionaryEntry("matter.numbre")).toBeUndefined();
  });
});
