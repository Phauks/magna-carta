// The malware-scan seam. The engine is a future slice's concern — this slice ships the PORT and an
// engine-less launch adapter that records an honest `unscanned` verdict (nothing pretends to be
// clean-by-scan). A real engine (its own design cycle) implements this same interface behind the gate.
export interface MalwareScanPort {
  scan(
    body: ReadableStream<Uint8Array>,
    meta: { sizeBytes: number; sniffedContentType: string | null },
  ): Promise<{ verdict: "unscanned" | "clean" | "infected"; engineVersion: string | null }>;
}

// Launch adapter: no engine yet. Drains its stream branch so it cannot backpressure the single read,
// and returns `unscanned` — the explicit-unscanned policy commits such versions (quarantine is for
// failed gates and `infected` only).
export const unscannedAdapter: MalwareScanPort = {
  async scan(body) {
    await body.cancel();
    return { verdict: "unscanned", engineVersion: null };
  },
};
