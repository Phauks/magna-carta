import { describe, expect, it } from "vitest";
import { unscannedAdapter } from "../src/scan-port.ts";

describe("unscannedAdapter", () => {
  it("returns a no-engine raw result", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
    const raw = await unscannedAdapter.scan(body, { sizeBytes: 0, sniffedContentType: null });
    expect(raw).toEqual({
      engineVersion: null, clam: { state: "unavailable" }, heuristic: { kind: "none" },
      matches: [], timings: { clamdMs: 0, yaraMs: 0 },
    });
  });
});
