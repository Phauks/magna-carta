import { describe, it, expect } from "vitest";
import { parseBenchmarkLog, BenchmarkParseError } from "../src/bench-parse.ts";

describe("bench-parse", () => {
  it("parses a single-GPU raw hashcat benchmark log", () => {
    const raw = [
      "BENCH_BEGIN",
      "NVIDIA GeForce RTX 4090, 24564 MiB",
      "MODE=9600",
      "1:9600:2310:10251:91.27:57305",
      "BENCH_END",
    ].join("\n");
    const result = parseBenchmarkLog(raw);
    expect(result.gpuName).toBe("NVIDIA GeForce RTX 4090");
    expect(result.gpuRamMegabytes).toBe(24564);
    expect(result.gpuCount).toBe(1);
    expect(result.throughput).toEqual([{ hashcatMode: 9600, hashesPerSecond: 57305 }]);
  });

  it("sums per-device speed across GPUs for the same mode and counts distinct devices", () => {
    const raw = [
      "BENCH_BEGIN",
      "NVIDIA GeForce RTX 4090, 24564 MiB",
      "MODE=9600",
      "0:9600:2310:10251:91.27:57305",
      "1:9600:2310:10251:91.27:56800",
      "MODE=11600",
      "0:11600:1000:2000:10.00:3520000",
      "1:11600:1000:2000:10.00:3510000",
      "BENCH_END",
    ].join("\n");
    const result = parseBenchmarkLog(raw);
    expect(result.gpuCount).toBe(2);
    expect(result.throughput).toEqual([
      { hashcatMode: 9600, hashesPerSecond: 57305 + 56800 },
      { hashcatMode: 11600, hashesPerSecond: 3520000 + 3510000 },
    ]);
  });

  it("ignores non-matching lines (warnings, ssh notices) rather than misparsing them", () => {
    const raw = [
      "Warning: Permanently added '1.2.3.4' (ED25519) to the list of known hosts.",
      "NVIDIA GeForce RTX 4090, 24564 MiB",
      "MODE=9600",
      "hashcat (v6.2.6) starting in benchmark mode...",
      "1:9600:2310:10251:91.27:57305",
      "BENCH_END",
    ].join("\n");
    const result = parseBenchmarkLog(raw);
    expect(result.throughput).toEqual([{ hashcatMode: 9600, hashesPerSecond: 57305 }]);
  });

  it("throws BenchmarkParseError, never a partial result, when no mode data is found", () => {
    expect(() => parseBenchmarkLog("nothing useful here\nssh warning: blah\n")).toThrow(
      BenchmarkParseError,
    );
  });

  it("omits a mode whose MODE= marker produced no device line (never a silent 0)", () => {
    // The onstart loop echoes `MODE=$m` for every mode unconditionally, so an unsupported mode
    // still prints its marker with no following device line. That mode must be absent from the
    // result, not recorded as 0 H/s (which would read as "this rig can't do this mode").
    const raw = [
      "NVIDIA GeForce RTX 4090, 24564 MiB",
      "MODE=9600",
      "1:9600:2310:10251:91.27:57305",
      "MODE=17200",
      "Cannot find a supported hash-mode for 17200 on this build",
      "MODE=11600",
      "1:11600:1000:2000:10.00:3520000",
      "BENCH_END",
    ].join("\n");
    const result = parseBenchmarkLog(raw);
    expect(result.throughput).toEqual([
      { hashcatMode: 9600, hashesPerSecond: 57305 },
      { hashcatMode: 11600, hashesPerSecond: 3520000 },
    ]);
    expect(result.throughput.map((entry) => entry.hashcatMode)).not.toContain(17200);
  });

  it("ignores a truncated device line with an empty speed field (no phantom 0-H/s device)", () => {
    const raw = [
      "NVIDIA GeForce RTX 4090, 24564 MiB",
      "MODE=9600",
      "1:9600:2310:10251:91.27:57305",
      "5:9600:", // truncated: trailing colon, no speed — must not add a device or a 0
      "BENCH_END",
    ].join("\n");
    const result = parseBenchmarkLog(raw);
    expect(result.gpuCount).toBe(1);
    expect(result.throughput).toEqual([{ hashcatMode: 9600, hashesPerSecond: 57305 }]);
  });
});
