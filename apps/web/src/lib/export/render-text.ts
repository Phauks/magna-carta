/*
 * The plain-text renderer — aligned columns that paste into an email and open anywhere, the
 * delivery the speed test settled on. First column left-aligned, every other column right-aligned,
 * because the figures sit to the right in every on-screen table this renders.
 */
import {
  exportCellText,
  exportGeneratedDateLine,
  exportGeneratedTimeLine,
  type TabularExportCell,
  type TabularExportDocument,
  type TabularExportSection,
} from "./tabular-export.ts";

function renderTable(section: TabularExportSection): string {
  const cellText = (row: readonly TabularExportCell[], columnIndex: number): string => {
    const cell = row[columnIndex];
    return cell === undefined ? "" : exportCellText(cell);
  };
  const widths = section.headers.map((header, columnIndex) =>
    Math.max(header.length, ...section.rows.map((row) => cellText(row, columnIndex).length)),
  );
  const renderRow = (row: readonly string[]): string =>
    row
      .map((cell, columnIndex) =>
        columnIndex === 0
          ? cell.padEnd(widths[columnIndex] ?? 0)
          : cell.padStart(widths[columnIndex] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [
    renderRow(section.headers),
    ...section.rows.map((row) => renderRow(row.map(exportCellText))),
  ].join("\n");
}

export function renderTextExport(exportDocument: TabularExportDocument): string {
  const sections = exportDocument.sections.map(
    (section) => `${section.title.toUpperCase()}\n\n${renderTable(section)}`,
  );
  return [
    exportDocument.title.toUpperCase(),
    exportGeneratedDateLine(exportDocument),
    exportGeneratedTimeLine(exportDocument),
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}
