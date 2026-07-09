/*
 * The round trip to Magna Carta. The connection route is authenticated and rides the chokepoint
 * like every other route, so what this measures is a REAL authenticated API call — the latency the
 * application actually experiences — not synthetic network round-trip. The interface says so.
 *
 * A median over a fixed sample count, because one stalled request must not move the answer, and a
 * failed sample is excluded rather than counted as zero (zero would read as instantaneous).
 */
export interface ConnectionFacts {
  readonly ip: string;
  readonly asn: number;
  readonly asOrganization: string;
  readonly colo: string;
  readonly country: string;
}

export interface ProbeOutcome {
  /** Null when every sample failed — the platform could not be reached. */
  readonly facts: ConnectionFacts | null;
  readonly medianRoundTripMs: number | null;
  readonly successfulSamples: number;
}

export interface ProbeDeps {
  readonly fetchJson: (url: string) => Promise<ConnectionFacts>;
  readonly now: () => number;
}

export const PROBE_SAMPLES = 5;

export const CONNECTION_URL = "/api/v1/tools/connection";

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

export async function probeConnection(deps: ProbeDeps): Promise<ProbeOutcome> {
  const durations: number[] = [];
  let facts: ConnectionFacts | null = null;

  for (let sample = 0; sample < PROBE_SAMPLES; sample += 1) {
    const started = deps.now();
    try {
      facts = await deps.fetchJson(CONNECTION_URL);
      durations.push(deps.now() - started);
    } catch {
      // A failed sample contributes nothing. If every sample fails the platform is unreachable,
      // which the outcome states rather than implying a very fast zero.
    }
  }

  if (durations.length === 0) return { facts: null, medianRoundTripMs: null, successfulSamples: 0 };
  return { facts, medianRoundTripMs: median(durations), successfulSamples: durations.length };
}
