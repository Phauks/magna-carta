import { describe, expect, it } from "vitest";
import { renderCsvExport } from "$lib/export/render-csv.ts";
import { renderTextExport } from "$lib/export/render-text.ts";
import { workbookPlan, worksheetName } from "$lib/export/render-xlsx.ts";
import { exportCellText, exportFilename } from "$lib/export/tabular-export.ts";
import type { FirmUsageResponse } from "$lib/firm-usage/firm-usage-api.ts";
import { firmUsageExportDocument } from "$lib/firm-usage/firm-usage-report.ts";

const usage: FirmUsageResponse = {
  storage: {
    totalBytes: 2048,
    totalObjects: 3,
    byStorageClass: {
      standard: { bytes: 1024, objects: 2 },
      infrequent_access: { bytes: 1024, objects: 1 },
    },
  },
  mattersByType: [
    {
      matterTypeName: "Estate Planning",
      intake: 0,
      consultation: 1,
      open: 1,
      hold: 0,
      closed: 0,
      total: 2,
    },
    { matterTypeName: null, intake: 0, consultation: 0, open: 0, hold: 0, closed: 1, total: 1 },
  ],
  files: {
    currentFiles: { count: 2, bytes: 1024 },
    priorVersions: { count: 1, bytes: 512 },
    allVersions: { count: 3, bytes: 1536 },
    deletedFiles: { count: 0, bytes: 0 },
  },
  byLocation: {
    rows: [{ name: "Main Office", status: "active", matters: 2, members: 4, custodyItems: 3 }],
    mattersWithoutLocation: 1,
    custodyItemsOffsite: 2,
  },
  directory: { people: 5, organizations: 2, activeMembers: 4 },
  aiUsage: {
    magnusTokens: { inputTokens: 1_000_000, outputTokens: 250_000, requests: 42 },
    searchQueries: { semantic: 7, fullText: 8 },
    detection: { requests: 3, words: 900 },
    notMetered: ["managed index storage"],
  },
};

const exportDocument = firmUsageExportDocument(usage, new Date(2026, 7, 31, 12, 0, 0));

describe("firmUsageExportDocument", () => {
  it("carries every section in page order", () => {
    expect(exportDocument.sections.map((section) => section.title)).toEqual([
      "Storage",
      "Matters by Type",
      "Files and Versioning",
      "By Location",
      "People and Organizations",
      "AI Usage",
      "Compute and Activity",
    ]);
  });

  it("end-aligns every figure column and only figure columns", () => {
    for (const section of exportDocument.sections) {
      const aligned = section.endAlignedColumns ?? [];
      expect(aligned.length).toBeGreaterThan(0);
      // The first column is always the row's label, never a figure.
      expect(aligned).not.toContain(0);
      for (const columnIndex of aligned) {
        expect(columnIndex).toBeLessThan(section.headers.length);
      }
    }
  });

  it("sums the matters-by-type totals row and names the untyped bucket", () => {
    const matters = exportDocument.sections[1];
    expect(matters?.rows.some((row) => row[0] === "No Type Assigned")).toBe(true);
    expect(matters?.rows.at(-1)?.map(exportCellText)).toEqual([
      "Total",
      "0",
      "1",
      "1",
      "0",
      "1",
      "3",
    ]);
  });

  it("states absences instead of dropping them", () => {
    const cells = exportDocument.sections.flatMap((section) =>
      section.rows.flat().map(exportCellText),
    );
    expect(cells).toContain("Not yet measured");
    expect(cells).toContain("Managed Search Storage");
    expect(cells).toContain("No Location Assigned");
  });

  it("rolls custody items into the location total, offsite included", () => {
    const byLocation = exportDocument.sections[3];
    expect(
      byLocation?.rows.some(
        (row) => row[0] === "Held Offsite" && exportCellText(row[4] ?? "") === "2",
      ),
    ).toBe(true);
    const totalsRow = byLocation?.rows.at(-1);
    expect(exportCellText(totalsRow?.at(-1) ?? "")).toBe("5");
  });

  it("omits the no-location row when every matter has a location", () => {
    const allLocated = firmUsageExportDocument(
      {
        ...usage,
        byLocation: {
          rows: usage.byLocation.rows,
          mattersWithoutLocation: 0,
          custodyItemsOffsite: 0,
        },
      },
      new Date(),
    );
    const cells = allLocated.sections.flatMap((section) => section.rows.flat().map(exportCellText));
    expect(cells).not.toContain("No Location Assigned");
  });
});

describe("renderTextExport", () => {
  const report = renderTextExport(exportDocument);

  it("reports the figures through the shared formatters", () => {
    expect(report).toContain("1,000,000");
    expect(report).toContain("1.0 KB");
    expect(report).toContain("50.0%");
  });

  it("uppercases the title and each section heading", () => {
    expect(report.startsWith("FIRM USAGE\n")).toBe(true);
    expect(report).toContain("\nMATTERS BY TYPE\n");
  });
});

describe("renderCsvExport", () => {
  it("leads with the byte-order mark and ends rows with CRLF", () => {
    const csv = renderCsvExport(exportDocument);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Storage Class,Objects,Size,Share\r\n");
  });

  it("quotes a field carrying a comma and doubles inner quotes", () => {
    const csv = renderCsvExport({
      title: "Quoting",
      generatedAt: new Date(2026, 0, 1),
      sections: [{ title: "S", headers: ["A"], rows: [['Say "hi", twice']] }],
    });
    expect(csv).toContain('"Say ""hi"", twice"');
  });
});

describe("workbookPlan", () => {
  const worksheets = workbookPlan(exportDocument, "worksheet-per-section");

  it("leads with a cover sheet naming the report and its instant, then one sheet per section", () => {
    expect(worksheets.map((worksheet) => worksheet.sheet)).toEqual([
      "Firm Usage",
      "Storage",
      "Matters by Type",
      "Files and Versioning",
      "By Location",
      "People and Organizations",
      "AI Usage",
      "Compute and Activity",
    ]);
    const coverSheet = worksheets[0];
    expect(coverSheet?.data[0]?.[0]).toEqual({ value: "Firm Usage", fontWeight: "bold" });
    expect(String(coverSheet?.data[1]?.[0]?.value)).toMatch(/^Generated /);
    // The time stands on its own line, in the reader's clock with the zone named beside it.
    expect(String(coverSheet?.data[2]?.[0]?.value)).toMatch(/\d:\d\d:\d\d.*[A-Za-z]/);
    expect(String(coverSheet?.data[2]?.[0]?.value)).not.toMatch(/^Generated /);
    for (const worksheet of worksheets.slice(1)) {
      expect(worksheet.stickyRowsCount).toBe(1);
      expect(worksheet.data[0]?.every((cell) => cell.fontWeight === "bold")).toBe(true);
    }
  });

  it("stacks every section on one worksheet in the single-sheet layout", () => {
    const single = workbookPlan(exportDocument, "single-worksheet");
    expect(single).toHaveLength(1);
    const sheet = single[0];
    expect(sheet?.sheet).toBe("Firm Usage");
    expect(String(sheet?.data[1]?.[0]?.value)).toMatch(/^Generated /);
    expect(String(sheet?.data[2]?.[0]?.value)).toMatch(/\d:\d\d:\d\d.*[A-Za-z]/);
    const firstCells = (sheet?.data ?? []).map((row) => row[0]?.value);
    for (const sectionTitle of ["Storage", "Matters by Type", "AI Usage", "Compute and Activity"]) {
      expect(firstCells).toContain(sectionTitle);
    }
    expect(firstCells).toContain("Magnus Input Tokens");
  });

  it("writes counts as real number cells with the grouped format", () => {
    const aiUsage = worksheets[6];
    const inputTokensCell = aiUsage?.data[1]?.[1];
    expect(inputTokensCell).toEqual({ value: 1_000_000, type: Number, format: "#,##0" });
  });

  it("keeps stated absences as text cells", () => {
    const compute = worksheets[7];
    expect(compute?.data[1]?.[1]).toEqual({ value: "Not yet measured" });
  });

  it("sizes columns from content within bounds", () => {
    for (const worksheet of worksheets) {
      for (const column of worksheet.columns) {
        expect(column.width).toBeGreaterThanOrEqual(10);
        expect(column.width).toBeLessThanOrEqual(40);
      }
    }
  });
});

describe("workbookPlan hardening", () => {
  it("never writes a non-finite figure as a number cell", () => {
    const worksheets = workbookPlan(
      {
        title: "Hardening",
        generatedAt: new Date(2026, 0, 1),
        sections: [
          {
            title: "S",
            headers: ["A", "B"],
            rows: [
              [
                { text: "-", number: Number.NaN },
                { text: "?", number: Number.POSITIVE_INFINITY },
              ],
            ],
          },
        ],
      },
      "single-worksheet",
    );
    expect(worksheets[0]?.data.at(-1)).toEqual([{ value: "-" }, { value: "?" }]);
  });
});

describe("worksheetName", () => {
  it("strips the characters Excel refuses and bounds the length", () => {
    expect(worksheetName("A/B: C?*[]")).toBe("A B C");
    expect(worksheetName("x".repeat(40)).length).toBe(31);
  });
});

describe("exportFilename", () => {
  it("stamps the file to the second in the local clock with padded parts", () => {
    const stamped = firmUsageExportDocument(usage, new Date(2026, 0, 5, 9, 7, 3));
    expect(exportFilename(stamped, "txt")).toBe("Firm Usage 2026-01-05 09-07-03.txt");
    expect(exportFilename(stamped, "xlsx")).toBe("Firm Usage 2026-01-05 09-07-03.xlsx");
  });
});
