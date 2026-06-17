import { describe, expect, it } from "vitest";

import {
  NormalizeError,
  normalizeToDigits,
  normalizeUppercaseStrip,
  toNfc,
  withStatePrefix,
} from "../src/normalize.ts";

import goldenVectors from "./golden/normalize-vectors.json" with { type: "json" };

interface GoldenVector {
  readonly fn: "toNfc" | "normalizeToDigits" | "normalizeUppercaseStrip" | "withStatePrefix";
  readonly args: readonly string[];
  readonly expected: string;
}

const transforms = {
  toNfc: ([value]: readonly string[]) => toNfc(value ?? ""),
  normalizeToDigits: ([value]: readonly string[]) => normalizeToDigits(value ?? ""),
  normalizeUppercaseStrip: ([value]: readonly string[]) => normalizeUppercaseStrip(value ?? ""),
  withStatePrefix: ([state, value]: readonly string[]) => withStatePrefix(state ?? "", value ?? ""),
} as const;

const vectors = goldenVectors as readonly GoldenVector[];

// Composed and decomposed renderings of the same grapheme — the canonical NFC test.
const composedEAcute = "café"; // café with a single U+00E9
const decomposedEAcute = "café"; // café with U+0065 + combining acute U+0301

describe("normalization transforms", () => {
  it.each(vectors)("$fn($args) === $expected", (vector) => {
    expect(transforms[vector.fn](vector.args)).toBe(vector.expected);
  });

  describe("normalizeToDigits", () => {
    it("collapses a formatted and an unformatted SSN to the same blind-index input", () => {
      expect(normalizeToDigits("123-45-6789")).toBe(normalizeToDigits("123456789"));
      expect(normalizeToDigits("123-45-6789")).toBe("123456789");
    });

    it("strips spaces and dashes from an account number", () => {
      expect(normalizeToDigits("12 34-56")).toBe("123456");
    });

    it("throws normalize-no-digits when no digits remain", () => {
      expect(() => normalizeToDigits("abc-def")).toThrowError(NormalizeError);
      try {
        normalizeToDigits("   ");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(NormalizeError);
        expect((error as NormalizeError).code).toBe("normalize-no-digits");
      }
    });
  });

  describe("normalizeUppercaseStrip", () => {
    it("uppercases and strips spaces, dashes, and dots", () => {
      expect(normalizeUppercaseStrip(" a-b.c ")).toBe("ABC");
    });

    it("throws normalize-empty when nothing remains after stripping", () => {
      try {
        normalizeUppercaseStrip("  - . ");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(NormalizeError);
        expect((error as NormalizeError).code).toBe("normalize-empty");
      }
    });
  });

  describe("withStatePrefix — the driver's-license transform", () => {
    it("lowercase state and spaced value become the canonical state-prefixed form", () => {
      expect(withStatePrefix("nv", "d1234 567")).toBe("NV:D1234567");
    });

    it("throws normalize-empty for an empty state", () => {
      try {
        withStatePrefix("  ", "d1234567");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(NormalizeError);
        expect((error as NormalizeError).code).toBe("normalize-empty");
      }
    });

    it("throws normalize-empty for an empty value", () => {
      try {
        withStatePrefix("nv", " - . ");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(NormalizeError);
        expect((error as NormalizeError).code).toBe("normalize-empty");
      }
    });
  });

  describe("Unicode NFC", () => {
    it("composed and decomposed forms produce byte-identical toNfc output", () => {
      // The two inputs are distinct code-point sequences.
      expect(composedEAcute).not.toBe(decomposedEAcute);

      expect(toNfc(composedEAcute)).toBe(toNfc(decomposedEAcute));

      const composedBytes = new TextEncoder().encode(toNfc(composedEAcute));
      const decomposedBytes = new TextEncoder().encode(toNfc(decomposedEAcute));
      expect(composedBytes).toEqual(decomposedBytes);
    });

    it("feeds a strip transform to the same result regardless of input form", () => {
      expect(normalizeUppercaseStrip(composedEAcute)).toBe(
        normalizeUppercaseStrip(decomposedEAcute),
      );
      expect(normalizeUppercaseStrip(composedEAcute)).toBe("CAFÉ");
    });
  });
});
