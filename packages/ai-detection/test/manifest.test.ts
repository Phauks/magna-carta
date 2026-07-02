import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { describe, expect, it } from "vitest";
import { AI_DETECTION_CATEGORY, aiDetectionManifest } from "../src/manifest.ts";

describe("ai-detection manifest", () => {
  it("declares the ai-detection category", () => {
    expect(AI_DETECTION_CATEGORY).toBe("ai-detection");
    expect(aiDetectionManifest.category).toBe("ai-detection");
  });

  it("is well-formed", () => {
    expect(isWellFormedManifest(aiDetectionManifest)).toEqual([]);
  });

  it("is off by default — external detection is opt-in", () => {
    expect(aiDetectionManifest.defaultEnablement).toBe("off");
  });
});
