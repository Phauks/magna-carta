import { test, expect } from "vitest";
import { normalizeName } from "../src/normalize-name.js";

test("normalizes case, punctuation, diacritics, and NFC", () => {
  expect(normalizeName("O'Brien")).toBe("obrien");
  expect(normalizeName("José")).toBe("jose");
  expect(normalizeName("  Smith-Jones ")).toBe("smith jones");
});

test("apostrophe strip — O'Brien becomes a single token (U+0027)", () => {
  expect(normalizeName("O'Brien")).toBe("obrien");
});

test("hyphen becomes word boundary — Smith-Jones → smith jones", () => {
  expect(normalizeName("Smith-Jones")).toBe("smith jones");
});

test("modifier-letter apostrophe (U+02BC) strips like ASCII apostrophe", () => {
  // Word and many legal systems insert U+02BC ʼ for names like O'Brien;
  // without this strip it falls through to the punctuation→space step and
  // produces "o brien" instead of "obrien", breaking phonetic recall.
  expect(normalizeName("OʼBrien")).toBe("obrien");
});

test("is idempotent (frozen transform)", () => {
  const once = normalizeName("McDonald, Jr.");
  expect(normalizeName(once)).toBe(once);
});
