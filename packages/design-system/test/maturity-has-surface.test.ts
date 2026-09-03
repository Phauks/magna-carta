/*
 * `soon` is the one stage meaning "no surface exists yet"; every other stage is reachable and
 * wears its badge. Asserted over EVERY member of MaturityStage, so a stage added later cannot
 * be silently unclassified — the guard that keeps a working alpha tool from rendering inert.
 */
import { describe, expect, it } from "vitest";
import {
  MATURITY_PRESENTATION,
  hasSurface,
  type MaturityStage,
} from "../src/lib/components/maturity/maturity.ts";

const ALL_STAGES = Object.keys(MATURITY_PRESENTATION) as MaturityStage[];

describe("hasSurface", () => {
  it("is false only for soon", () => {
    expect(hasSurface("soon")).toBe(false);
  });

  it("is true for every stage that has a surface", () => {
    expect(hasSurface("alpha")).toBe(true);
    expect(hasSurface("beta")).toBe(true);
    expect(hasSurface("ready")).toBe(true);
  });

  it("classifies every stage in the model", () => {
    expect(ALL_STAGES.length).toBeGreaterThan(0);
    for (const stage of ALL_STAGES) {
      expect(typeof hasSurface(stage)).toBe("boolean");
    }
    // Exactly one stage means "not built yet".
    expect(ALL_STAGES.filter((stage) => !hasSurface(stage))).toEqual(["soon"]);
  });
});
