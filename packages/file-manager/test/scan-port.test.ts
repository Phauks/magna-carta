import { describe, expect, it } from "vitest";
import { unscannedAdapter, type ScanResult } from "../src/scan-port.ts";

describe("unscannedAdapter", () => {
  it("drains its stream branch and reports an honest no-engine unscanned verdict", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const result: ScanResult = await unscannedAdapter.scan(body, {
      sizeBytes: 3,
      sniffedContentType: null,
    });
    expect(result).toEqual({ verdict: "unscanned", reason: "no-engine", engineVersion: null });
  });
});
