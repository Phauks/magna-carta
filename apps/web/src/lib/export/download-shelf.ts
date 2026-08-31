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
 * Keep an export the member has just taken. Resolves to the new item's id, or undefined when the
 * shelf could not take it — a failure here must never cost the member the download they already
 * have, so every caller treats it as advisory rather than as an error to raise.
 */
export async function keepExportOnShelf(
  fetchImpl: typeof fetch,
  exportDocument: TabularExportDocument,
  format: string,
): Promise<string | undefined> {
  const outcome = await requestJson<{ id: string }>(fetchImpl, "/api/v1/downloads/snapshots", {
    method: "POST",
    body: { title: exportDocument.title, format, document: storedFromExport(exportDocument) },
  });
  return outcome.kind === "ok" ? outcome.value.id : undefined;
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

export function storedFromExport(exportDocument: TabularExportDocument): StoredExportDocument {
  return {
    title: exportDocument.title,
    generatedAt: exportDocument.generatedAt.toISOString(),
    sections: exportDocument.sections.map((section) => ({
      title: section.title,
      headers: section.headers,
      rows: section.rows,
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
