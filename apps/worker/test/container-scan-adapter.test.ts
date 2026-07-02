import { describe, expect, it } from "vitest";
import type { RawScanResult } from "@magna-carta/file-manager/scan-port";
import {
  containerScanAdapter,
  type ScanContainerFetcher,
} from "../src/files/container-scan-adapter.ts";

// The adapter is exercised with a fake container (no real binding, no Docker): each fake returns one
// RawScanResult JSON shape (or a fault), and the adapter must parse it to the typed facts or throw.

function fakeContainer(body: unknown, status = 200): ScanContainerFetcher {
  return {
    fetch: async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
}

const meta = { sizeBytes: 42, sniffedContentType: "application/pdf" };
const emptyBody = () => new Response("").body ?? new ReadableStream<Uint8Array>();

describe("containerScanAdapter", () => {
  it("parses each RawScanResult shape", async () => {
    const shapes: RawScanResult[] = [
      {
        engineVersion: "e/1",
        clam: { state: "clean" },
        heuristic: { kind: "active-content" },
        matches: [],
        timings: { clamdMs: 3, yaraMs: 1 },
      },
      {
        engineVersion: "e/1",
        clam: { state: "infected", signature: "Eicar-Test-Signature" },
        heuristic: { kind: "none" },
        matches: [{ ruleId: "R", tier: "core", score: 90, isSuspicious: false }],
        timings: { clamdMs: 2, yaraMs: 4 },
      },
      {
        engineVersion: "e/1",
        clam: { state: "clean" },
        heuristic: { kind: "encrypted" },
        matches: [],
        timings: { clamdMs: 1, yaraMs: 0 },
      },
      {
        engineVersion: "e/1",
        clam: { state: "clean" },
        heuristic: { kind: "structural", reason: "decompression-bomb" },
        matches: [],
        timings: { clamdMs: 5, yaraMs: 2 },
      },
      {
        engineVersion: null,
        clam: { state: "unavailable" },
        heuristic: { kind: "none" },
        matches: [],
        timings: { clamdMs: 0, yaraMs: 0 },
      },
    ];
    for (const shape of shapes) {
      const result = await containerScanAdapter(fakeContainer(shape)).scan(emptyBody(), meta);
      expect(result).toEqual(shape);
    }
  });

  it("throws on a non-200 response (never returns clean)", async () => {
    const adapter = containerScanAdapter(
      fakeContainer(
        {
          engineVersion: "e",
          clam: { state: "clean" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 0, yaraMs: 0 },
        },
        500,
      ),
    );
    await expect(adapter.scan(emptyBody(), meta)).rejects.toThrow();
  });

  it("throws on a malformed body (an unrecognized shape is a fault)", async () => {
    const adapter = containerScanAdapter(
      fakeContainer({ clam: { state: "definitely-not-a-state" } }),
    );
    await expect(adapter.scan(emptyBody(), meta)).rejects.toThrow();
  });

  it("throws on a non-JSON body", async () => {
    const adapter = containerScanAdapter(fakeContainer("<html>not json</html>"));
    await expect(adapter.scan(emptyBody(), meta)).rejects.toThrow();
  });

  it("throws (never hangs/returns clean) when the container wedges past the request timeout", async () => {
    // A wedged container: it never resolves on its own, but honors the request's AbortSignal — exactly
    // the behavior the runtime gives `container.fetch`. The adapter's AbortSignal.timeout must fire and
    // turn the hang into a retryable throw. A small injected timeout (50 ms) drives the real abort path
    // without waiting out the production backstop.
    const wedged: ScanContainerFetcher = {
      fetch: (request) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () =>
            reject(request.signal?.reason ?? new Error("aborted")),
          );
        }),
    };
    await expect(containerScanAdapter(wedged, 50).scan(emptyBody(), meta)).rejects.toThrow();
  });
});
