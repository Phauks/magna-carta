import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, redactDocument, loadDocument } from "../src/index.js";

const hello = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url))),
);

describe("redactDocument", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("redacts a region and removes the target text", async () => {
    const result = await redactDocument(
      hello,
      [{ page: 0, rect: { x0: 0, y0: 0, x1: 1000, y1: 1000 }, reason: "PII" }],
      { dpi: 150, redactedText: ["Hello"] },
    );
    expect(result.pagesRedacted).toEqual([0]);
    // the output still loads and renders
    const doc = await loadDocument(result.pdf);
    expect(doc.pageCount).toBeGreaterThanOrEqual(1);
    doc.free();
  });

  it("throws if the gate would fail (e.g. an out-of-range page)", async () => {
    await expect(
      redactDocument(hello, [{ page: 99, rect: { x0: 0, y0: 0, x1: 10, y1: 10 } }]),
    ).rejects.toThrow();
  });
});
