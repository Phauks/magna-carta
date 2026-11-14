/*
 * The one shape every data export renders from — a titled document of table sections. A surface
 * that wants "download this" builds one of these from what it already shows and picks a renderer;
 * a new format is a new renderer over this same shape, never a per-page rewrite of the figures.
 *
 * Four formats render client-side: plain text, CSV, an Excel workbook and a PDF (render-text.ts,
 * render-csv.ts, render-xlsx.ts, render-pdf.ts). The PDF is composed by the platform's PDF composer,
 * the one way a tabular export becomes a PDF. Word renders server-side through render-remote.ts,
 * because document assembly's guarded writer is the platform's one writer of a word-processing
 * package; Word may not grow a client-side generator here, and a PDF may not grow a second path.
 */
import { formatInstantDate, formatTimeOfDay } from "@magna-carta/design-system/formatters";
import { saveToTarget } from "./save-target.ts";

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
  /**
   * Column indexes whose cells read as figures and sit against the right edge, the way the screen's
   * own tables draw them. The client renderers do not consume it (text and CSV are column-plain,
   * and spreadsheet software aligns real numbers itself); the server-rendered document formats do.
   */
  readonly endAlignedColumns?: readonly number[];
  /**
   * What sets each row apart, by position: `total` is the payload's total under the rows, `child`
   * a part of the row above it (a client's matter). Only the PDF consumes it. A child row's first
   * cell still carries `CHILD_ROW_INDENT`, so the text, CSV, spreadsheet and Word files, which
   * draw no row styles, show the nesting the same way they always have.
   */
  readonly rowKinds?: readonly ("total" | "child" | null)[];
}

/** The leading spaces a child row's first cell carries in the files that draw no row styles. */
export const CHILD_ROW_INDENT = "    ";

/** A figure the document opens with: the report's own total, formatted. Only the PDF prints it. */
export interface TabularExportFigure {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  /** A figure a reader should not pass over, such as debt over ninety days. */
  readonly alert?: true;
}

export interface TabularExportDocument {
  readonly title: string;
  readonly generatedAt: Date;
  readonly sections: readonly TabularExportSection[];
  /**
   * The row of totals, where the report opens with one. Neither this nor `rowKinds` is kept on
   * the download shelf, whose stored shape the server validates; a re-download prints the plain
   * rows, which still read correctly.
   */
  readonly summary?: readonly TabularExportFigure[];
}

/**
 * An export that could not be rendered, carrying words fit to show the member as they stand, and the
 * Error ID where a server answered with one. Both renderers that can fail this way throw it: the
 * server's Word printer (render-remote.ts) and the browser's PDF composer (render-pdf.ts).
 */
export class ExportRenderError extends Error {
  readonly errorId: string | undefined;
  constructor(message: string, errorId?: string) {
    super(message);
    this.name = "ExportRenderError";
    this.errorId = errorId;
  }
}

/** The cell's printed face — what the text and CSV renderers write. */
export function exportCellText(cell: TabularExportCell): string {
  return typeof cell === "string" ? cell : cell.text;
}

/*
 * The generation stamp every renderer opens with, as two lines: the date, then the time on its own
 * line carrying the time zone's name. The instant is the reader's own clock (the document is built
 * in the browser from `new Date()`), and naming the zone in the file is what makes that
 * self-evident to whoever the file is forwarded to.
 */
export function exportGeneratedDateLine(exportDocument: TabularExportDocument): string {
  return `Generated ${formatInstantDate(exportDocument.generatedAt)}`;
}

export function exportGeneratedTimeLine(exportDocument: TabularExportDocument): string {
  return formatTimeOfDay(exportDocument.generatedAt, { precision: "second", zoneName: true });
}

/**
 * The saved file's name: the report's own title, then the local date and a readable time to the
 * second — exported figures recompute on every read, so two files from one day are two snapshots
 * and must sort and read apart. Characters no filesystem accepts are dropped, never failed on.
 */
export function exportFilename(exportDocument: TabularExportDocument, extension: string): string {
  const safeTitle = exportDocument.title
    .replaceAll(/[\\/:*?"<>|]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const stamp = exportDocument.generatedAt;
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
  const time = `${pad(stamp.getHours())}-${pad(stamp.getMinutes())}-${pad(stamp.getSeconds())}`;
  return `${safeTitle} ${date} ${time}.${extension}`;
}

/*
 * Hand the rendered bytes over as a saved file — the ONE seam every download in the app passes
 * through, which is what makes where they land a single decision rather than four.
 *
 * The destination logic lives in save-target.ts; this stays the name every caller knows. It resolves
 * to where the file went ("folder" | "browser") so a surface can say so, and it never rejects: a
 * chosen folder that cannot be written falls back to the ordinary download inside that module,
 * because a folder is a convenience and the file is the point.
 */
export function saveExport(
  content: string | Blob,
  filename: string,
  contentType: string,
): Promise<"folder" | "browser"> {
  return saveToTarget(content, filename, contentType);
}
