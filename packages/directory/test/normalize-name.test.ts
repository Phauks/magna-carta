import { test, expect } from "vitest";
import { normalizeName } from "../src/normalize-name.js";

test("normalizes case, punctuation, diacritics, and NFC", () => {
  expect(normalizeName("O'Brien")).toBe("obrien");
  expect(normalizeName("José")).toBe("jose");
  expect(normalizeName("  Smith-Jones ")).toBe("smith jones");
});

test("is idempotent (frozen transform)", () => {
  const once = normalizeName("McDonald, Jr.");
  expect(normalizeName(once)).toBe(once);
});
