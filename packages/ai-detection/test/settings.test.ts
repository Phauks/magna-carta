import { describe, expect, it } from "vitest";
import { externalDetectionEnabledDefinition } from "../src/settings.ts";

describe("externalDetectionEnabledDefinition", () => {
  it("keys aiDetection.externalDetectionEnabled and defaults to false", () => {
    expect(externalDetectionEnabledDefinition.key).toBe("aiDetection.externalDetectionEnabled");
    expect(externalDetectionEnabledDefinition.defaultValue).toBe(false);
  });

  it("validates booleans through its schema", () => {
    expect(externalDetectionEnabledDefinition.schema.safeParse(true).success).toBe(true);
    expect(externalDetectionEnabledDefinition.schema.safeParse("yes").success).toBe(false);
  });
});
