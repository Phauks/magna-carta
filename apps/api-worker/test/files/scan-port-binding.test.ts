// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { unscannedAdapter } from "@magna-carta/file-manager/scan-port";
import type { Bindings } from "../../src/bindings.ts";
import { resolveScanPort } from "../../src/files/scan-port-binding.ts";

// resolveScanPort selects the remote scan adapter when SCAN_SERVICE is present and falls back
// to unscannedAdapter when absent (tests and pre-deploy environments). These are pure unit tests
// over a fake env — no Worker pool binding needed.

describe("resolveScanPort", () => {
  it("returns an adapter that drives SCAN_SERVICE when the binding is present", async () => {
    // A fake Fetcher that records whether it was actually invoked and answers with a valid
    // (no-engine) RawScanResult so the adapter's response parsing succeeds.
    let fetched = false;
    const fakeFetcher = {
      fetch: async (_request: Request): Promise<Response> => {
        fetched = true;
        return new Response(
          JSON.stringify({
            engineVersion: null,
            clam: { state: "unavailable" },
            heuristic: { kind: "none" },
            matches: [],
            timings: { clamdMs: 0, yaraMs: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    } as unknown as Fetcher;

    const env = { SCAN_SERVICE: fakeFetcher } as unknown as Bindings;
    const port = resolveScanPort(env);
    expect(port).not.toBe(unscannedAdapter);

    // Drive a scan through the port: this must reach the SCAN_SERVICE Fetcher, proving the binding
    // is wired through resolveScanPort -> containerScanAdapter -> scan(). A shape-only check would
    // pass even if resolveScanPort ignored SCAN_SERVICE entirely.
    const body = new Response("x").body as ReadableStream<Uint8Array>;
    const result = await port.scan(body, { sizeBytes: 1, sniffedContentType: null });
    expect(fetched).toBe(true);
    expect(result.engineVersion).toBeNull();
    expect(result.clam.state).toBe("unavailable");
  });

  it("returns unscannedAdapter when SCAN_SERVICE is absent", () => {
    const env = {} as Bindings;
    const port = resolveScanPort(env);
    expect(port).toBe(unscannedAdapter);
  });
});
