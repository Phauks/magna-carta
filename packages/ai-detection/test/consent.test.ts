import { describe, expect, it } from "vitest";
import { defaultDetectionPolicy } from "../src/consent.ts";

describe("detection consent policy", () => {
  it("is off by default — external detection requires explicit opt-in", () => {
    expect(defaultDetectionPolicy()).toEqual({
      externalDetectionEnabled: false,
      consentScope: "engagement",
    });
  });
});
