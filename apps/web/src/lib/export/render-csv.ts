/*
 * The CSV renderer — one file, each section as its title row, its header row, and its data rows,
 * separated by a blank line. Every spreadsheet application opens it; the native Excel workbook
 * (render-xlsx.ts) is the richer sibling with real number cells and one worksheet per section.
 *
 * The mechanics are the ones spreadsheet applications actually require: a UTF-8 byte-order mark so
 * Excel reads the encoding, CRLF row endings, and RFC 4180 quoting (a field carrying a comma,
 * quote, or line break is wrapped, with inner quotes doubled).
 */
import {
  exportCellText,
  exportGeneratedDateLine,
  exportGeneratedTimeLine,
  type TabularExportCell,
  type TabularExportDocument,
} from "./tabular-export.ts";

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function csvRow(row: readonly TabularExportCell[]): string {
  return row.map((cell) => csvField(exportCellText(cell))).join(",");
}

export function renderCsvExport(exportDocument: TabularExportDocument): string {
  const lines: string[] = [
    csvRow([exportDocument.title]),
    csvRow([exportGeneratedDateLine(exportDocument)]),
    csvRow([exportGeneratedTimeLine(exportDocument)]),
    "",
  ];
  for (const section of exportDocument.sections) {
    lines.push(csvRow([section.title]), csvRow(section.headers));
    for (const row of section.rows) lines.push(csvRow(row));
    lines.push("");
  }
  return "\uFEFF" + lines.join("\r\n");
}
