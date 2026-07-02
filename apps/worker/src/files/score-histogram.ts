// The scan engine's `_SUSP_` rule-score histogram, fetched over the SCAN_SERVICE binding for the firm
// scan-policy custom-floor control. Engine-global static metadata (no firm scoping), so the caller only
// gates access — there is no firm data to scope here.
//
// SCAN_SERVICE is declared in wrangler.jsonc, so in the deployed worker (and in the test pool, which
// binds a no-engine stub) it is always present and this fetches the live histogram. The `undefined`
// guard is defensive for a configuration that omits the binding entirely (the scan worker not wired):
// there the no-engine empty shape lets the control render unbounded rather than erroring. A binding that
// IS present but whose engine is unreachable is a real fault — it throws, never a masked empty.

export interface ScoreHistogramBucket {
  floor: number;
  count: number;
}

export interface ScoreHistogram {
  engineVersion: string | null;
  minScoreGate: number | null;
  total: number;
  buckets: ScoreHistogramBucket[];
}

// engineVersion/minScoreGate are null only here (no binding); a real engine — even one with zero rules
// loaded — always reports a non-null engineVersion and a numeric gate.
const NO_ENGINE_HISTOGRAM: ScoreHistogram = {
  engineVersion: null,
  minScoreGate: null,
  total: 0,
  buckets: [],
};

export async function fetchScoreHistogram(
  scanService: Fetcher | undefined,
): Promise<ScoreHistogram> {
  if (scanService === undefined) {
    return NO_ENGINE_HISTOGRAM;
  }
  const upstream = await scanService.fetch("http://scan/rules/score-histogram");
  if (!upstream.ok) {
    throw new Error(`scan service returned status ${upstream.status} for the score histogram`);
  }
  return (await upstream.json()) as ScoreHistogram;
}
