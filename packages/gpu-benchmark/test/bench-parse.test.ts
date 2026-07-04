import { describe, it, expect } from "vitest";
import { parseBenchmarkJson, BenchmarkParseError } from "../src/bench-parse.ts";

describe("bench-parse", () => {
  it("parses the entrypoint envelope", () => {
    const raw = JSON.stringify({
      gpuName: "RTX_4090", gpuCount: 1, gpuRamMegabytes: 24576,
      throughput: [{ hashcatMode: 9600, hashesPerSecond: 68356 }],
    });
    const [first] = parseBenchmarkJson(raw).throughput;
    expect(first?.hashesPerSecond).toBe(68356);
  });
  it("throws on malformed input, never partial", () => {
    expect(() => parseBenchmarkJson("{not json")).toThrow(BenchmarkParseError);
  });
});
