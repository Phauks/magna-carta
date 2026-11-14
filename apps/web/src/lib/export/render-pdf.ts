/*
 * A tabular export as a PDF, composed by the platform's PDF composer (@magna-carta/pdf-compose, the
 * crates/pdf-compose-core engine compiled to WebAssembly). This is THE way a tabular export becomes a
 * PDF: the report run screen, the bulk download, the download tray, a conflicts report and a
 * Directory printout all come here. The server's export route renders Word only.
 *
 * IT RUNS IN THE BROWSER, OFF THE MAIN THREAD. The document is already in the page, the engine is
 * memory-safe Rust, and composing in a Web Worker (render-pdf.worker.ts) keeps a long report from
 * stalling the screen while it lays out pages. Web and desktop compose it the same way, and no
 * request leaves the device.
 *
 * `composeExportDocument` is the pure mapping, tested on its own. Every cell goes down to its printed
 * face, as the Word renderer does; the number face is a spreadsheet's concern.
 */
import type { ComposeBlock, ComposeDocument } from "@magna-carta/pdf-compose";
import {
  ExportRenderError,
  exportCellText,
  exportGeneratedDateLine,
  exportGeneratedTimeLine,
  type TabularExportDocument,
} from "./tabular-export.ts";

/** Past this many columns in any section, the pages turn to landscape so a row keeps to one line. */
const LANDSCAPE_FROM_COLUMNS = 7;

/** The PDF the composer will draw for an export document. */
export function composeExportDocument(exportDocument: TabularExportDocument): ComposeDocument {
  const blocks: ComposeBlock[] = [
    { type: "title", text: exportDocument.title },
    {
      type: "paragraph",
      small: true,
      text: `${exportGeneratedDateLine(exportDocument)}, ${exportGeneratedTimeLine(exportDocument)}`,
    },
  ];
  for (const section of exportDocument.sections) {
    const endAligned = new Set(section.endAlignedColumns ?? []);
    blocks.push({ type: "heading", level: 2, text: section.title });
    if (section.rows.length === 0) {
      blocks.push({ type: "paragraph", small: true, text: "Nothing to show." });
      continue;
    }
    blocks.push({
      type: "table",
      columns: section.headers.map((heading, columnIndex) => ({
        heading,
        alignment: endAligned.has(columnIndex) ? "end" : "start",
      })),
      rows: section.rows.map((row) => row.map(exportCellText)),
    });
  }
  const widest = Math.max(0, ...exportDocument.sections.map((section) => section.headers.length));
  const generated = exportDocument.generatedAt;
  return {
    title: exportDocument.title,
    language: "en-US",
    created: {
      year: generated.getUTCFullYear(),
      month: generated.getUTCMonth() + 1,
      day: generated.getUTCDate(),
      hour: generated.getUTCHours(),
      minute: generated.getUTCMinutes(),
      second: generated.getUTCSeconds(),
    },
    page: { paper: "letter", landscape: widest >= LANDSCAPE_FROM_COLUMNS },
    footer: { left: exportDocument.title, right: "Page {page} of {pages}" },
    blocks,
  };
}

/** A PDF the composer could not make, carrying words fit for the toast. */
export class PdfComposeError extends ExportRenderError {
  constructor(message: string) {
    super(message);
    this.name = "PdfComposeError";
  }
}

/** What the worker answers. */
export type PdfComposeReply =
  | { readonly kind: "done"; readonly pdf: ArrayBuffer }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Compose the export document into a PDF in a Web Worker. Resolves to the file, or throws a
 * PdfComposeError the export menu shows as it stands.
 */
export function renderPdfExport(exportDocument: TabularExportDocument): Promise<Blob> {
  const composeRequest = composeExportDocument(exportDocument);
  const worker = new Worker(new URL("./render-pdf.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<Blob>((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<PdfComposeReply>) => {
      worker.terminate();
      if (event.data.kind === "done") {
        resolve(new Blob([event.data.pdf], { type: "application/pdf" }));
      } else {
        reject(new PdfComposeError(event.data.reason));
      }
    });
    worker.addEventListener("error", () => {
      worker.terminate();
      reject(new PdfComposeError("Couldn't make the PDF on this device. Try again."));
    });
    worker.postMessage(composeRequest);
  });
}
