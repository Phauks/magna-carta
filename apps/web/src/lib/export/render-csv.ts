/*
 * The CSV renderer — one file, each section as its title row, its header row, and its data rows,
 * separated by a blank line. Every spreadsheet application opens it, which is what "Excel export"
 * usually needs; a native .xlsx is a separate renderer behind a library decision, not a reason to
 * hold this one.
 *
 * The mechanics are the ones spreadsheet applications actually require: a UTF-8 byte-order mark so
 * Excel reads the encoding, CRLF row endings, and RFC 4180 quoting (a field carrying a comma,
 * quote, or line break is wrapped, with inner quotes doubled).
 */
import type { TabularExportDocument } from "./tabular-export.ts";

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function csvRow(row: readonly string[]): string {
  return row.map(csvField).join(",");
}

export function renderCsvExport(exportDocument: TabularExportDocument): string {
  const lines: string[] = [
    csvRow([exportDocument.title]),
    csvRow([`Generated ${exportDocument.generatedAt.toLocaleString()}`]),
    "",
  ];
  for (const section of exportDocument.sections) {
    lines.push(csvRow([section.title]), csvRow(section.headers));
    for (const row of section.rows) lines.push(csvRow(row));
    lines.push("");
  }
  return "\uFEFF" + lines.join("\r\n");
}
