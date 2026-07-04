import { z } from "zod";
import type { ModeThroughput } from "./profiles.ts";

/**
 * The rig facts and per-mode throughput reported by the benchmark container's entrypoint, once
 * parsed and validated out of its JSON envelope.
 */
export interface BenchmarkResult {
  readonly gpuName: string;
  readonly gpuCount: number;
  readonly gpuRamMegabytes: number;
  readonly throughput: ModeThroughput[];
}

export class BenchmarkParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkParseError";
  }
}

const modeThroughputSchema = z.object({
  hashcatMode: z.number(),
  hashesPerSecond: z.number(),
});

const benchmarkResultSchema = z.object({
  gpuName: z.string(),
  gpuCount: z.number(),
  gpuRamMegabytes: z.number(),
  throughput: z.array(modeThroughputSchema),
});

/**
 * Parses the benchmark container entrypoint's JSON envelope into a `BenchmarkResult`. Throws
 * `BenchmarkParseError` on any malformed input — invalid JSON or a shape that fails validation —
 * rather than returning a partial result, since a silently-incomplete rig profile would corrupt
 * downstream cost-per-work rankings.
 */
export function parseBenchmarkJson(raw: string): BenchmarkResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    throw new BenchmarkParseError(
      `benchmark envelope is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = benchmarkResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BenchmarkParseError(`benchmark envelope failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Sums the per-device hashes/sec reported by a hashcat `--machine-readable` status line. hashcat
 * repeats a `SPEED <hashes> <ms>` pair for each device after the `SPEED` token; this reads pairs
 * until the next non-numeric token (or the line ends) and returns the total hashes/sec across all
 * devices.
 */
export function sumDeviceSpeeds(machineReadableLine: string): number {
  const tokens = machineReadableLine.trim().split(/\s+/);
  const speedIndex = tokens.indexOf("SPEED");
  if (speedIndex === -1) return 0;

  let total = 0;
  let index = speedIndex + 1;
  while (index + 1 < tokens.length) {
    const hashes = Number(tokens[index]);
    const milliseconds = Number(tokens[index + 1]);
    if (!Number.isFinite(hashes) || !Number.isFinite(milliseconds)) break;
    total += hashes;
    index += 2;
  }
  return total;
}
