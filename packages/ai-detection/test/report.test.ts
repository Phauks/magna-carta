import { describe, expect, it } from "vitest";
import { CAVEATS, LIKELIHOOD_BANDS, segmentScore } from "../src/report.ts";

describe("report model", () => {
  it("exposes the four likelihood bands including inconclusive", () => {
    expect(LIKELIHOOD_BANDS).toEqual(["unlikely", "mixed", "likely", "inconclusive"]);
  });

  it("lists the structured caveats in the exact canonical order", () => {
    expect(CAVEATS).toEqual([
      "text-too-short",
      "possible-paraphrase-or-humanization",
      "non-target-language",
      "mixed-or-edited-authorship",
      "low-vendor-confidence",
    ]);
  });

  it("builds a segment score with its band", () => {
    expect(segmentScore(0, 10, 0.9, "likely")).toEqual({
      startCharacter: 0,
      endCharacter: 10,
      score: 0.9,
      band: "likely",
    });
  });
});
