/*
 * The plain-text renderer — aligned columns that paste into an email and open anywhere, the
 * delivery the speed test settled on. First column left-aligned, every other column right-aligned,
 * because the figures sit to the right in every on-screen table this renders.
 */
import type { TabularExportDocument, TabularExportSection } from "./tabular-export.ts";

function renderTable(section: TabularExportSection): string {
  const widths = section.headers.map((header, columnIndex) =>
    Math.max(header.length, ...section.rows.map((row) => (row[columnIndex] ?? "").length)),
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
  return [renderRow(section.headers), ...section.rows.map(renderRow)].join("\n");
}

export function renderTextExport(exportDocument: TabularExportDocument): string {
  const sections = exportDocument.sections.map(
    (section) => `${section.title.toUpperCase()}\n\n${renderTable(section)}`,
  );
  return [
    exportDocument.title.toUpperCase(),
    `Generated ${exportDocument.generatedAt.toLocaleString()}`,
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}
