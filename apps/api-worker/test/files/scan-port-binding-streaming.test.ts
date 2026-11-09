import { describe, expect, it } from "vitest";
import type { Bindings } from "../../src/bindings.ts";
import { resolveScanPort } from "../../src/files/scan-port-binding.ts";

// Regression test: a multi-MiB body forwarded through resolveScanPort → containerScanAdapter →
// scan() must arrive at the Fetcher intact. The adapter passes the ReadableStream directly as the
// request body without reading it first, so the byte count the Fetcher receives must equal the
// byte count that was pushed in. If this test fails, the adapter has introduced buffering or
// truncation on the forwarding path.

const MIB = 1024 * 1024;
const BODY_SIZE_BYTES = 8 * MIB; // 8 MiB — large enough to span multiple stream chunks

describe("resolveScanPort — streaming body forwarding", () => {
  it("forwards an 8 MiB body to the scan service without truncation", async () => {
    // Build an 8 MiB ReadableStream<Uint8Array> whose chunks sum to exactly BODY_SIZE_BYTES.
    // We produce it as a single chunk here; the important property is that the adapter must not
    // read + buffer the stream itself before handing it to the Fetcher.
    const sourceBytes = new Uint8Array(BODY_SIZE_BYTES);
    // Fill with a recognizable non-zero pattern so truncation (a short read) is apparent.
    for (let index = 0; index < sourceBytes.length; index++) {
      sourceBytes[index] = index & 0xff;
    }

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Enqueue in 1 MiB chunks to exercise realistic multi-chunk streaming.
        const chunkSize = MIB;
        for (let offset = 0; offset < BODY_SIZE_BYTES; offset += chunkSize) {
          controller.enqueue(sourceBytes.subarray(offset, offset + chunkSize));
        }
        controller.close();
      },
    });

    // A counting Fetcher: reads the incoming request body fully and records the total byte count.
    // Returns a valid no-engine RawScanResult so the adapter's response parsing succeeds.
    let receivedByteCount = 0;
    const countingFetcher = {
      fetch: async (request: Request): Promise<Response> => {
        const buffer = await new Response(request.body).arrayBuffer();
        receivedByteCount = buffer.byteLength;
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

    const environment = { SCAN_SERVICE: countingFetcher } as unknown as Bindings;
    const port = resolveScanPort(environment);

    const result = await port.scan(body, {
      sizeBytes: BODY_SIZE_BYTES,
      sniffedContentType: null,
    });

    // The Fetcher must have received every byte that was enqueued.
    expect(receivedByteCount).toBe(BODY_SIZE_BYTES);
    // The adapter must still return a valid RawScanResult (no parse error on the response).
    expect(result.engineVersion).toBeNull();
    expect(result.clam.state).toBe("unavailable");
  });
});
