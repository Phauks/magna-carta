import { describe, it, expect } from "vitest";
import { parseBenchmarkJson, sumDeviceSpeeds, BenchmarkParseError } from "../src/bench-parse.ts";

describe("bench-parse", () => {
  it("sums per-device SPEED fields from a machine-readable line", () => {
    // two devices: 1,000,000 + 500,000 H/s
    const line = "STATUS 3 SPEED 1000000 1000 500000 1000 EXEC_RUNTIME 1.0 CURKU 0 PROGRESS 1 1 REJECTED 0";
    expect(sumDeviceSpeeds(line)).toBe(1500000);
  });
  it("parses the entrypoint envelope", () => {
    const raw = JSON.stringify({
      gpuName: "RTX_4090", gpuCount: 1, gpuRamMegabytes: 24576,
      throughput: [{ hashcatMode: 9600, hashesPerSecond: 68356 }],
    });
    expect(parseBenchmarkJson(raw).throughput[0].hashesPerSecond).toBe(68356);
  });
  it("throws on malformed input, never partial", () => {
    expect(() => parseBenchmarkJson("{not json")).toThrow(BenchmarkParseError);
  });
});
