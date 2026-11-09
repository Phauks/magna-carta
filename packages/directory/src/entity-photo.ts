import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { assertEntityExists } from "./entity-kind.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";

// A directory record's picture: a person's photograph or an organization's logo. The row, the
// statements over it, and the two writes, each audited on the record it changes.
//
// The bytes are not this module's business. The route stores them in the firm's bucket before it
// calls `setEntityPhoto`, so a row never names an object that is not there; this module records which
// object the record now shows and files the change in the directory's audit trail.
//
// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const DIRECTORY_ENTITY_PHOTO_TABLE = "directory_entity_photo";

/** One record's picture, as stored. */
export interface EntityPhotoRow {
  readonly entityId: string;
  readonly sha256: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawEntityPhotoRow {
  entity_id: string;
  sha256: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  width_pixels: number;
  height_pixels: number;
  created_at: string;
  updated_at: string;
}

function rowOf(row: RawEntityPhotoRow): EntityPhotoRow {
  return {
    entityId: row.entity_id,
    sha256: row.sha256,
    objectKey: row.object_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    widthPixels: row.width_pixels,
    heightPixels: row.height_pixels,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The record's picture, or undefined where it holds none. */
export async function readEntityPhoto(
  database: SqlDatabase,
  entityId: string,
): Promise<EntityPhotoRow | undefined> {
  const { results } = await database
    .prepare(
      "SELECT entity_id, sha256, object_key, content_type, size_bytes, width_pixels, height_pixels, " +
        `created_at, updated_at FROM ${DIRECTORY_ENTITY_PHOTO_TABLE} WHERE entity_id = ?1`,
    )
    .bind(entityId)
    .all<RawEntityPhotoRow>();
  const row = results[0];
  return row === undefined ? undefined : rowOf(row);
}

/** What the route learned about the bytes it stored. */
export interface EntityPhotoInput {
  readonly sha256: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
}

/**
 * One row per record is the whole model, so this is an upsert: a replacement run as a delete then
 * an insert could be interrupted between them and leave the record with no picture. `created_at`
 * survives the replacement; it dates the record having a picture at all.
 */
function setEntityPhotoStatement(
  database: SqlDatabase,
  entityId: string,
  input: EntityPhotoInput,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DIRECTORY_ENTITY_PHOTO_TABLE} ` +
        "(entity_id, sha256, object_key, content_type, size_bytes, width_pixels, height_pixels, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) " +
        "ON CONFLICT(entity_id) DO UPDATE SET " +
        "sha256 = excluded.sha256, object_key = excluded.object_key, " +
        "content_type = excluded.content_type, size_bytes = excluded.size_bytes, " +
        "width_pixels = excluded.width_pixels, height_pixels = excluded.height_pixels, " +
        "updated_at = excluded.updated_at",
    )
    .bind(
      entityId,
      input.sha256,
      input.objectKey,
      input.contentType,
      input.sizeBytes,
      input.widthPixels,
      input.heightPixels,
      now,
    );
}

/**
 * Sets the record's picture, replacing whatever it held. The record has to exist and stand on its
 * own: a picture recorded on a merged-away record is one nobody would see, so that is the merge's
 * typed refusal naming where the record went.
 */
export async function setEntityPhoto(
  database: BatchDatabase,
  entityId: string,
  input: EntityPhotoInput,
  options: DirectoryWriteOptions,
): Promise<EntityPhotoRow> {
  await assertEntityExists(database, entityId);
  const now = options.clock.now();
  const existing = await readEntityPhoto(database, entityId);
  const row: EntityPhotoRow = {
    entityId,
    ...input,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      setEntityPhotoStatement(database, entityId, input, now),
      directoryAuditStatement(database, options, "directory.entity.photo_changed", entityId),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: row,
    value: row,
    fromBody: (body) => body as EntityPhotoRow,
  }));
}

/**
 * Removes the record's picture. A record that holds none is answered the same way and audits
 * nothing, because nothing changed. Returns the row that was removed, so the caller can sweep the
 * object it named.
 */
export async function removeEntityPhoto(
  database: BatchDatabase,
  entityId: string,
  options: DirectoryWriteOptions,
): Promise<EntityPhotoRow | undefined> {
  await assertEntityExists(database, entityId);
  const existing = await readEntityPhoto(database, entityId);
  if (existing === undefined) return undefined;
  await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      database
        .prepare(`DELETE FROM ${DIRECTORY_ENTITY_PHOTO_TABLE} WHERE entity_id = ?1`)
        .bind(entityId),
      directoryAuditStatement(database, options, "directory.entity.photo_removed", entityId),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { ok: true },
    value: undefined,
    fromBody: () => undefined,
  }));
  return existing;
}
