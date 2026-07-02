import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { assertIdentifier, identifierPattern, isIdentifier } from "../src/validate.ts";
import type { MatterId } from "../src/types.ts";

describe("isIdentifier", () => {
  it("accepts a freshly minted id of the matching type", () => {
    expect(isIdentifier(newIdentifier("matter"), "matter")).toBe(true);
  });

  it("rejects a handle of the wrong entity type", () => {
    expect(isIdentifier(newIdentifier("document"), "matter")).toBe(false);
  });

  it("rejects malformed handles", () => {
    expect(isIdentifier("matter_tooshort", "matter")).toBe(false);
    expect(isIdentifier("matter_V1StGXR8Z5jdHiopq2Cf!", "matter")).toBe(false); // 22 chars / bad char
    expect(isIdentifier("matterV1StGXR8Z5jdHiopq2Cf", "matter")).toBe(false); // no separator
    expect(isIdentifier("", "matter")).toBe(false);
    expect(isIdentifier("matter_", "matter")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isIdentifier(undefined, "matter")).toBe(false);
    expect(isIdentifier(123, "matter")).toBe(false);
    expect(isIdentifier(null, "matter")).toBe(false);
  });

  it("narrows the type for the compiler", () => {
    const value: unknown = newIdentifier("matter");
    if (isIdentifier(value, "matter")) {
      const matterId: MatterId = value; // must compile — narrowed to MatterId
      expect(matterId).toMatch(/^matter_/);
    }
  });
});

describe("identifierPattern", () => {
  it("returns the per-type pattern that matches freshly minted handles", () => {
    expect(identifierPattern("error").test(newIdentifier("error"))).toBe(true);
    expect(identifierPattern("matter").test(newIdentifier("matter"))).toBe(true);
  });

  it("rejects handles of the wrong entity type and malformed handles", () => {
    expect(identifierPattern("error").test(newIdentifier("matter"))).toBe(false);
    expect(identifierPattern("error").test("error_tooshort")).toBe(false);
  });
});

describe("assertIdentifier", () => {
  it("returns the branded id when valid", () => {
    const raw: unknown = newIdentifier("matter");
    const matterId: MatterId = assertIdentifier(raw, "matter"); // narrows + returns
    expect(matterId).toMatch(/^matter_/);
  });

  it("throws on an invalid or wrong-type handle", () => {
    expect(() => assertIdentifier("document_V1StGXR8Z5jdHiopq2Cf", "matter")).toThrow(/matter/);
    expect(() => assertIdentifier(42, "matter")).toThrow();
  });
});
