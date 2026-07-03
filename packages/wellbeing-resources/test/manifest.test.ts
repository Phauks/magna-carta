import { describe, expect, it } from "vitest";
import { coverageManifest } from "../src/manifest.ts";

describe("coverageManifest", () => {
  it("summarizes the shipped data with no drift", () => {
    const m = coverageManifest();
    expect(m.jurisdictions).toBe(56);
    expect(m.nationalFallbackOnly).toBe(3); // PR, AS, MP — no dedicated program
    expect(m.covered).toBe(53);
    expect(m.nationalResources).toBe(3);
    expect(m.totalResources).toBe(78); // 3 national + 75 real jurisdiction resources
    expect(m.newestVerifiedOn).toBe("2026-07-02");
    expect(m.oldestVerifiedOn).toBe("2026-07-02");
  });
});
