import { describe, expect, it } from "vitest";
import { CAVEATS, LIKELIHOOD_BANDS, segmentScore } from "../src/report.ts";

describe("report model", () => {
  it("exposes the four likelihood bands including inconclusive", () => {
    expect(LIKELIHOOD_BANDS).toEqual(["unlikely", "mixed", "likely", "inconclusive"]);
  });

  it("lists the structured caveats", () => {
    expect(CAVEATS).toContain("text-too-short");
    expect(CAVEATS).toContain("possible-paraphrase-or-humanization");
    expect(CAVEATS).toContain("non-target-language");
    expect(CAVEATS).toContain("mixed-or-edited-authorship");
    expect(CAVEATS).toContain("low-vendor-confidence");
  });

  it("builds a segment score with its band", () => {
    expect(segmentScore(0, 10, 0.9, "likely")).toEqual({
      startChar: 0,
      endChar: 10,
      score: 0.9,
      band: "likely",
    });
  });
});
