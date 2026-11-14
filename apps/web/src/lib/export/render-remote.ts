/*
 * The server-rendered export format: Word. A PDF is composed in the browser (render-pdf.ts). The client holds the whole document already, so
 * the endpoint is a printer, not a data source — this module maps the page's export document down
 * to the wire shape (text faces only; the number face is a spreadsheet concern) and asks
 * POST /api/v1/reports/exports for the file's bytes.
 *
 * requestJson in $lib/api/request.ts is deliberately JSON-only; this call's success body is the
 * file itself, so the transport lives here, with the same problem-document reading.
 */
import {
  ExportRenderError,
  exportCellText,
  exportGeneratedDateLine,
  exportGeneratedTimeLine,
  type TabularExportDocument,
} from "./tabular-export.ts";

export type RemoteRenderFormat = "docx";

/** Mirrors @magna-carta/export-document's renderable shape (the OpenAPI ExportRenderRequest body). */
export interface RenderableExportSection {
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly endAlignedColumns?: readonly number[];
}

export interface RenderableExportDocument {
  readonly title: string;
  readonly stampLines: readonly string[];
  readonly sections: readonly RenderableExportSection[];
}

/** A render the server refused or could not perform, carrying its own words for the toast. */
export class RemoteRenderError extends ExportRenderError {
  constructor(message: string, errorId?: string) {
    super(message, errorId);
    this.name = "RemoteRenderError";
  }
}

/** The wire document: every cell down to its printed face, the stamp as the two rendered lines. */
export function renderableFromExport(
  exportDocument: TabularExportDocument,
): RenderableExportDocument {
  return {
    title: exportDocument.title,
    stampLines: [exportGeneratedDateLine(exportDocument), exportGeneratedTimeLine(exportDocument)],
    sections: exportDocument.sections.map((section) => ({
      title: section.title,
      headers: section.headers,
      rows: section.rows.map((row) => row.map(exportCellText)),
      ...(section.endAlignedColumns !== undefined && {
        endAlignedColumns: section.endAlignedColumns,
      }),
    })),
  };
}

async function renderFailure(response: Response): Promise<RemoteRenderError> {
  let detail: string | undefined;
  let errorId: string | undefined;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.detail === "string") detail = body.detail;
    if (typeof body.errorId === "string") errorId = body.errorId;
  } catch {
    // A non-JSON failure body still yields a usable error carrying the HTTP status.
  }
  return new RemoteRenderError(
    detail ?? `The server could not render the export (HTTP ${String(response.status)}).`,
    errorId,
  );
}

/** Render the export document into a file server-side. Resolves to the file's bytes, or throws a RemoteRenderError with the server's own words. */
export async function renderRemoteExport(
  exportDocument: TabularExportDocument,
  format: RemoteRenderFormat,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetchImpl("/api/v1/reports/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format, document: renderableFromExport(exportDocument) }),
    });
  } catch {
    throw new RemoteRenderError(
      "The export could not reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) throw await renderFailure(response);
  return await response.blob();
}
