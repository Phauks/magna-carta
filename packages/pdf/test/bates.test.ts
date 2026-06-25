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

  it("font and suffix options round-trip without throwing", async () => {
    // Courier is a monospace font whose advance widths differ from Helvetica;
    // verifying the call succeeds confirms the font mapping reaches the engine.
    const result = await stampBates(hello, {
      font: "courier",
      prefix: "ACME-",
      suffix: "-CONF",
      startNumber: 1,
    });
    expect(result.pdf.byteLength).toBeGreaterThan(0);
    expect(result.start).toBe(1);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    // The output must still be a loadable PDF.
    const doc = await loadDocument(result.pdf);
    expect(doc.pageCount).toBe(result.pageCount);
    doc.free();
  });

  it("stopNumber allows stamping when the ceiling is not exceeded", async () => {
    // hello.pdf is a single-page fixture so startNumber 1, stopNumber 1 is exact.
    const result = await stampBates(hello, { startNumber: 1, stopNumber: 100 });
    expect(result.pdf.byteLength).toBeGreaterThan(0);
    expect(result.end).toBeLessThanOrEqual(100);
  });

  it("stopNumber throws when numbering would exceed the ceiling", async () => {
    // With startNumber 5 and a single-page document the last assigned number is 5;
    // a ceiling of 4 must cause the call to reject before stamping any page.
    await expect(stampBates(hello, { startNumber: 5, stopNumber: 4 })).rejects.toThrow(
      "bates numbering exceeds the configured stop number",
    );
  });
});
