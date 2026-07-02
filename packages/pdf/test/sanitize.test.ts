import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, sanitizeDocument, loadDocument } from "../src/index.js";

const hello = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url))),
);

describe("sanitizeDocument", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("returns a still-loadable PDF", async () => {
    const result = await sanitizeDocument(hello);
    const doc = await loadDocument(result.pdf);
    expect(doc.pageCount).toBeGreaterThanOrEqual(1);
    doc.free();
  });

  it("accepts per-surface opt-outs", async () => {
    const result = await sanitizeDocument(hello, { metadata: false });
    expect(result.pdf.byteLength).toBeGreaterThan(0);
  });
});
