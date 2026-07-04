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
