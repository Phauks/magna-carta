// The malware-scan seam. The engine (a separate Container worker) implements this interface and
// returns raw facts; the app layer turns those facts into a verdict. An engine-less launch adapter
// returns an honest unavailable result so the app records `unscanned` (nothing pretends clean).

export type Tier = "core" | "extended" | "full";

export interface RuleMatch {
  ruleId: string;
  tier: Tier;
  score: number;
  isSuspicious: boolean;
}

export type RawScanResult = {
  engineVersion: string | null;
  clam: { state: "clean" } | { state: "infected"; signature: string } | { state: "unavailable" };
  heuristic:
    | { kind: "none" }
    | {
        kind: "structural";
        reason: "decompression-bomb" | "archive-nesting" | "archive-entry-count";
      }
    | { kind: "encrypted" }
    | { kind: "active-content" };
  matches: RuleMatch[];
  timings: { clamdMs: number; yaraMs: number };
};

export interface MalwareScanPort {
  scan(
    body: ReadableStream<Uint8Array>,
    meta: { sizeBytes: number; sniffedContentType: string | null },
  ): Promise<RawScanResult>;
}

// Launch adapter: no engine yet. Drains the stream so it cannot backpressure the single read,
// then returns unavailable — the app's verdict layer turns null engineVersion + unavailable clam
// into an `unscanned`/no-engine verdict. `clam: unavailable` is deliberate: nothing implies clean.
export const unscannedAdapter: MalwareScanPort = {
  async scan(body) {
    await body.cancel();
    return {
      engineVersion: null,
      clam: { state: "unavailable" },
      heuristic: { kind: "none" },
      matches: [],
      timings: { clamdMs: 0, yaraMs: 0 },
    };
  },
};
