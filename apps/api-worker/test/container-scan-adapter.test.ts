// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import type { RawScanResult } from "@magna-carta/file-manager/scan-port";
import { ScanFaultError } from "@magna-carta/file-manager/verdict";
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

  it("sends the caller's stable content key so the engine can route on it, and omits it otherwise", async () => {
    const cleanResult: RawScanResult = {
      engineVersion: "e/1",
      clam: { state: "clean" },
      heuristic: { kind: "none" },
      matches: [],
      timings: { clamdMs: 0, yaraMs: 0 },
    };
    const seen: string[] = [];
    const recording: ScanContainerFetcher = {
      fetch: async (request) => {
        seen.push(request.url);
        return new Response(JSON.stringify(cleanResult), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const adapter = containerScanAdapter(recording);
    await adapter.scan(emptyBody(), { ...meta, contentKey: "files/file_abc/version_1" });
    await adapter.scan(emptyBody(), meta);
    expect(new URL(seen[0]!).searchParams.get("shardKey")).toBe("files/file_abc/version_1");
    expect(new URL(seen[1]!).searchParams.has("shardKey")).toBe(false);
  });

  it("throws the typed scan fault on a 5xx (never returns clean)", async () => {
    // Typed, because a caller answering a person has to tell an unreachable engine apart from a
    // genuine fault: a 5xx here is a placeholder worker or a Container that is not up, and the
    // diagnostic route turns it into a 503 rather than a 500 with an Error ID.
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
    await expect(adapter.scan(emptyBody(), meta)).rejects.toThrow(ScanFaultError);
  });

  it("throws a plain fault on a 4xx (this adapter and the service disagree; no deploy fixes it)", async () => {
    const adapter = containerScanAdapter(fakeContainer({ error: "bad request" }, 400));
    const rejection: unknown = await adapter.scan(emptyBody(), meta).catch((error) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).not.toBeInstanceOf(ScanFaultError);
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
