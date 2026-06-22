// packages/conversion/test/registry-wellformed.test.ts
import { describe, expect, it } from "vitest";
import { EDGES, getFormat } from "../src/registry.ts";

describe("registry well-formedness", () => {
  it("every edge references registered formats", () => {
    for (const edge of EDGES) {
      expect(getFormat(edge.from), `from ${edge.from}`).toBeDefined();
      expect(getFormat(edge.to), `to ${edge.to}`).toBeDefined();
    }
  });

  it("has no duplicate or self edges", () => {
    const keys = new Set<string>();
    for (const edge of EDGES) {
      expect(edge.from).not.toBe(edge.to);
      const key = `${edge.from}->${edge.to}`;
      expect(keys.has(key), `duplicate ${key}`).toBe(false);
      keys.add(key);
    }
  });

  it("every edge weight is a positive number", () => {
    for (const edge of EDGES) expect(edge.weight).toBeGreaterThan(0);
  });
});
