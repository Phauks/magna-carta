import { expect, test } from "vitest";
import { assignTier, describeEvidence } from "../src/evidence.ts";
import type { MatchEvidence } from "../src/types.ts";

const none: MatchEvidence = {
  identifierTypes: [],
  exactNormalizedName: false,
  phoneticMatch: false,
  trigramMatch: false,
};

test("an exact identifier match is tier 1", () => {
  expect(assignTier({ ...none, identifierTypes: ["ssn"] })).toBe(1);
});

test("an exact normalized name is tier 2", () => {
  expect(assignTier({ ...none, exactNormalizedName: true })).toBe(2);
});

test("a phonetic match is tier 3", () => {
  expect(assignTier({ ...none, phoneticMatch: true })).toBe(3);
});

test("trigram overlap alone is tier 4", () => {
  expect(assignTier({ ...none, trigramMatch: true })).toBe(4);
});

test("the strongest evidence wins when several channels agree", () => {
  expect(
    assignTier({
      identifierTypes: ["ein"],
      exactNormalizedName: true,
      phoneticMatch: true,
      trigramMatch: true,
    }),
  ).toBe(1);
});

test("evidence with no signal is tier 4 — a surfaced candidate is never dropped", () => {
  expect(assignTier(none)).toBe(4);
});

test("the explanation lists every channel that matched", () => {
  const description = describeEvidence({
    identifierTypes: ["ssn"],
    exactNormalizedName: false,
    phoneticMatch: true,
    trigramMatch: true,
  });
  expect(description).toEqual([
    "exact identifier match: ssn",
    "phonetic code match",
    "trigram overlap",
  ]);
});
