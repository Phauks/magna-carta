import { describe, expect, it } from "vitest";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";

describe("load-profile profiles", () => {
  it("ships the ledgerVolume default with plausible-firm parameters", () => {
    expect(ledgerVolume.name).toBe("ledgerVolume");
    expect(ledgerVolume.entryCount).toBeGreaterThanOrEqual(10_000);
    expect(ledgerVolume.trustSubledgerCount).toBeGreaterThanOrEqual(100);
    expect(ledgerVolume.reversalRate).toBeGreaterThan(0);
    expect(ledgerVolume.reversalRate).toBeLessThan(0.2);
  });

  it("scales counts by the multiplier without mutating the source profile", () => {
    const smoke = scaleProfile(ledgerVolume, 0.01);
    expect(smoke.entryCount).toBe(Math.max(20, Math.round(ledgerVolume.entryCount * 0.01)));
    expect(smoke.trustSubledgerCount).toBe(
      Math.max(3, Math.round(ledgerVolume.trustSubledgerCount * 0.01)),
    );
    // Non-count parameters pass through; identity parameters are untouched.
    expect(smoke.version).toBe(ledgerVolume.version);
    expect(smoke.reversalRate).toBe(ledgerVolume.reversalRate);
    expect(ledgerVolume.entryCount).toBeGreaterThanOrEqual(10_000); // source unchanged
  });

  it("floors the scaled counts so a tiny multiplier still produces a generatable profile", () => {
    const tiny = scaleProfile(ledgerVolume, 0.000001);
    expect(tiny.entryCount).toBe(20);
    expect(tiny.trustSubledgerCount).toBe(3);
  });
});
