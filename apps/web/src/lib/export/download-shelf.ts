/*
 * The client half of the download register — the member's shelf of what the platform made them.
 *
 * An export is kept as its DOCUMENT rather than as a rendered file, so one shelf item serves every
 * format and the figures stay frozen at the instant it was taken. Keeping is deliberately a separate
 * call from rendering: the render route is a stateless printer, and the three browser-rendered
 * formats never reach it at all, so the shelf would otherwise only ever hold half the exports.
 */
import {
  problemOutcome,
  readProblem,
  requestJson,
  requestLine,
  transportOutcome,
  type ApiOutcome,
} from "$lib/api/request.ts";
import type { TabularExportCell, TabularExportDocument } from "./tabular-export.ts";

export type ShelfItemKind = "artifact" | "snapshot";
export type ShelfItemProducer = "export" | "bundle" | "conversion";
export type ShelfItemState = "building" | "ready" | "failed" | "expired";

export interface ShelfItem {
  readonly id: string;
  readonly title: string;
  readonly kind: ShelfItemKind;
  readonly producer: ShelfItemProducer;
  readonly byteSize: number | null;
  readonly downloadedFormats: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: ShelfItemState;
}

export interface ShelfResponse {
  readonly items: readonly ShelfItem[];
}

export function readShelf(fetchImpl: typeof fetch): Promise<ApiOutcome<ShelfResponse>> {
  return requestJson<ShelfResponse>(fetchImpl, "/api/v1/downloads");
}

/*
 * Removal answers 204 with no body, so it deliberately does NOT go through requestJson: that helper
 * ends by parsing the body, and an empty one throws, which it reports as a dead transport. A member
 * would have seen "that item could not be removed" over a removal that succeeded, and the row would
 * have stayed on screen until the next read. The three outcomes are the same three; only the success
 * case differs, because success here is the absence of a body.
 */
export async function removeShelfItem(
  fetchImpl: typeof fetch,
  id: string,
): Promise<ApiOutcome<undefined>> {
  const path = `/api/v1/downloads/${encodeURIComponent(id)}`;
  const line = requestLine("DELETE", path);
  let response: Response;
  try {
    response = await fetchImpl(path, { method: "DELETE", headers: { accept: "application/json" } });
  } catch {
    return transportOutcome(line);
  }
  if (response.ok) return { kind: "ok", value: undefined };
  // The shared reader, rather than a local one: it takes every field the contract sends, so a
  // failure here carries the same handle and the same remedy as any other.
  return problemOutcome(await readProblem(response), line);
}

/**
 * Keep an export the member has just taken.
 *
 * Returns the OUTCOME rather than swallowing it. A failure here must not cost the member the
 * download they already have — so it is never thrown — but it must not be invisible either: this
 * was silent to begin with, and a document the register refused looked exactly like a download that
 * simply never reached the shelf, with nothing for anyone to act on.
 */
export function keepExportOnShelf(
  fetchImpl: typeof fetch,
  exportDocument: TabularExportDocument,
  format: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson<{ id: string }>(fetchImpl, "/api/v1/downloads/snapshots", {
    method: "POST",
    body: { title: exportDocument.title, format, document: storedFromExport(exportDocument) },
  });
}

/** The stored shape: what the screen built, cells keeping their number face where they have one. */
export interface StoredExportDocument {
  readonly title: string;
  readonly generatedAt: string;
  readonly sections: readonly {
    readonly title: string;
    readonly headers: readonly string[];
    readonly rows: readonly (readonly TabularExportCell[])[];
    readonly endAlignedColumns?: readonly number[];
  }[];
}

/*
 * A cell keeps its number face only when that number is REAL. The register's schema requires a
 * finite number on a two-faced cell and rejects the whole document otherwise, so one unmeasured
 * figure would cost the member the entire shelf item — the same failure the spreadsheet renderer
 * already guards against in `cellPlan`, arriving one layer along. The printed text is always
 * truthful on its own, so falling back to it loses nothing a reader can see.
 */
function storedCell(cell: TabularExportCell): TabularExportCell {
  if (typeof cell === "string") return cell;
  return Number.isFinite(cell.number) ? cell : cell.text;
}

export function storedFromExport(exportDocument: TabularExportDocument): StoredExportDocument {
  return {
    title: exportDocument.title,
    generatedAt: exportDocument.generatedAt.toISOString(),
    sections: exportDocument.sections.map((section) => ({
      title: section.title,
      headers: section.headers,
      rows: section.rows.map((row) => row.map(storedCell)),
      ...(section.endAlignedColumns !== undefined && {
        endAlignedColumns: section.endAlignedColumns,
      }),
    })),
  };
}

/*
 * Back into the shape every renderer already takes. The stamp lines are not stored: they are
 * composed from the instant in the reader's own clock, which is the same clock that produced them
 * when the export was first taken, so a re-download carries the stamp it carried the first time.
 */
export function exportFromStored(stored: StoredExportDocument): TabularExportDocument {
  return {
    title: stored.title,
    generatedAt: new Date(stored.generatedAt),
    sections: stored.sections.map((section) => ({
      title: section.title,
      headers: section.headers,
      rows: section.rows,
      ...(section.endAlignedColumns !== undefined && {
        endAlignedColumns: section.endAlignedColumns,
      }),
    })),
  };
}

export interface ShelfFetchResult {
  readonly kind: ShelfItemKind;
  readonly url?: string;
  readonly document?: unknown;
}

/** Take a shelf item again, recording the format. An artifact answers a URL; a snapshot, a document. */
export function fetchShelfItem(
  fetchImpl: typeof fetch,
  id: string,
  format: string,
): Promise<ApiOutcome<ShelfFetchResult>> {
  return requestJson<ShelfFetchResult>(
    fetchImpl,
    `/api/v1/downloads/${encodeURIComponent(id)}/fetches`,
    { method: "POST", body: { format } },
  );
}
