import { describe, it, expect } from "vitest";
import { dollarsPerBillionCandidates, rankByValue, upsertProfile, type RigProfile } from "../src/profiles.ts";

const rig = (gpuName: string, dollarsPerHour: number, hps: number): RigProfile => ({
  gpuName, gpuCount: 1, gpuRamMegabytes: 24576, dollarsPerHour, bootSeconds: 120,
  throughput: [{ hashcatMode: 9600, hashesPerSecond: hps }], measuredAt: "2026-07-03T00:00:00Z",
});

describe("profiles", () => {
  it("computes dollars per billion candidates for a mode", () => {
    // 68356 H/s at $0.40/hr: (1e9/68356)/3600*0.40 ≈ $1.626
    expect(dollarsPerBillionCandidates(rig("RTX_4090", 0.4, 68356), 9600)).toBeCloseTo(1.626, 2);
    expect(dollarsPerBillionCandidates(rig("RTX_4090", 0.4, 68356), 10700)).toBeNull();
  });
  it("ranks cheaper-per-work first, missing-mode last", () => {
    const ranked = rankByValue([rig("A", 0.8, 68356), rig("B", 0.4, 68356)], 9600);
    expect(ranked.map((r) => r.gpuName)).toEqual(["B", "A"]);
  });
  it("upserts by (gpuName, gpuCount)", () => {
    const t1 = upsertProfile([], rig("RTX_4090", 0.4, 1000));
    const t2 = upsertProfile(t1, rig("RTX_4090", 0.5, 2000));
    expect(t2).toHaveLength(1);
    expect(t2[0].dollarsPerHour).toBe(0.5);
  });
});
