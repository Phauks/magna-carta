import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, extractPdfText, loadDocument } from "@magna-carta/pdf";
import { arrangeDocument } from "../src/lib/pdf-editor/arrange-document.ts";
import {
  buildPlan,
  initialArrangement,
  movePages,
  removePages,
  turnPages,
} from "../src/lib/pdf-editor/page-arrangement.ts";

// A real, many-page government form, the same one the engine's own tests use.
const form = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL("../../../crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf", import.meta.url),
    ),
  ),
);

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const extracted = await extractPdfText(bytes);
  return extracted.pages.map((page) => page.lines.map((line) => line.text).join(" "));
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const document = await loadDocument(bytes);
  const count = document.pageCount;
  document.free();
  return count;
}

describe("arranging a real document with the engine", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(
        fileURLToPath(new URL("../../../packages/pdf/src/pkg/pdf_core_bg.wasm", import.meta.url)),
      ),
    );
  });

  it("puts the pages in the new order and leaves the deleted ones out", async () => {
    const count = await pageCount(form);
    expect(count).toBeGreaterThan(2);
    const original = await pageTexts(form);
    // The pages must read differently, or the order below proves nothing.
    expect(original[0]).not.toBe(original[2]);
    expect(original[2]?.length).toBeGreaterThan(0);
    let pages = movePages(initialArrangement(count), new Set([2]), 0);
    pages = removePages(pages, new Set([1]));
    const made = await arrangeDocument(form, buildPlan(pages));
    expect(await pageCount(made)).toBe(count - 1);
    const texts = await pageTexts(made);
    expect(texts[0]).toBe(original[2]);
    expect(texts[1]).toBe(original[0]);
  });

  it("turns a page without moving any", async () => {
    const count = await pageCount(form);
    const made = await arrangeDocument(
      form,
      buildPlan(turnPages(initialArrangement(count), new Set([0]), 90)),
    );
    expect(await pageCount(made)).toBe(count);
    expect(made).not.toEqual(form);
  });
});
