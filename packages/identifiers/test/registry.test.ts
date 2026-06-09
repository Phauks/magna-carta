import { describe, expect, it } from "vitest";
import { ENTITY_PREFIXES, prefixFor } from "../src/registry.ts";

describe("prefix registry", () => {
  it("maps the known entity types to their prefixes", () => {
    expect(prefixFor("matter")).toBe("mat");
    expect(prefixFor("document")).toBe("doc");
    expect(prefixFor("firm")).toBe("firm");
    expect(prefixFor("idempotencyRecord")).toBe("idr");
  });

  it("has no duplicate prefixes (prefix space partitions the id space)", () => {
    const prefixes = Object.values(ENTITY_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("every prefix is lowercase letters only (no digits, no underscore)", () => {
    for (const prefix of Object.values(ENTITY_PREFIXES)) {
      expect(prefix).toMatch(/^[a-z]+$/);
    }
  });
});
