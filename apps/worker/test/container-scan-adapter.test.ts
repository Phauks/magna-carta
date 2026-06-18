import { describe, expect, it } from "vitest";
import type { ScanResult } from "@magna-carta/file-manager/scan-port";
import {
  containerScanAdapter,
  type ScanContainerFetcher,
} from "../src/files/container-scan-adapter.ts";

// The adapter is exercised with a fake container (no real binding, no Docker): each fake returns one
// ScanResult JSON shape (or a fault), and the adapter must map it to the typed result or throw.

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
  it("maps each ScanResult verdict shape", async () => {
    const shapes: ScanResult[] = [
      { verdict: "clean", engineVersion: "e/1", activeContent: false },
      { verdict: "infected", engineVersion: "e/1", signature: "Eicar-Test-Signature" },
      { verdict: "unscanned", reason: "encrypted", engineVersion: "e/1" },
      { verdict: "suspicious", reason: "decompression-bomb", engineVersion: "e/1" },
    ];
    for (const shape of shapes) {
      const result = await containerScanAdapter(fakeContainer(shape)).scan(emptyBody(), meta);
      expect(result).toEqual(shape);
    }
  });

  it("throws on a non-200 response (never returns clean)", async () => {
    const adapter = containerScanAdapter(
      fakeContainer({ verdict: "clean", engineVersion: "e" }, 500),
    );
    await expect(adapter.scan(emptyBody(), meta)).rejects.toThrow();
  });

  it("throws on a malformed body (an unrecognized verdict is a fault)", async () => {
    const adapter = containerScanAdapter(fakeContainer({ verdict: "definitely-not-a-verdict" }));
    await expect(adapter.scan(emptyBody(), meta)).rejects.toThrow();
  });

  it("throws on a non-JSON body", async () => {
    const adapter = containerScanAdapter(fakeContainer("<html>not json</html>"));
    await expect(adapter.scan(emptyBody(), meta)).rejects.toThrow();
  });
});
