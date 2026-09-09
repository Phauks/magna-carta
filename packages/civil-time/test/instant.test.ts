import { describe, expect, it } from "vitest";
import { CANONICAL_INSTANT_PATTERN, canonicalInstant, isCanonicalInstant } from "../src/instant.ts";

describe("the stored-instant shape", () => {
  it("accepts exactly what toISOString emits", () => {
    expect(isCanonicalInstant("2026-09-08T12:00:00.000Z")).toBe(true);
    expect(isCanonicalInstant(new Date().toISOString())).toBe(true);
  });

  it("refuses the shapes that are the same moment but sort differently as text", () => {
    // The federated chronology sorts these as strings. Every one of these is a real ISO-8601
    // instant and none of them belongs in a sort key beside the canonical form.
    for (const value of [
      "2026-09-08T12:00:00Z",
      "2026-09-08T12:00:00.00Z",
      "2026-09-08T12:00:00.000000Z",
      "2026-09-08T12:00:00+00:00",
      "2026-09-08T05:00:00.000-07:00",
      "2026-09-08",
    ]) {
      expect(isCanonicalInstant(value), value).toBe(false);
    }
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 0, new Date()]) {
      expect(isCanonicalInstant(value), String(value)).toBe(false);
    }
  });

  it("stamps a row in the shape it validates", () => {
    expect(CANONICAL_INSTANT_PATTERN.test(canonicalInstant(Date.UTC(2026, 8, 8)))).toBe(true);
    expect(canonicalInstant(Date.UTC(2026, 8, 8))).toBe("2026-09-08T00:00:00.000Z");
  });
});
