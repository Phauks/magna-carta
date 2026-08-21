/*
 * The library types its scores as Record<string, ExperienceScore>, so the set of use-cases is the
 * library's to change. A key we do not recognize must still render under its own name rather than
 * vanish from the panel.
 */
import { describe, expect, it } from "vitest";
import { useCaseLabel } from "../src/lib/tools/speed-test/quality-labels.ts";

describe("useCaseLabel", () => {
  it("labels the use-cases the engine reports today", () => {
    expect(useCaseLabel("streaming")).toBe("Video streaming");
    expect(useCaseLabel("gaming")).toBe("Online gaming");
    expect(useCaseLabel("rtc")).toBe("Video calls");
  });

  it("falls back to the raw key for a use-case it does not know", () => {
    expect(useCaseLabel("teleportation")).toBe("teleportation");
  });
});
