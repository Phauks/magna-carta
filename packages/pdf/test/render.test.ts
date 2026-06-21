import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, loadDocument } from "../src/index.js";

// Under Node/Vitest, `fetch` is unavailable so the wasm-bindgen web-target init() cannot
// resolve the .wasm URL. Feed the bytes directly so WebAssembly.instantiate is used instead.
const wasmPath = fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url));
const wasmBytes = readFileSync(wasmPath);

const blankPath = fileURLToPath(new URL("./fixtures/blank.pdf", import.meta.url));
const blank = new Uint8Array(readFileSync(blankPath));

beforeAll(async () => {
  await ensureReady(wasmBytes);
});

describe("@magna-carta/pdf", () => {
  it("loads, counts pages, and reports size", async () => {
    const doc = await loadDocument(blank);
    expect(doc.pageCount).toBe(1);
    const size = doc.pageSize(0);
    expect(Math.round(size.widthPt)).toBe(612);
    expect(Math.round(size.heightPt)).toBe(792);
    doc.free();
  });

  it("renders a page to rgba8", async () => {
    const doc = await loadDocument(blank);
    const page = doc.renderPage(0, { dpi: 72 });
    expect(page.encoding).toBe("rgba8");
    expect(page.width).toBe(612);
    expect(page.data.length).toBe(page.width * page.height * 4);
    doc.free();
  });
});
