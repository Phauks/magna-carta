/*
 * Taking several shelf items in one act — the reason exporting generates onto the shelf rather than
 * saving a file each time.
 *
 * ONE ARCHIVE, not several downloads. Firing a download per item makes the browser prompt about
 * multiple files and then scatters them, which is the same mess the member was gathering items to
 * avoid. The snapshots are rendered here and packed with `client-zip` — the same library the Worker
 * streams its bulk bundles through, so the platform has one answer to "put these files together".
 *
 * An ARTIFACT cannot join the archive, and that is structural rather than an omission: its bytes
 * live in R2 and reach the member over a presigned URL the browser downloads directly, so pulling
 * them through this tab to re-pack them is exactly what `docs/conventions/network-resilience.md`
 * rule 2 forbids, and it would cost pause and resume on the largest files anybody has. Those are
 * handed back to the caller to open on their own terms.
 */
import { downloadZip } from "client-zip";
import {
  exportFromStored,
  fetchShelfItem,
  type ShelfItem,
  type StoredExportDocument,
} from "./download-shelf.ts";
import { renderCsvExport } from "./render-csv.ts";
import { renderRemoteExport } from "./render-remote.ts";
import { renderTextExport } from "./render-text.ts";
import { renderXlsxExport } from "./render-xlsx.ts";
import { exportFilename, type TabularExportDocument } from "./tabular-export.ts";

export const BULK_CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "xlsx-single": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  csv: "text/csv;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};

/** Render one stored export into the format asked for. The one place format maps to renderer. */
export async function renderStoredExport(
  exportDocument: TabularExportDocument,
  extension: string,
): Promise<string | Blob> {
  if (extension === "xlsx") return await renderXlsxExport(exportDocument, "worksheet-per-section");
  if (extension === "xlsx-single")
    return await renderXlsxExport(exportDocument, "single-worksheet");
  if (extension === "csv") return renderCsvExport(exportDocument);
  if (extension === "txt") return renderTextExport(exportDocument);
  return await renderRemoteExport(exportDocument, extension === "pdf" ? "pdf" : "docx");
}

export interface BulkDownloadResult {
  /** The archive of every snapshot that rendered, or null when none did. */
  readonly archive: Blob | null;
  /**
   * Items whose bytes reach the member over a URL rather than through this tab, so the archive
   * structurally cannot carry them and the caller opens each on its own. Both kinds that work this
   * way land here: a stored artifact, whose URL is signed, and a matter file, whose URL is this
   * platform's own address for it and re-runs the matter's access check on the way through.
   */
  readonly linked: readonly ShelfItem[];
  /** Items whose bytes could not be produced at all, so the member is told rather than left short. */
  readonly failed: readonly ShelfItem[];
  /** Every (item, format) pair that really was produced, for the caller to record as taken. */
  readonly taken: readonly { readonly item: ShelfItem; readonly format: string }[];
}

/**
 * Gather the selected items. Snapshots are rendered in the format each was made for (falling back to
 * the spreadsheet, which is what an item generated before the register recorded a format gets) and
 * packed into one archive; linked items and outright failures come back named, so a partial result
 * is always reported as partial rather than presented as the whole selection.
 *
 * ROUTING IS BY KIND, and every kind the register can hold is answered for. A record holds no bytes
 * at all — the download happened, was streamed, and was never kept — so it is neither archived nor
 * opened: it comes back among the failures, because a member who selected it and got silence would
 * reasonably believe the archive contained it.
 */
export async function bulkDownload(
  fetchImpl: typeof fetch,
  items: readonly ShelfItem[],
): Promise<BulkDownloadResult> {
  const files: { name: string; input: Blob }[] = [];
  const linked: ShelfItem[] = [];
  const failed: ShelfItem[] = [];
  const taken: { item: ShelfItem; format: string }[] = [];

  for (const item of items) {
    if (item.kind === "artifact" || item.kind === "reference") {
      linked.push(item);
      continue;
    }
    if (item.kind === "record") {
      failed.push(item);
      continue;
    }
    const format = item.requestedFormat ?? item.downloadedFormats[0] ?? "xlsx";
    const outcome = await fetchShelfItem(fetchImpl, item.id, format);
    if (outcome.kind !== "ok" || outcome.value.document === undefined) {
      failed.push(item);
      continue;
    }
    try {
      const exportDocument = exportFromStored(outcome.value.document as StoredExportDocument);
      const rendered = await renderStoredExport(exportDocument, format);
      const extension = format === "xlsx-single" ? "xlsx" : format;
      const contentType = BULK_CONTENT_TYPES[format] ?? "application/octet-stream";
      files.push({
        name: exportFilename(exportDocument, extension),
        input: rendered instanceof Blob ? rendered : new Blob([rendered], { type: contentType }),
      });
      taken.push({ item, format });
    } catch {
      failed.push(item);
    }
  }

  const archive = files.length === 0 ? null : await downloadZip(files).blob();
  return { archive, linked, failed, taken };
}

/** The archive's own name, stamped like every other export so two gatherings never blur together. */
export function bulkArchiveFilename(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `Downloads ${date} ${time}.zip`;
}
