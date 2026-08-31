import { describe, expect, it } from "vitest";
import { renderCsvExport } from "$lib/export/render-csv.ts";
import { renderTextExport } from "$lib/export/render-text.ts";
import { exportFilename } from "$lib/export/tabular-export.ts";
import type { FirmUsageResponse } from "$lib/tools/firm-usage/firm-usage-api.ts";
import { firmUsageExportDocument } from "$lib/tools/firm-usage/firm-usage-report.ts";

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
    { matterTypeName: "Estate Planning", prospective: 1, open: 1, closed: 0, total: 2 },
    { matterTypeName: null, prospective: 0, open: 0, closed: 1, total: 1 },
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

  it("sums the matters-by-type totals row and names the untyped bucket", () => {
    const matters = exportDocument.sections[1];
    expect(matters?.rows.some((row) => row[0] === "No Type Assigned")).toBe(true);
    expect(matters?.rows.at(-1)).toEqual(["Total", "1", "1", "1", "3"]);
  });

  it("states absences instead of dropping them", () => {
    const cells = exportDocument.sections.flatMap((section) => section.rows.flat());
    expect(cells).toContain("Not yet measured");
    expect(cells).toContain("Managed Search Storage");
    expect(cells).toContain("No Location Assigned");
  });

  it("rolls custody items into the location total, offsite included", () => {
    const byLocation = exportDocument.sections[3];
    expect(byLocation?.rows.some((row) => row[0] === "Held Offsite" && row[4] === "2")).toBe(true);
    expect(byLocation?.rows.at(-1)?.at(-1)).toBe("5");
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
    const cells = allLocated.sections.flatMap((section) => section.rows.flat());
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
      slug: "quoting",
      generatedAt: new Date(2026, 0, 1),
      sections: [{ title: "S", headers: ["A"], rows: [['Say "hi", twice']] }],
    });
    expect(csv).toContain('"Say ""hi"", twice"');
  });
});

describe("exportFilename", () => {
  it("stamps the file to the second in the local clock with padded parts", () => {
    const stamped = firmUsageExportDocument(usage, new Date(2026, 0, 5, 9, 7, 3));
    expect(exportFilename(stamped, "txt")).toBe("firm-usage-2026-01-05-090703.txt");
    expect(exportFilename(stamped, "csv")).toBe("firm-usage-2026-01-05-090703.csv");
  });
});
