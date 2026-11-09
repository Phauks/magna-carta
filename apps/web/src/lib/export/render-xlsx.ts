/*
 * The Excel workbook renderer, in two layouts the menu offers side by side: one worksheet per
 * section behind a cover sheet, or everything stacked on a single worksheet. Both open with the
 * report's title and the instant it was generated — a workbook is a file that outlives the page,
 * so it says when its figures were true. Counts are typed number cells wherever the document
 * carries a figure, so a reader can sum a column instead of fighting text that looks like a
 * number. Built on write-excel-file (adopted by the owner, 2026-08-31 — the decision record beside
 * the export seam holds the evaluation), whose version is pinned exactly and whose import happens
 * lazily here, so no page pays the library's weight until someone actually exports a spreadsheet.
 */
import {
  exportGeneratedDateLine,
  exportGeneratedTimeLine,
  type TabularExportCell,
  type TabularExportDocument,
  type TabularExportSection,
} from "./tabular-export.ts";

export type XlsxLayout = "worksheet-per-section" | "single-worksheet";

/** Grouped whole numbers — the one figure kind the export document carries today. */
const COUNT_NUMBER_FORMAT = "#,##0";

/** Excel refuses sheet names over 31 characters or carrying \ / ? * [ ] : — sanitize, never fail. */
export function worksheetName(sectionTitle: string): string {
  const cleaned = sectionTitle
    .replaceAll(/[\\/?*[\]:]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return (cleaned === "" ? "Sheet" : cleaned).slice(0, 31);
}

export interface WorksheetCellPlan {
  readonly value: string | number;
  /** The library requires the cell's type stated explicitly wherever a format is given. */
  readonly type?: NumberConstructor;
  readonly format?: string;
  readonly fontWeight?: "bold";
  readonly align?: "right";
}

export interface WorksheetPlan {
  readonly sheet: string;
  readonly columns: readonly { readonly width: number }[];
  readonly stickyRowsCount: number;
  readonly data: readonly (readonly WorksheetCellPlan[])[];
}

function cellPlan(cell: TabularExportCell): WorksheetCellPlan {
  if (typeof cell === "string") return { value: cell };
  // A workbook that carries NaN or Infinity in a number cell is one Excel refuses and offers to
  // repair, so a figure that is not a finite number falls back to its text face — the file stays
  // openable and the cell still says something true.
  if (!Number.isFinite(cell.number)) return { value: cell.text };
  return { value: cell.number, type: Number, format: COUNT_NUMBER_FORMAT };
}

function sectionHeaderRow(section: TabularExportSection): WorksheetCellPlan[] {
  return section.headers.map((header): WorksheetCellPlan => ({
    value: header,
    fontWeight: "bold",
  }));
}

function columnWidths(rows: readonly (readonly WorksheetCellPlan[])[]): { width: number }[] {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: columnCount }, (unused, columnIndex) => {
    const longest = Math.max(
      0,
      ...rows.map((row) => {
        const cell = row[columnIndex];
        return cell === undefined ? 0 : String(cell.value).length;
      }),
    );
    return { width: Math.min(Math.max(longest + 2, 10), 40) };
  });
}

/** The multi-worksheet layout's first sheet: what this file is, and when its figures were true. */
function coverPlan(exportDocument: TabularExportDocument): WorksheetPlan {
  const data: WorksheetCellPlan[][] = [
    [{ value: exportDocument.title, fontWeight: "bold" }],
    [{ value: exportGeneratedDateLine(exportDocument) }],
    [{ value: exportGeneratedTimeLine(exportDocument) }],
  ];
  return {
    sheet: worksheetName(exportDocument.title),
    columns: columnWidths(data),
    stickyRowsCount: 0,
    data,
  };
}

function sectionPlan(section: TabularExportSection): WorksheetPlan {
  const data = [sectionHeaderRow(section), ...section.rows.map((row) => row.map(cellPlan))];
  return {
    sheet: worksheetName(section.title),
    columns: columnWidths(data),
    stickyRowsCount: 1,
    data,
  };
}

/** Everything stacked on one worksheet: title, generated line, then each section under its name. */
function singleWorksheetPlan(exportDocument: TabularExportDocument): WorksheetPlan {
  const data: WorksheetCellPlan[][] = [
    [{ value: exportDocument.title, fontWeight: "bold" }],
    [{ value: exportGeneratedDateLine(exportDocument) }],
    [{ value: exportGeneratedTimeLine(exportDocument) }],
  ];
  for (const section of exportDocument.sections) {
    data.push(
      [],
      [{ value: section.title, fontWeight: "bold" }],
      sectionHeaderRow(section),
      ...section.rows.map((row) => row.map(cellPlan)),
    );
  }
  return {
    sheet: worksheetName(exportDocument.title),
    columns: columnWidths(data),
    stickyRowsCount: 0,
    data,
  };
}

/** Two sheets must never share a name — Excel refuses the workbook — so later takes get a suffix. */
function uniquelyNamed(worksheets: readonly WorksheetPlan[]): readonly WorksheetPlan[] {
  const taken = new Set<string>();
  return worksheets.map((worksheet) => {
    let name = worksheet.sheet;
    let attempt = 2;
    while (taken.has(name)) {
      const suffix = ` (${attempt})`;
      name = worksheet.sheet.slice(0, 31 - suffix.length) + suffix;
      attempt += 1;
    }
    taken.add(name);
    return { ...worksheet, sheet: name };
  });
}

/**
 * The whole workbook as plain data, split from the library call so the mapping is unit-testable
 * without writing a file.
 */
export function workbookPlan(
  exportDocument: TabularExportDocument,
  layout: XlsxLayout,
): readonly WorksheetPlan[] {
  if (layout === "single-worksheet") return [singleWorksheetPlan(exportDocument)];
  return uniquelyNamed([coverPlan(exportDocument), ...exportDocument.sections.map(sectionPlan)]);
}

export async function renderXlsxExport(
  exportDocument: TabularExportDocument,
  layout: XlsxLayout,
): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const sheets = workbookPlan(exportDocument, layout).map((worksheet) => ({
    sheet: worksheet.sheet,
    columns: worksheet.columns.map((column) => ({ width: column.width })),
    stickyRowsCount: worksheet.stickyRowsCount,
    data: worksheet.data.map((row) => row.map((cell) => ({ ...cell }))),
  }));
  return writeXlsxFile(sheets).toBlob();
}
