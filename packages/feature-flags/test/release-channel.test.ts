import { describe, expect, it } from "vitest";
import { isReleaseChannel } from "../src/index.ts";

describe("isReleaseChannel", () => {
  it("returns true for each known channel", () => {
    expect(isReleaseChannel("stable")).toBe(true);
    expect(isReleaseChannel("beta")).toBe(true);
    expect(isReleaseChannel("alpha")).toBe(true);
  });

  it("returns false for an unknown string", () => {
    expect(isReleaseChannel("gamma")).toBe(false);
  });
});
