/*
 * A tabular export as a PDF: the mapping onto the composer's document, and the composer itself run
 * over a report, so the file the menu hands over is proved to be a PDF and not only a shape.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { composeReadable, housePictures } from "@magna-carta/house-document";
import { composeDocument, ensureReady } from "@magna-carta/pdf-compose";
import { describe, expect, it } from "vitest";
import { composeExportDocument } from "../src/lib/export/render-pdf.ts";
import type { TabularExportDocument } from "../src/lib/export/tabular-export.ts";
import { presentAccountsReceivableAging } from "../src/lib/reports/financial-presenters.ts";
import { reportExportDocument } from "../src/lib/reports/report-presentation.ts";
import { sampleAccountsReceivableAging } from "../src/lib/reports/report-samples.ts";

const GENERATED_AT = new Date("2026-08-01T15:00:00.000Z");

const narrow: TabularExportDocument = {
  title: "Ledger",
  generatedAt: GENERATED_AT,
  sections: [
    {
      title: "Entries",
      headers: ["Date", "Amount"],
      rows: [["2026-07-01", { text: "$10.00", number: 10 }]],
      endAlignedColumns: [1],
    },
    { title: "Holds", headers: ["Reason"], rows: [] },
  ],
};

describe("composeExportDocument", () => {
  it("lays the export out as a house document: letterhead, a generated line, a card per section", () => {
    const composed = composeExportDocument(narrow);
    expect(composed.letterhead?.title).toBe("Ledger");
    expect(composed.footer).toEqual({ center: "Page {page} of {pages}" });
    expect(composed.blocks).toContainEqual({ type: "cardStart", title: "Entries" });
    expect(composed.blocks).toContainEqual({
      type: "table",
      columns: [
        { heading: "Date", weight: (100 * 2) / 3, alignment: "start" },
        { heading: "Amount", weight: 100 / 3, alignment: "end" },
      ],
      rows: [["2026-07-01", "$10.00"]],
    });
    expect(composed.blocks.slice(-3)).toEqual([
      { type: "cardStart", title: "Holds" },
      { type: "paragraph", text: "Nothing to show." },
      { type: "cardEnd" },
    ]);
    expect(composed.page.paper).toBe("letter");
    expect(composed.page.landscape).toBeUndefined();
    expect(composed.created).toMatchObject({ year: 2026, month: 8, day: 1, hour: 15 });
  });

  it("runs a long section over several pages, each headed with its place", () => {
    const long: TabularExportDocument = {
      ...narrow,
      sections: [
        {
          title: "Entries",
          headers: ["Date", "Amount"],
          rows: Array.from({ length: 200 }, (_, index) => [String(index), "$1.00"]),
          endAlignedColumns: [1],
        },
      ],
    };
    const titles = composeExportDocument(long)
      .blocks.filter((block) => block.type === "cardStart")
      .map((block) => block.title);
    expect(titles.length).toBeGreaterThan(1);
    expect(titles[0]).toBe(`Entries (1 of ${String(titles.length)})`);
  });

  it("turns a wide report's pages to landscape", () => {
    const aging = reportExportDocument(
      presentAccountsReceivableAging(sampleAccountsReceivableAging()),
      GENERATED_AT,
    );
    expect(composeExportDocument(aging).page?.landscape).toBe(true);
  });

  it("composes a report into a real PDF with the platform's composer", async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@magna-carta/pdf-compose/src/pkg/pdf_compose_core_bg.wasm");
    await ensureReady(await readFile(wasmPath));
    const aging = reportExportDocument(
      presentAccountsReceivableAging(sampleAccountsReceivableAging()),
      GENERATED_AT,
    );
    const composed = await composeReadable((typeface) =>
      composeDocument(
        { ...composeExportDocument(aging), ...(typeface ? { typeface } : {}) },
        housePictures(),
      ),
    );
    expect(new TextDecoder().decode(composed.pdf.slice(0, 5))).toBe("%PDF-");
    expect(composed.pageCount).toBeGreaterThan(0);
    expect(composed.missingCharacters).toEqual([]);
  });
});
