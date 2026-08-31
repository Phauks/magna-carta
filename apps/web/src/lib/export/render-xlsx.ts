/*
 * The Excel workbook renderer — one worksheet per section, a bold frozen header row, and typed
 * number cells wherever the document carries a figure, so a reader can sum a column instead of
 * fighting text that looks like a number. Built on write-excel-file (adopted by the owner,
 * 2026-08-31 — the decision record beside the export seam holds the evaluation), whose version is
 * pinned exactly and whose import happens lazily here, so no page pays the library's weight until
 * someone actually exports a spreadsheet.
 */
import {
  exportCellText,
  type TabularExportCell,
  type TabularExportDocument,
} from "./tabular-export.ts";

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

/**
 * The whole workbook as plain data, split from the library call so the mapping is unit-testable
 * without writing a file.
 */
export function workbookPlan(exportDocument: TabularExportDocument): readonly WorksheetPlan[] {
  return exportDocument.sections.map((section) => {
    const headerRow = section.headers.map(
      (header): WorksheetCellPlan => ({ value: header, fontWeight: "bold" }),
    );
    const dataRows = section.rows.map((row) => row.map(cellPlan));
    const columns = section.headers.map((header, columnIndex) => {
      const longest = Math.max(
        header.length,
        ...section.rows.map((row) => {
          const cell = row[columnIndex];
          return cell === undefined ? 0 : exportCellText(cell).length;
        }),
      );
      return { width: Math.min(Math.max(longest + 2, 10), 40) };
    });
    return {
      sheet: worksheetName(section.title),
      columns,
      stickyRowsCount: 1,
      data: [headerRow, ...dataRows],
    };
  });
}

export async function renderXlsxExport(exportDocument: TabularExportDocument): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const sheets = workbookPlan(exportDocument).map((worksheet) => ({
    sheet: worksheet.sheet,
    columns: worksheet.columns.map((column) => ({ width: column.width })),
    stickyRowsCount: worksheet.stickyRowsCount,
    data: worksheet.data.map((row) => row.map((cell) => ({ ...cell }))),
  }));
  return writeXlsxFile(sheets).toBlob();
}
