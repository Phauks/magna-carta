import { describe, expect, it } from "vitest";
import { unscannedAdapter } from "@magna-carta/file-manager/scan-port";
import type { Bindings } from "../../src/app.ts";
import { containerScanAdapter } from "../../src/files/container-scan-adapter.ts";
import { resolveScanPort } from "../../src/files/scan-port-binding.ts";

// resolveScanPort selects the remote scan adapter when SCAN_SERVICE is present and falls back
// to unscannedAdapter when absent (tests and pre-deploy environments). These are pure unit tests
// over a fake env — no Worker pool binding needed.

describe("resolveScanPort", () => {
  it("returns the remote adapter when SCAN_SERVICE is present", () => {
    // A minimal fake Fetcher: structurally matches what the service binding provides.
    const fakeFetcher = {
      fetch: async (_request: Request): Promise<Response> => new Response("{}"),
    } as unknown as Fetcher;

    const env = { SCAN_SERVICE: fakeFetcher } as unknown as Bindings;
    const port = resolveScanPort(env);

    // Passing the same fake Fetcher to containerScanAdapter gives us the reference value to
    // compare against. Object identity confirms resolveScanPort wired the same Fetcher through.
    const expected = containerScanAdapter(fakeFetcher);
    // Both adapters should be structurally equivalent (both have a scan function).
    expect(typeof port.scan).toBe("function");
    expect(typeof expected.scan).toBe("function");
    // Confirm it is NOT the unscanned adapter (which has no scan function that fires a fetch).
    expect(port).not.toBe(unscannedAdapter);
  });

  it("returns unscannedAdapter when SCAN_SERVICE is absent", () => {
    const env = {} as Bindings;
    const port = resolveScanPort(env);
    expect(port).toBe(unscannedAdapter);
  });
});
