import { describe, expect, it } from "vitest";
import type { RecognizedPage } from "../src/lib/tools/file-workbench/file-tools-api.ts";
import {
  corruptionName,
  documentText,
  markedName,
  pageReading,
  recoverabilityOf,
} from "../src/lib/tools/file-workbench/file-tools-reading.ts";

function page(
  pageIndex: number,
  confidences: number[],
  extra: Partial<RecognizedPage> = {},
): RecognizedPage {
  return {
    pageIndex,
    lines: confidences.map((confidence, index) => ({ text: `line ${index + 1}`, confidence })),
    undecodedRegions: 0,
    ...extra,
  };
}

describe("pageReading", () => {
  it("tells the five kinds of page apart", () => {
    expect(pageReading(page(0, [0.99, 0.95]))).toBe("recognized");
    expect(pageReading(page(0, [0.5, 0.7]))).toBe("low-confidence");
    expect(pageReading(page(0, [], { skipped: "hasTextLayer" }))).toBe("already-text");
    expect(pageReading(page(0, [], { undecodedRegions: 3 }))).toBe("unreadable");
    expect(pageReading(page(0, []))).toBe("no-text");
  });
});

describe("documentText", () => {
  it("heads each page that has text and skips the rest", () => {
    expect(documentText([page(0, [0.9]), page(1, []), page(2, [0.9, 0.9])])).toBe(
      "Page 1\n\nline 1\n\nPage 3\n\nline 1\nline 2",
    );
  });
});

describe("the repair words", () => {
  it("names every verdict and finding, and falls back for one it does not know", () => {
    const diagnosis = {
      detectedFormat: "docx",
      corruption: [],
      repairSupported: true,
      carveSuggested: false,
      detail: "",
    };
    expect(recoverabilityOf({ ...diagnosis, recoverability: "partial" }).label).toBe(
      "Partly Repairable",
    );
    expect(recoverabilityOf({ ...diagnosis, recoverability: "something new" }).label).toBe(
      "Not Recognized",
    );
    expect(corruptionName("truncated")).toBe("The file stops before its end");
    expect(corruptionName("unheard-of")).toBe("Other damage");
  });
});

describe("markedName", () => {
  it("marks the copy and can change its extension", () => {
    expect(markedName("Q3 Ledger.xlsx", "repaired")).toBe("Q3 Ledger (repaired).xlsx");
    expect(markedName("Lease.jpg", "text", "txt")).toBe("Lease (text).txt");
    expect(markedName("scan", "searchable", "pdf")).toBe("scan (searchable).pdf");
  });
});
