import {
  readVersionForExportCopy,
  type ExportCopyFacts,
} from "@magna-carta/file-manager/export-copy";
import type { ZipEntry } from "@magna-carta/file-manager/zip-composition";
import type { FileVersionId } from "@magna-carta/identifiers/types";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { produceExportCopy } from "./export-copy.ts";

// The object a copy that leaves the platform is served from.
//
// EVERY PATH THAT HANDS A VERSION'S BYTES OUT RESOLVES THEM HERE, never from the version's own
// key: a word-processing version the editor cut keeps its tracked changes, and the copy for
// outside is the version's export copy. The paths, and the rule, are in ../editing/CLAUDE.md
// (_Every copy that leaves the platform_).
//
// A copy still `pending` — the save was seconds ago and the queue has not reached it — is made on
// the spot rather than served with its marks or refused: the wait is the accept pass over one
// document, which is what the queue would have spent anyway. It is the ONE place the accept pass
// runs on a request, and it is bounded: a bundle with more pending copies than
// MAX_INLINE_EXPORT_COPIES is refused until the queue catches up, since making many on one request
// is exactly the heavy work the request path is kept clear of.

/** What was done about a version's marks on the way out. */
export type ExportCopyDisposition =
  // The version carries no recorded changes to accept: an upload, a check-in, another format.
  | "not-needed"
  // Served from the copy with every change accepted (or the version's own bytes, which recorded none).
  | "accepted"
  // No copy could be made; served from the stored bytes, marks and all, and audited as such.
  | "unavailable";

export interface ExportObject {
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly disposition: ExportCopyDisposition;
}

export interface ExportableVersion extends ExportCopyFacts {
  readonly id: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
}

export const MAX_INLINE_EXPORT_COPIES = 3;

export class ExportCopiesNotReadyError extends Error {
  constructor(readonly pendingCount: number) {
    super(`${pendingCount} export copies are still being made`);
  }
}

export async function resolveExportObject(
  database: ProxyBatchDatabase,
  bucket: R2Bucket,
  version: ExportableVersion,
  now: () => string,
): Promise<ExportObject> {
  const stored: ExportObject = {
    r2Key: version.r2Key,
    sizeBytes: version.sizeBytes,
    disposition: "not-needed",
  };
  switch (version.exportCopyState) {
    case null:
      return stored;
    case "ready":
      return {
        r2Key: version.exportR2Key ?? version.r2Key,
        sizeBytes: version.exportSizeBytes ?? version.sizeBytes,
        disposition: "accepted",
      };
    case "unavailable":
      return { ...stored, disposition: "unavailable" };
    case "pending": {
      const facts = await readVersionForExportCopy(database, version.id);
      if (facts === undefined) return { ...stored, disposition: "unavailable" };
      const outcome = await produceExportCopy(database, bucket, facts, now);
      if (outcome.kind === "ready") {
        return { r2Key: outcome.r2Key, sizeBytes: outcome.sizeBytes, disposition: "accepted" };
      }
      return {
        ...stored,
        disposition: outcome.kind === "not-needed" ? "not-needed" : "unavailable",
      };
    }
  }
}

export interface ExportedEntries {
  readonly entries: readonly ZipEntry[];
  readonly totalBytes: number;
  /** How many entries were served from an accepted copy. */
  readonly acceptedCopies: number;
  /** How many entries needed a copy and could not have one. */
  readonly unavailableCopies: number;
}

/** The same resolution over a bundle's entries: each entry's key and size become its copy's. */
export async function resolveExportEntries(
  database: ProxyBatchDatabase,
  bucket: R2Bucket,
  entries: readonly ZipEntry[],
  now: () => string,
): Promise<ExportedEntries> {
  const pendingCount = entries.filter(
    (entry) => entry.exportCopy.exportCopyState === "pending",
  ).length;
  if (pendingCount > MAX_INLINE_EXPORT_COPIES) throw new ExportCopiesNotReadyError(pendingCount);

  const resolved: ZipEntry[] = [];
  let acceptedCopies = 0;
  let unavailableCopies = 0;
  for (const entry of entries) {
    const object = await resolveExportObject(
      database,
      bucket,
      {
        id: entry.versionId,
        r2Key: entry.r2Key,
        sizeBytes: entry.sizeBytes,
        ...entry.exportCopy,
      },
      now,
    );
    if (object.disposition === "accepted") acceptedCopies += 1;
    if (object.disposition === "unavailable") unavailableCopies += 1;
    resolved.push({
      ...entry,
      r2Key: object.r2Key,
      sizeBytes: object.sizeBytes ?? entry.sizeBytes,
    });
  }
  return {
    entries: resolved,
    totalBytes: resolved.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    acceptedCopies,
    unavailableCopies,
  };
}
