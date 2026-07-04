import type { VastOffer } from "./vast-client.ts";

/**
 * A benchmark rig shape: one entry in the shortlist below, and the shape callers pass to
 * `cheapestVerifiedOffer` when shopping the marketplace for a matching rig.
 */
export interface RigShape {
  readonly gpuName: string;
  readonly gpuCount: number;
}

/**
 * The owner-approved set of rigs the benchmark harness measures. Mostly RTX 4090 at increasing
 * GPU count (the workhorse rental shape), plus a single H100 SXM rig to compare consumer cards
 * against a datacenter part, plus a single RTX 5090 rig as the newest consumer card available.
 *
 * Every entry here is a rig the harness will actually rent and benchmark — not a hypothetical
 * matrix. Extend deliberately, one rig at a time.
 */
export const BENCHMARK_SHORTLIST: ReadonlyArray<RigShape> = [
  { gpuName: "RTX 4090", gpuCount: 1 },
  { gpuName: "RTX 4090", gpuCount: 2 },
  { gpuName: "RTX 4090", gpuCount: 4 },
  { gpuName: "H100 SXM", gpuCount: 1 },
  { gpuName: "RTX 5090", gpuCount: 1 },
];

/**
 * Picks the cheapest marketplace offer matching a rig shape, restricted to offers vast.ai has
 * verified and whose host reliability meets the caller's floor. Returns null when no offer
 * qualifies.
 *
 * This does not rank by vast.ai's `dlperf` score: `dlperf` is a deep-learning-training benchmark
 * (throughput on training workloads), which has no fixed relationship to hashcat throughput on a
 * given GPU. Ranking is instead done downstream, after a real benchmark run, using measured
 * throughput divided by price for each candidate offer — this function only narrows the
 * marketplace down to eligible, comparably-priced candidates for that run.
 */
export function cheapestVerifiedOffer(
  offers: VastOffer[],
  want: RigShape,
  minReliability: number,
): VastOffer | null {
  let cheapest: VastOffer | null = null;
  for (const candidate of offers) {
    if (candidate.gpuName !== want.gpuName || candidate.gpuCount !== want.gpuCount) continue;
    if (!candidate.verified) continue;
    if (candidate.reliability < minReliability) continue;
    if (cheapest === null || candidate.dollarsPerHour < cheapest.dollarsPerHour) {
      cheapest = candidate;
    }
  }
  return cheapest;
}

/**
 * Narrows the marketplace to offers matching a rig shape, verified and at or above the
 * reliability floor, ranked cheapest-first. Unlike `cheapestVerifiedOffer`, this returns the
 * whole ranked list rather than just the top match, so a caller can fall through to the
 * next-cheapest offer when the cheapest one's rented instance turns out to be a bad rig (fails
 * to boot, never produces benchmark output) — see `run.ts`'s `benchmarkOneRig`.
 */
export function rankedVerifiedOffers(
  offers: VastOffer[],
  want: RigShape,
  minReliability: number,
): VastOffer[] {
  return offers
    .filter(
      (candidate) =>
        candidate.gpuName === want.gpuName &&
        candidate.gpuCount === want.gpuCount &&
        candidate.verified &&
        candidate.reliability >= minReliability,
    )
    .sort((a, b) => a.dollarsPerHour - b.dollarsPerHour);
}
