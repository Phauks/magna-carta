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
  type DownloadItemInsert,
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
  // The id is minted here rather than by the registration, because the object's key is derived from
  // it — the key cannot be known after a row that does not exist yet. Every other producer already
  // has its bytes somewhere and lets the registration mint.
  const id = newIdentifier("downloadItem") as DownloadItemId;
  const objectKey = snapshotObjectKey(id);
  const body = new TextEncoder().encode(JSON.stringify(input.document));
  await input.bucket.put(objectKey, body, {
    customMetadata: firmScopedObjectDimensions("export-snapshot"),
  });
  const { statement } = registerDownload(input.database, {
    id,
    memberId: input.memberId,
    now: input.now,
    registration: {
      producer: "export",
      title: input.title,
      objectKey,
      requestedFormat: input.requestedFormat,
    },
  });
  await input.database.batch([statement]);
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

/*
 * THE ONE WAY A ROW REACHES THE REGISTER.
 *
 * Every producer that hands a member bytes registers what it handed over by calling this, and
 * nothing else writes to the table — `insertDownloadItemStatement` is imported here and nowhere
 * else, which `pnpm run lint:download-register` asserts. That is the whole point of collapsing the
 * three writers this replaced: the register is only worth reading if it is complete, and
 * completeness is a property nobody can check by looking at one route. A fitness function can.
 *
 * THE CALLER SAYS WHAT HAPPENED; THIS DECIDES WHAT THAT IS. A producer knows whether it retained
 * bytes, handed back a matter file, or streamed something it kept nothing of. It does NOT decide
 * the kind, the key rules, the expiry or the state — those follow from what it reports, and
 * deriving them here is what stops a caller filing a matter file as an artifact, which would make
 * it presignable from the register and turn a row into a standing grant over somebody else's
 * matter. The schema states the same rules as CHECKs, so a mistake here is refused twice.
 */
export type DownloadRegistration =
  /** An export: the register stores the DOCUMENT, so one row serves every format. */
  | {
      readonly producer: "export";
      readonly title: string;
      readonly objectKey: string;
      /** What the member chose on the export control — what a later download defaults to. */
      readonly requestedFormat: string;
    }
  /**
   * A bundle. `retained` is the fact that decides everything else: an archive built into the firm's
   * bucket can be taken again, and one streamed inline assembled its bytes for a single response and
   * kept none of them. The second is registered as a record — it happened, and there is nothing to
   * come back to — rather than as an artifact whose object never existed.
   */
  | {
      readonly producer: "bundle";
      readonly title: string;
      readonly bytes:
        | { readonly retained: true; readonly objectKey: string; readonly byteSize: number | null }
        | { readonly retained: false };
      /** A bundle still building has a key and no bytes yet; the shelf shows it as `building`. */
      readonly building?: true;
    }
  /**
   * A discovery artifact — a production's manifest, its exception report, or the load itself.
   * Bytes the platform produced and retained under its own prefix, so an artifact like any other.
   */
  | {
      readonly producer: "discovery";
      readonly title: string;
      readonly objectKey: string;
      readonly byteSize: number | null;
    }
  | {
      readonly producer: "conversion";
      readonly title: string;
      readonly objectKey: string;
      readonly byteSize: number | null;
      /** Registered when the job is submitted, so the shelf shows the work before its bytes exist. */
      readonly building?: true;
    }
  /**
   * A file that lives on a MATTER. It carries no object key, so it cannot reach the presigning
   * branch an artifact takes; coming back for it goes through the files route, whose capability
   * check runs again at that moment.
   */
  | {
      readonly producer: "file";
      readonly title: string;
      readonly fileId: string;
      readonly byteSize: number | null;
    };

export interface RegisterDownloadInput {
  readonly memberId: string;
  readonly now: Date;
  readonly registration: DownloadRegistration;
  /**
   * The row's id, where the producer needs it BEFORE the row exists. Only the export path does: the
   * object it stores is keyed by the row id, so the key cannot be derived after the fact. Every
   * other producer leaves it out and takes the one minted here.
   */
  readonly id?: DownloadItemId;
}

/** A registered download: the statement to commit, and the id the row will carry. */
export interface RegisteredDownload {
  readonly id: DownloadItemId;
  readonly statement: SqlStatement;
}

/**
 * Register one download. Returns a STATEMENT rather than committing, so a producer lands the row in
 * the same batch as the audit entry or the state write that records the same act — a download that
 * was audited but not registered, or the reverse, is a register nobody can trust.
 */
export function registerDownload(
  database: ProxyBatchDatabase,
  { memberId, now, registration, id: given }: RegisterDownloadInput,
): RegisteredDownload {
  const id = given ?? (newIdentifier("downloadItem") as DownloadItemId);
  const common = {
    id,
    memberId,
    title: registration.title,
    createdAt: now.toISOString(),
    // Only a producer that stores something of the register's own has a format to remember, and
    // only an export does: every other kind is bytes in one shape already, or none.
    requestedFormat: registration.producer === "export" ? registration.requestedFormat : null,
  } as const;

  /*
   * What the row IS, derived from what the producer reported. One expression per producer, so the
   * four facts that must agree — the kind, the key, the file and the expiry — are decided together
   * rather than set field by field at seven call sites. The schema states the same agreements as
   * CHECKs, so a mistake here is refused by the database as well.
   */
  const shape = ((): Pick<
    DownloadItemInsert,
    "kind" | "objectKey" | "subjectFileId" | "byteSize" | "expiresAt" | "state"
  > => {
    switch (registration.producer) {
      case "file":
        return {
          kind: "reference",
          objectKey: null,
          subjectFileId: registration.fileId,
          byteSize: registration.byteSize,
          // Nothing of the register's to release — the file's life is the matter's.
          expiresAt: null,
          state: "ready",
        };
      case "export":
        return {
          kind: "snapshot",
          objectKey: registration.objectKey,
          subjectFileId: null,
          // A snapshot's size is a property of a rendering nobody has asked for yet.
          byteSize: null,
          expiresAt: shelfExpiry(now),
          state: "ready",
        };
      case "bundle":
        return registration.bytes.retained
          ? {
              kind: "artifact",
              objectKey: registration.bytes.objectKey,
              subjectFileId: null,
              byteSize: registration.bytes.byteSize,
              expiresAt: shelfExpiry(now),
              state: registration.building === true ? "building" : "ready",
            }
          : {
              // Streamed for one response and kept nowhere: it happened, and there is nothing to
              // come back to.
              kind: "record",
              objectKey: null,
              subjectFileId: null,
              byteSize: null,
              expiresAt: null,
              state: "ready",
            };
      case "conversion":
        return {
          kind: "artifact",
          objectKey: registration.objectKey,
          subjectFileId: null,
          byteSize: registration.byteSize,
          expiresAt: shelfExpiry(now),
          state: registration.building === true ? "building" : "ready",
        };
      case "discovery":
        return {
          kind: "artifact",
          objectKey: registration.objectKey,
          subjectFileId: null,
          byteSize: registration.byteSize,
          expiresAt: shelfExpiry(now),
          state: "ready",
        };
    }
  })();

  return registered(
    id,
    insertDownloadItemStatement(database, {
      ...common,
      producer: registration.producer,
      ...shape,
    }),
  );
}

const registered = (id: DownloadItemId, statement: SqlStatement): RegisteredDownload => ({
  id,
  statement,
});
