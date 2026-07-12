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

/**
 * Why the probe can fail, kept apart on purpose. A diagnostic tool that reports our own refusal
 * as the caller's network failure sends someone to debug a firewall that was never at fault.
 */
export type ProbeStatus = "reachable" | "unauthenticated" | "forbidden" | "unreachable";

export interface ProbeOutcome {
  readonly status: ProbeStatus;
  /** Present only when reachable. */
  readonly facts: ConnectionFacts | null;
  readonly medianRoundTripMs: number | null;
  readonly successfulSamples: number;
}

/** `status: null` means the request never got an answer — a transport failure, not a refusal. */
export type FetchResult =
  | { readonly ok: true; readonly facts: ConnectionFacts }
  | { readonly ok: false; readonly status: number | null };

export interface ProbeDeps {
  readonly fetchJson: (url: string) => Promise<FetchResult>;
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

function refused(status: ProbeStatus): ProbeOutcome {
  return { status, facts: null, medianRoundTripMs: null, successfulSamples: 0 };
}

export async function probeConnection(deps: ProbeDeps): Promise<ProbeOutcome> {
  const durations: number[] = [];
  let facts: ConnectionFacts | null = null;

  for (let sample = 0; sample < PROBE_SAMPLES; sample += 1) {
    const started = deps.now();
    const result = await deps.fetchJson(CONNECTION_URL);

    if (result.ok) {
      facts = result.facts;
      durations.push(deps.now() - started);
      continue;
    }

    // A refusal is an answer: the platform is reachable and said no. Retrying cannot change it.
    if (result.status === 401) return refused("unauthenticated");
    if (result.status === 403) return refused("forbidden");

    // Anything else (a transport failure, or a server error) is an excluded sample.
  }

  if (durations.length === 0) return refused("unreachable");
  return {
    status: "reachable",
    facts,
    medianRoundTripMs: median(durations),
    successfulSamples: durations.length,
  };
}
