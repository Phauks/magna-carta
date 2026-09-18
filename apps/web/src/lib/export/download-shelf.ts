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
  type Page,
} from "$lib/api/request.ts";
import type { TabularExportCell, TabularExportDocument } from "./tabular-export.ts";

export type ShelfItemKind = "artifact" | "snapshot" | "reference" | "record";
export type ShelfItemProducer = "export" | "bundle" | "conversion" | "file" | "discovery";
export type ShelfItemState = "building" | "ready" | "failed" | "expired";

export interface ShelfItem {
  readonly id: string;
  readonly title: string;
  readonly kind: ShelfItemKind;
  /** The matter file a reference names, so the screen can offer the way back to it. */
  readonly subjectFileId: string | null;
  readonly producer: ShelfItemProducer;
  readonly byteSize: number | null;
  /** The format it was made for; null on rows written before exports recorded one. */
  readonly requestedFormat: string | null;
  readonly downloadedFormats: readonly string[];
  readonly createdAt: string;
  /** When the BYTES let go, not the row. Null on a reference or a record, which hold none. */
  readonly expiresAt: string | null;
  readonly state: ShelfItemState;
}

/**
 * One page of the register — the platform's uniform list envelope, not a shape of this screen's own.
 * Being `Page` is what lets the screen drive it with the same cursor-paging state every other
 * register uses, so "load the next page" is not written a tenth time here.
 */
export type ShelfPage = Page<ShelfItem>;

/**
 * One page of the member's register, newest first.
 *
 * It is paged because the register now keeps every download and keeps the row after the bytes go,
 * so it grows for as long as somebody works here. A caller that wants more passes the cursor the
 * previous page returned.
 *
 * A term narrows on the SERVER, which is why it is a parameter here rather than a filter the screen
 * applies to the rows it holds: the register has no bound, so searching what happens to be loaded
 * would answer confidently about a fraction of it.
 */
export function readShelf(
  fetchImpl: typeof fetch,
  options: {
    readonly cursor?: string;
    readonly search?: string;
    /** How many rows to ask for, for a caller that shows a handful rather than a page. */
    readonly limit?: number;
  } = {},
): Promise<ApiOutcome<ShelfPage>> {
  const query = new URLSearchParams();
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  const term = options.search?.trim() ?? "";
  if (term !== "") query.set("search", term);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return requestJson<ShelfPage>(fetchImpl, `/api/v1/downloads${suffix}`);
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
  /** True only when a file was actually saved in the same act — the download-immediately path. */
  taken = false,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson<{ id: string }>(fetchImpl, "/api/v1/downloads/snapshots", {
    method: "POST",
    body: {
      title: exportDocument.title,
      format,
      taken,
      document: storedFromExport(exportDocument),
    },
  });
}

export interface DownloadPreferences {
  readonly saveImmediately: boolean;
}

export function readDownloadPreferences(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<DownloadPreferences>> {
  return requestJson<DownloadPreferences>(fetchImpl, "/api/v1/downloads/preferences");
}

export function writeDownloadPreferences(
  fetchImpl: typeof fetch,
  preferences: DownloadPreferences,
): Promise<ApiOutcome<DownloadPreferences>> {
  return requestJson<DownloadPreferences>(fetchImpl, "/api/v1/downloads/preferences", {
    method: "PUT",
    body: preferences,
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
