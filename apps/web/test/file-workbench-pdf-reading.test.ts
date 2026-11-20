import { describe, expect, it } from "vitest";
import {
  describeBates,
  describeForm,
  describePages,
  describeProtection,
  pageSizeName,
  toolRowsFor,
} from "../src/lib/tools/file-workbench/pdf-reading.ts";
import type { PdfSummary } from "../src/lib/pdf-editor/pdf-summary.ts";

const LETTER = { widthPt: 612, heightPt: 792 };

const summary = (change: Partial<PdfSummary> = {}): PdfSummary => ({
  needsPassword: false,
  encrypted: false,
  limits: [],
  pages: [LETTER, LETTER],
  form: { fields: 23, filled: 0 },
  bates: null,
  ...change,
});

describe("the PDF tab's rows", () => {
  it("names paper sizes a person knows, either way up, and measures the rest", () => {
    expect(pageSizeName(LETTER)).toBe("Letter");
    expect(pageSizeName({ widthPt: 595, heightPt: 842 })).toBe("A4");
    expect(pageSizeName({ widthPt: 1008, heightPt: 612 })).toBe("Legal landscape");
    expect(pageSizeName({ widthPt: 360, heightPt: 504 })).toBe("5 × 7 in");
  });

  it("counts the pages and says when their sizes differ", () => {
    expect(describePages(Array.from({ length: 6 }, () => LETTER))).toBe("6 · Letter");
    expect(describePages([LETTER, { widthPt: 612, heightPt: 1008 }])).toBe("2 · Mixed sizes");
    expect(describePages([])).toBe("None");
  });

  it("says how much of the form is filled", () => {
    expect(describeForm({ fields: 23, filled: 0 })).toBe("23 fields, none filled");
    expect(describeForm({ fields: 23, filled: 4 })).toBe("23 fields, 4 filled");
    expect(describeForm({ fields: 1, filled: 1 })).toBe("1 field, all filled");
    expect(describeForm(null)).toBe("None");
  });

  it("tells a password to open from limits alone", () => {
    expect(describeProtection({ needsPassword: false, encrypted: false, limits: [] })).toEqual({
      value: "None",
    });
    expect(describeProtection({ needsPassword: true, encrypted: true, limits: [] }).value).toBe(
      "Needed to open",
    );
    expect(
      describeProtection({
        needsPassword: false,
        encrypted: true,
        limits: ["printing", "copying"],
      }),
    ).toEqual({
      value: "Limits only",
      note: "No printing or copying.",
    });
  });

  it("states the range of labels found, and how many pages carry one", () => {
    expect(describeBates(null, 6)).toEqual({ value: "None found" });
    expect(
      describeBates({ first: "SMITH000001", last: "SMITH000006", pagesLabelled: 6 }, 6),
    ).toEqual({ value: "SMITH000001 to SMITH000006", note: "On 6 of 6 pages" });
  });
});

describe("the tools a bench file can open", () => {
  it("lists the editor's six, Bates shut with its reason", () => {
    const rows = toolRowsFor(summary());
    expect(rows.map((row) => row.tool.label)).toEqual([
      "Pages",
      "Redact",
      "Forms",
      "Bates",
      "Watermark",
      "Secure",
    ]);
    const bates = rows.find((row) => row.tool.id === "bates");
    expect(bates?.availability.available).toBe(false);
    expect(bates?.description).toMatch(/matter/);
    expect(rows.find((row) => row.tool.id === "forms")?.description).toBe(
      "Fill the 23 fields, or flatten them",
    );
  });

  it("shuts Forms on a PDF with no form, and every tool on one that needs a password", () => {
    const formless = toolRowsFor(summary({ form: null }));
    expect(formless.find((row) => row.tool.id === "forms")?.availability.available).toBe(false);

    const locked = toolRowsFor(summary({ needsPassword: true, pages: [], form: null }));
    expect(locked.every((row) => !row.availability.available)).toBe(true);
  });

  it("lists every tool as it is before the file is read", () => {
    const rows = toolRowsFor(null);
    expect(rows.filter((row) => row.availability.available)).toHaveLength(5);
  });
});
