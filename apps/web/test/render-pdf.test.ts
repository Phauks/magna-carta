/*
 * A tabular export as a PDF: the mapping onto the composer's document, and the composer itself run
 * over a report, so the file the menu hands over is proved to be a PDF and not only a shape.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
  it("draws the title, the generation stamp, a heading and a table per section", () => {
    const composed = composeExportDocument(narrow);
    expect(composed.blocks[0]).toEqual({ type: "title", text: "Ledger" });
    expect(composed.blocks).toContainEqual({ type: "heading", level: 2, text: "Entries" });
    expect(composed.blocks).toContainEqual({
      type: "table",
      columns: [
        { heading: "Date", alignment: "start" },
        { heading: "Amount", alignment: "end" },
      ],
      rows: [["2026-07-01", "$10.00"]],
    });
    expect(composed.blocks.at(-1)).toEqual({
      type: "paragraph",
      small: true,
      text: "Nothing to show.",
    });
    expect(composed.page).toEqual({ paper: "letter", landscape: false });
    expect(composed.created).toMatchObject({ year: 2026, month: 8, day: 1, hour: 15 });
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
    const composed = await composeDocument(composeExportDocument(aging));
    expect(new TextDecoder().decode(composed.pdf.slice(0, 5))).toBe("%PDF-");
    expect(composed.pageCount).toBeGreaterThan(0);
    expect(composed.missingCharacters).toEqual([]);
  });
});
