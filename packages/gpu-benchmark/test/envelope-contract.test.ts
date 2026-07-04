import { describe, it, expect } from "vitest";
import { parseBenchmarkLog } from "../src/bench-parse.ts";

/**
 * A hand-authored sample matching the real shape of the onstart benchmark command's stdout (see
 * cli.ts's `BENCHMARK_ONSTART_COMMAND`) — verified live against real vast.ai hardware. This
 * replaces the retired custom image's baked `sample-output.json`: there is no JSON envelope any
 * more, just hashcat's raw `-b --machine-readable` text.
 */
const SAMPLE_RAW_LOG = [
  "BENCH_BEGIN",
  "NVIDIA GeForce RTX 4090, 24564 MiB",
  "MODE=9600",
  "0:9600:2310:10251:91.27:28650",
  "1:9600:2310:10251:91.27:28655",
  "MODE=10700",
  "0:10700:1000:2000:10.00:370500",
  "1:10700:1000:2000:10.00:371500",
  "MODE=11600",
  "0:11600:1000:2000:10.00:1760000",
  "1:11600:1000:2000:10.00:1760000",
  "MODE=10500",
  "0:10500:1000:2000:10.00:52500000",
  "1:10500:1000:2000:10.00:52500000",
  "MODE=13600",
  "0:13600:1000:2000:10.00:410000",
  "1:13600:1000:2000:10.00:410000",
  "MODE=17200",
  "0:17200:1000:2000:10.00:64000000",
  "1:17200:1000:2000:10.00:64000000",
  "MODE=9400",
  "0:9400:1000:2000:10.00:9200000",
  "1:9400:1000:2000:10.00:9200000",
  "MODE=9500",
  "0:9500:1000:2000:10.00:3100000",
  "1:9500:1000:2000:10.00:3100000",
  "BENCH_END",
].join("\n");

describe("envelope-contract", () => {
  it("parses the full baseline mode set and sums each mode's per-device throughput", () => {
    const result = parseBenchmarkLog(SAMPLE_RAW_LOG);
    expect(result.gpuCount).toBe(2);
    expect(result.throughput.map((entry) => entry.hashcatMode).sort((a, b) => a - b)).toEqual([
      9400, 9500, 9600, 10500, 10700, 11600, 13600, 17200,
    ]);
    const mode9600 = result.throughput.find((entry) => entry.hashcatMode === 9600);
    expect(mode9600?.hashesPerSecond).toBe(28650 + 28655);
  });
});
