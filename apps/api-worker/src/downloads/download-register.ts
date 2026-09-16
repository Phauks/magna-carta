/*
 * The download register — the shared half of a member's shelf, used by the routes that read it and
 * by every producer that puts something on it.
 *
 * A SHELF, NOT A HISTORY. Every row carries an expiry written from the one constant below, so a row
 * and the R2 lifecycle rule over the prefix it points at cannot drift into the register outliving
 * the bytes. "What have I ever downloaded" is an audit question `audit_log` answers under a
 * different key; this answers "what did the platform make me lately, and can I have it again".
 *
 * Spec: docs/specs/2026-08-31-download-register-design.md.
 */
import {
  insertDownloadItemStatement,
  type DownloadItemProducer,
} from "@magna-carta/data-access/download-register-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { DownloadItemId } from "@magna-carta/identifiers/types";
import type { StoredTabularDocument } from "@magna-carta/export-document/renderable";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";

/*
 * How long the shelf holds anything, matching the `bundles/` R2 lifecycle rule that is already live
 * at seven days. Keeping the two equal is what lets a row point at a bundle for its whole life: a
 * shorter window would sweep rows off a shelf while their bytes were still paid for, and a longer
 * one would leave rows pointing at objects the bucket had already reaped. A row whose object is gone
 * before the sweep reaches it reports `expired` on read, so the two need not be in lockstep to the
 * minute — but they must not be in different orders of magnitude.
 */
export const SHELF_RETENTION_DAYS = 7;

/** The most rows one shelf read returns. The shelf is short-lived, so this bounds rather than pages. */
export const SHELF_READ_LIMIT = 200;

export function shelfExpiry(now: Date): string {
  return new Date(now.getTime() + SHELF_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/*
 * A snapshot's stored document lives under the register's own prefix, keyed by the row's id — this
 * is the one object class the register owns rather than catalogs, and it is deleted with its row.
 * Never a member-supplied string: the key is derived from an identifier the platform minted.
 */
export function snapshotObjectKey(id: DownloadItemId): string {
  return `downloads/snapshots/${id}.json`;
}

export interface RecordSnapshotInput {
  readonly database: ProxyBatchDatabase;
  readonly bucket: R2Bucket;
  readonly memberId: string;
  readonly title: string;
  readonly document: StoredTabularDocument;
  /** The format the member chose on the export control — what a later download defaults to. */
  readonly requestedFormat: string;
  readonly now: Date;
}

/*
 * Put an export on a member's shelf: the DOCUMENT is stored, never a rendered file, because this
 * platform holds that an export is a document and formats are renderers. One row therefore serves
 * every format, and the figures stay frozen at the instant of the export rather than being
 * recomputed later into a different answer under the same name.
 *
 * The object is written BEFORE the row, on the ordering template registration already follows: a
 * committed row pointing at bytes that were never written is a shelf item that fails when a member
 * reaches for it, while a written object with no row is swept as an orphan and costs only storage.
 */
export async function recordExportSnapshot(input: RecordSnapshotInput): Promise<DownloadItemId> {
  const id = newIdentifier("downloadItem") as DownloadItemId;
  const objectKey = snapshotObjectKey(id);
  const body = new TextEncoder().encode(JSON.stringify(input.document));
  await input.bucket.put(objectKey, body, {
    customMetadata: firmScopedObjectDimensions("export-snapshot"),
  });
  await input.database.batch([
    insertDownloadItemStatement(input.database, {
      id,
      memberId: input.memberId,
      title: input.title,
      kind: "snapshot",
      producer: "export",
      objectKey,
      subjectFileId: null,
      // A snapshot's size is a property of a rendering nobody has asked for yet, not of the row.
      byteSize: null,
      requestedFormat: input.requestedFormat,
      createdAt: input.now.toISOString(),
      expiresAt: shelfExpiry(input.now),
      state: "ready",
    }),
  ]);
  return id;
}

/** Read a stored snapshot document back. Absent bytes mean the object was reaped ahead of its row. */
export async function readSnapshotDocument(
  bucket: R2Bucket,
  objectKey: string,
): Promise<StoredTabularDocument | undefined> {
  const object = await bucket.get(objectKey);
  if (object === null) return undefined;
  try {
    return JSON.parse(await object.text()) as StoredTabularDocument;
  } catch {
    // Stored by this platform and parsed by this platform, so a failure here is corruption rather
    // than a caller's mistake — and the honest answer for the member is the same as a reaped object.
    return undefined;
  }
}

export interface ReferenceShelfRow {
  readonly memberId: string;
  /** What the reader sees — the file's own name, which is what they went looking for. */
  readonly title: string;
  /** The matter file that was handed over. */
  readonly fileId: string;
  readonly byteSize: number | null;
  readonly now: Date;
}

/*
 * The producers' write for a REFERENCE: a file that lives on a matter and was never the register's
 * to hold.
 *
 * It carries NO object key and NO expiry, and both absences are the design. No key, because a
 * reference must be structurally incapable of reaching the presigning branch that an artifact takes
 * — the file is reached through the files route instead, which re-runs the matter capability check
 * on every request, so a member screened off a matter afterwards stops being able to take it. No
 * expiry, because there are no bytes of the register's to release: the file's availability is the
 * matter's business, and a row that claimed to expire would be making a promise about somebody
 * else's object. The schema states both as CHECKs rather than trusting this function.
 *
 * Returned as a statement, like the artifact's, so a producer lands the row in the batch that
 * records the act rather than in a second write that can fail on its own.
 */
export function referenceShelfStatement(
  database: ProxyBatchDatabase,
  row: ReferenceShelfRow,
): SqlStatement {
  return insertDownloadItemStatement(database, {
    id: newIdentifier("downloadItem") as DownloadItemId,
    memberId: row.memberId,
    title: row.title,
    kind: "reference",
    producer: "file",
    objectKey: null,
    subjectFileId: row.fileId,
    byteSize: row.byteSize,
    // A file is the shape it is on the matter; nobody chose a format for it.
    requestedFormat: null,
    createdAt: row.now.toISOString(),
    expiresAt: null,
    state: "ready",
  });
}

export interface ArtifactShelfRow {
  readonly memberId: string;
  readonly title: string;
  readonly producer: Extract<DownloadItemProducer, "bundle" | "conversion">;
  readonly objectKey: string;
  readonly byteSize: number | null;
  readonly now: Date;
}

/*
 * The producers' write for an ARTIFACT: bytes that already exist under the producer's own prefix,
 * with the producer's own addressing. The register points at them and never copies them, which is
 * what keeps this a catalog rather than a second store — and what keeps each artifact under exactly
 * one lifecycle rule.
 *
 * Returned as a statement rather than committed, so a producer can land the row in the same batch as
 * its own state write instead of leaving a window where the work finished and the shelf disagrees.
 */
export function artifactShelfStatement(
  database: ProxyBatchDatabase,
  row: ArtifactShelfRow,
): SqlStatement {
  return insertDownloadItemStatement(database, {
    id: newIdentifier("downloadItem") as DownloadItemId,
    memberId: row.memberId,
    title: row.title,
    kind: "artifact",
    producer: row.producer,
    objectKey: row.objectKey,
    // An artifact holds its own bytes; only a reference names a file on a matter.
    subjectFileId: null,
    byteSize: row.byteSize,
    // An artifact is bytes in one shape already; nobody chose a format for it.
    requestedFormat: null,
    createdAt: row.now.toISOString(),
    expiresAt: shelfExpiry(row.now),
    state: "ready",
  });
}
