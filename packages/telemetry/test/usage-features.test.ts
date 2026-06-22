import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, isFeatureKey } from "../src/usage-features.ts";

describe("feature taxonomy", () => {
  it("has no duplicate keys", () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
  });
  it("every key is dot-separated subsystem.area", () => {
    for (const key of FEATURE_KEYS) expect(key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
  });
  it("recognizes a registered key and rejects an unknown one", () => {
    expect(isFeatureKey("matters.list")).toBe(true);
    expect(isFeatureKey("nope.nope")).toBe(false);
  });
});
