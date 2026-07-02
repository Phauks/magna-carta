import { describe, expect, it } from "vitest";
import { parsePangramResponse } from "../src/adapters/pangram-response.ts";

describe("parsePangramResponse", () => {
  it("accepts a well-formed prediction and preserves optional fields", () => {
    const parsed = parsePangramResponse({
      fraction_ai: 0.92,
      fraction_ai_assisted: 0.1,
      version: "v3",
      stage: "production",
      windows: [{ start_index: 0, end_index: 40, ai_assistance_score: 0.9, confidence: 0.8 }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.fraction_ai).toBe(0.92);
    expect(parsed?.windows?.[0]?.end_index).toBe(40);
  });

  it("accepts the minimal shape (only fraction_ai)", () => {
    expect(parsePangramResponse({ fraction_ai: 0.1 })).toEqual({ fraction_ai: 0.1 });
  });

  it("returns null when fraction_ai is missing or non-numeric", () => {
    expect(parsePangramResponse({})).toBeNull();
    expect(parsePangramResponse({ fraction_ai: "0.5" })).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(parsePangramResponse(null)).toBeNull();
    expect(parsePangramResponse("nope")).toBeNull();
  });

  it("rejects a malformed window rather than dropping it", () => {
    expect(
      parsePangramResponse({ fraction_ai: 0.5, windows: [{ start_index: 0 }] }),
    ).toBeNull();
  });
});
