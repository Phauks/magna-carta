/*
 * The one shape every data export renders from — a titled document of table sections. A surface
 * that wants "download this" builds one of these from what it already shows and picks a renderer;
 * a new format is a new renderer over this same shape, never a per-page rewrite of the figures.
 *
 * Three formats render client-side (plain text, CSV, and an Excel workbook — see render-text.ts /
 * render-csv.ts / render-xlsx.ts). Document formats (.docx/.pdf) stay named seams: they belong to
 * document assembly server-side — the office suite is the platform's one renderer of a
 * word-processing package, and its conversion edge is the one way a PDF gets made, so neither
 * format may grow a second client-side generator here.
 */

/**
 * One table cell. A plain string renders as-is everywhere; a figure that spreadsheet software
 * should treat as a real number carries both faces — the formatted text the text and CSV renderers
 * print, and the number the Excel renderer writes so a reader can sum a column.
 */
export type TabularExportCell = string | { readonly text: string; readonly number: number };

export interface TabularExportSection {
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly TabularExportCell[])[];
}

export interface TabularExportDocument {
  readonly title: string;
  /** The filename stem, kebab-case ("firm-usage"). */
  readonly slug: string;
  readonly generatedAt: Date;
  readonly sections: readonly TabularExportSection[];
}

/** The cell's printed face — what the text and CSV renderers write. */
export function exportCellText(cell: TabularExportCell): string {
  return typeof cell === "string" ? cell : cell.text;
}

/**
 * The saved file's name, stamped to the second in the local clock so any two downloads sort and
 * read apart — exported figures recompute on every read, so two files from one day are two
 * snapshots.
 */
export function exportFilename(exportDocument: TabularExportDocument, extension: string): string {
  const stamp = exportDocument.generatedAt;
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
  const time = `${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
  return `${exportDocument.slug}-${date}-${time}.${extension}`;
}

/** Hand the rendered bytes to the browser as a saved file. */
export function saveExport(content: string | Blob, filename: string, contentType: string): void {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type: contentType }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
