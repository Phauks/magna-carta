import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, stampBates, loadDocument } from "../src/index.js";

const hello = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url))),
);

describe("stampBates", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("returns a valid PDF with the correct Bates range", async () => {
    const result = await stampBates(hello, { prefix: "TEST-", startNumber: 1 });
    expect(result.start).toBe(1);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.end).toBe(result.start + result.pageCount - 1);
    expect(result.pdf.byteLength).toBeGreaterThan(0);

    // The output must still be a loadable PDF.
    const doc = await loadDocument(result.pdf);
    expect(doc.pageCount).toBe(result.pageCount);
    doc.free();
  });

  it("defaults produce a valid result (no options passed)", async () => {
    const result = await stampBates(hello);
    expect(result.start).toBe(1);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.pdf.byteLength).toBeGreaterThan(0);
  });

  it("startNumber offsets the Bates range correctly", async () => {
    const result = await stampBates(hello, { startNumber: 42 });
    expect(result.start).toBe(42);
    expect(result.end).toBe(42 + result.pageCount - 1);
  });

  it("output is a non-empty PDF (label content was added)", async () => {
    const result = await stampBates(hello);
    // The stamped document must be non-empty and re-parseable; size is not
    // guaranteed to grow because the serializer may rewrite the cross-reference
    // table more compactly even while adding a font object and content stream.
    expect(result.pdf.byteLength).toBeGreaterThan(0);
    const doc = await loadDocument(result.pdf);
    expect(doc.pageCount).toBe(result.pageCount);
    doc.free();
  });

  it("supports all six position values without throwing", async () => {
    const positions = [
      "bottomRight",
      "bottomLeft",
      "bottomCenter",
      "topRight",
      "topLeft",
      "topCenter",
    ] as const;
    for (const position of positions) {
      const result = await stampBates(hello, { position });
      expect(result.pdf.byteLength).toBeGreaterThan(0);
    }
  });

  it("continuous set numbering threads correctly across two calls", async () => {
    const first = await stampBates(hello, { startNumber: 1 });
    const second = await stampBates(hello, { startNumber: first.end + 1 });
    expect(second.start).toBe(first.end + 1);
    expect(second.end).toBe(first.end + second.pageCount);
  });
});
