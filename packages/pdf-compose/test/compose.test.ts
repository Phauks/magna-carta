import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureReady as ensurePdfReady, loadDocument } from "@magna-carta/pdf";
import { beforeAll, describe, expect, it } from "vitest";
import { composeDocument, ensureReady, type ComposeDocument } from "../src/index.ts";

function bytesAt(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(relative, import.meta.url))));
}

// A 2 by 2 pixel PNG: enough for the engine to decode, place and embed.
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGM4YaOhYXOCAUIBACDeBLGLZwFBAAAAAElFTkSuQmCC",
  ),
  (character) => character.charCodeAt(0),
);

describe("composeDocument", () => {
  beforeAll(async () => {
    await ensureReady(bytesAt("../src/pkg/pdf_compose_core_bg.wasm"));
    await ensurePdfReady(bytesAt("../../pdf/src/pkg/pdf_core_bg.wasm"));
  });

  const record: ComposeDocument = {
    title: "Matter summary",
    footer: { right: "Page {page} of {pages}" },
    blocks: [
      { type: "title", text: "Matter summary" },
      { type: "fields", fields: [{ label: "Client", value: "José Rivera-Muñoz" }] },
      { type: "paragraph", spans: [{ text: "Taken at the " }, { text: "scene", bold: true }] },
      { type: "image", image: 0, width: 120, caption: "Figure 1" },
      { type: "pageBreak" },
      {
        type: "table",
        columns: [{ heading: "Date" }, { heading: "Amount", alignment: "end" }],
        rows: [["2026-03-01", "150.00"]],
      },
    ],
  };

  it("composes a document a PDF reader opens, with its pages and no missing characters", async () => {
    const composed = await composeDocument(record, [TINY_PNG]);
    expect(composed.pageCount).toBe(2);
    expect(composed.missingCharacters).toEqual([]);
    expect(new TextDecoder().decode(composed.pdf.slice(0, 5))).toBe("%PDF-");
    const read = await loadDocument(composed.pdf);
    expect(read.pageCount).toBe(2);
    read.free();
  });

  it("gives the same bytes for the same document", async () => {
    const first = await composeDocument(record, [TINY_PNG]);
    const second = await composeDocument(record, [TINY_PNG]);
    expect(first.pdf).toEqual(second.pdf);
  });

  it("reports characters the bundled fonts cannot draw", async () => {
    const composed = await composeDocument({
      blocks: [{ type: "paragraph", text: "Signed 山田 today" }],
    });
    expect(composed.missingCharacters).toEqual(["山", "田"]);
  });

  it("rejects a picture that was not supplied, a damaged one, and a malformed document", async () => {
    await expect(composeDocument(record)).rejects.toThrow("image 0 was not supplied");
    await expect(composeDocument(record, [new Uint8Array([1, 2, 3])])).rejects.toThrow(
      "image 0 is not a readable picture",
    );
    const malformed = { blocks: [{ type: "paragraph", text: "x", alignement: "end" }] };
    await expect(composeDocument(malformed as unknown as ComposeDocument)).rejects.toThrow(
      "the document is not valid at line 1",
    );
  });
});
