import { describe, expect, it } from "vitest";
import { hashAll } from "../src/hash.ts";
import { createNodeDigestSink } from "./node-sink.ts";

// Build a ReadableStream that emits the given byte chunks, so the multi-chunk streaming path is real.
function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const encoder = new TextEncoder();

describe("hashAll", () => {
  it("computes all five digests for 'abc' (known vectors) in one pass", async () => {
    const result = await hashAll(streamOf(encoder.encode("abc")), createNodeDigestSink);
    expect(result).toEqual({
      md5: "900150983cd24fb0d6963f7d28e17f72",
      sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sha384:
        "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
      sha512:
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
      sizeBytes: 3,
    });
  });

  it("is chunk-boundary independent: 'a'+'bc' equals 'abc'", async () => {
    const split = await hashAll(
      streamOf(encoder.encode("a"), encoder.encode("bc")),
      createNodeDigestSink,
    );
    expect(split.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(split.sizeBytes).toBe(3);
  });

  it("handles the empty stream", async () => {
    const result = await hashAll(streamOf(), createNodeDigestSink);
    expect(result.sha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(result.md5).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(result.sizeBytes).toBe(0);
  });
});
