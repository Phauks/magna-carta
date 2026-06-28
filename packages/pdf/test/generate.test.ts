import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureReady,
  loadDocument,
  mergeDocuments,
  rotatePages,
  splitDocument,
  watermarkDocument,
} from "../src/index.js";

const w9 = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL("../../../crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf", import.meta.url),
    ),
  ),
);

// A minimal 1×1 PNG.
const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await loadDocument(bytes);
  const n = doc.pageCount;
  doc.free();
  return n;
}

describe("generate primitives", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("mergeDocuments concatenates pages", async () => {
    const n = await pageCount(w9);
    const { pdf } = await mergeDocuments([w9, w9]);
    expect(await pageCount(pdf)).toBe(n * 2);
  });

  it("splitDocument returns one loadable document per range", async () => {
    const { pdfs } = await splitDocument(w9, [{ start: 0, end: 0 }]);
    expect(pdfs.length).toBe(1);
    expect(await pageCount(pdfs[0])).toBe(1);
  });

  it("rotatePages produces a loadable document and rejects out-of-set angles", async () => {
    const { pdf } = await rotatePages(w9, 90);
    expect(await pageCount(pdf)).toBeGreaterThan(0);
    // An angle outside {90,180,270} is rejected rather than silently coerced.
    await expect(rotatePages(w9, 45 as unknown as 90)).rejects.toThrow();
  });

  it("watermarkDocument (text) produces a loadable document", async () => {
    const { pdf } = await watermarkDocument(w9, {
      content: { kind: "text", text: "CONFIDENTIAL" },
      placement: "tiled",
    });
    expect(await pageCount(pdf)).toBeGreaterThan(0);
  });

  it("watermarkDocument (image) produces a loadable document", async () => {
    const { pdf } = await watermarkDocument(w9, {
      content: { kind: "image", bytes: png, scale: 0.2 },
    });
    expect(await pageCount(pdf)).toBeGreaterThan(0);
  });
});
