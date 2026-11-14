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
 * `composeExportDocument` is the pure mapping onto the house document, tested on its own. Every cell goes down to its printed
 * face, as the Word renderer does; the number face is a spreadsheet's concern.
 */
import {
  card,
  figures,
  houseDocument,
  pagedTable,
  styledTable,
  tablePages,
  type HouseBlock,
  type HouseColumn,
  type HouseDocument,
  type HouseRow,
} from "@magna-carta/house-document";
import {
  CHILD_ROW_INDENT,
  ExportRenderError,
  exportCellText,
  exportGeneratedDateLine,
  exportGeneratedTimeLine,
  type TabularExportDocument,
  type TabularExportSection,
} from "./tabular-export.ts";

/** Past this many columns in any section, the pages turn to landscape so a row keeps to one line. */
const LANDSCAPE_FROM_COLUMNS = 7;

/**
 * A section's columns, sharing the width out of a hundred. The first column names the row (a
 * client, an office) and takes twice the share of a figure column.
 */
function sectionColumns(section: TabularExportSection): HouseColumn[] {
  const endAligned = new Set(section.endAlignedColumns ?? []);
  const shares = section.headers.map((_, columnIndex) => (columnIndex === 0 ? 2 : 1));
  const whole = shares.reduce((sum, share) => sum + share, 0);
  return section.headers.map((heading, columnIndex) => ({
    heading,
    weight: (100 * (shares[columnIndex] ?? 1)) / whole,
    alignment: endAligned.has(columnIndex) ? "end" : "start",
  }));
}

/**
 * The PDF the composer will draw for an export document, in the house style
 * (@magna-carta/house-document): the letterhead, margins, typeface and page number every generated
 * document shares. Each section is a card; a section too long for one page runs over several, each
 * headed with its place ("By Client (2 of 3)"). A report's totals open the document as figures
 * across the page; a section whose rows carry kinds is one styled table, the total in bold under a
 * darker rule and a client's matters stepped in, which the composer carries over pages itself.
 */
export function composeExportDocument(exportDocument: TabularExportDocument): HouseDocument {
  const widest = Math.max(0, ...exportDocument.sections.map((section) => section.headers.length));
  const landscape = widest >= LANDSCAPE_FROM_COLUMNS ? (true as const) : undefined;
  const blocks: HouseBlock[] = [
    {
      type: "paragraph",
      text: `${exportGeneratedDateLine(exportDocument)}, ${exportGeneratedTimeLine(exportDocument)}`,
    },
  ];
  if (exportDocument.summary !== undefined && exportDocument.summary.length > 0) {
    blocks.push(figures(exportDocument.summary));
  }
  for (const section of exportDocument.sections) {
    if (section.rows.length === 0) {
      blocks.push(...card(section.title, { type: "paragraph", text: "Nothing to show." }));
      continue;
    }
    const columns = sectionColumns(section);
    const rows = section.rows.map((row) => row.map(exportCellText));
    if (section.rowKinds !== undefined) {
      blocks.push(...card(section.title, styledTable(columns, styledRows(rows, section.rowKinds))));
      continue;
    }
    const pagingOptions = {
      ...(landscape === undefined ? {} : { landscape }),
      fittedColumns: section.endAlignedColumns ?? [],
    };
    if (tablePages(columns, rows, pagingOptions).length > 1) {
      blocks.push(...pagedTable(section.title, columns, rows, pagingOptions));
    } else {
      blocks.push(...card(section.title, { type: "table", columns, rows }));
    }
  }
  return houseDocument({
    name: exportDocument.title,
    created: exportDocument.generatedAt.toISOString(),
    ...(landscape === undefined ? {} : { landscape }),
    blocks,
  });
}

/**
 * Rows with their kinds. A child row's first cell loses the indent the plain files carry, because
 * the composer steps a child row in itself.
 */
function styledRows(
  rows: readonly (readonly string[])[],
  kinds: readonly ("total" | "child" | null)[],
): HouseRow[] {
  return rows.map((cells, rowIndex) => {
    const kind = kinds[rowIndex] ?? null;
    if (kind === null) return cells;
    if (kind === "total") return { cells, kind };
    const [first = "", ...rest] = cells;
    const stepped = first.startsWith(CHILD_ROW_INDENT)
      ? first.slice(CHILD_ROW_INDENT.length)
      : first;
    return { cells: [stepped, ...rest], kind };
  });
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
