import type { DownloadItemId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// The download register — one member's shelf of what the platform produced for them, held for a
// short window and swept. Behavior over the table lives here; the structure lives in
// @magna-carta/database's per-firm schema.
//
// EVERY READ IS SCOPED TO A MEMBER, and that is a property of this module rather than of its
// callers: there is deliberately no "list the firm's shelf" statement, so a route cannot acquire one
// by forgetting a parameter. A firm-wide administrative view is a different question with a
// different key, and it would get its own statement saying so.
export const DOWNLOAD_ITEM_TABLE = "download_item";

export type DownloadItemKind = "artifact" | "snapshot";
export type DownloadItemProducer = "export" | "bundle" | "conversion";
export type DownloadItemState = "building" | "ready" | "failed" | "expired";

export interface DownloadItemRow {
  readonly id: DownloadItemId;
  readonly memberId: string;
  readonly title: string;
  readonly kind: DownloadItemKind;
  readonly producer: DownloadItemProducer;
  readonly objectKey: string;
  readonly byteSize: number | null;
  readonly downloadedFormats: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: DownloadItemState;
}

export interface DownloadItemInsert {
  readonly id: DownloadItemId;
  readonly memberId: string;
  readonly title: string;
  readonly kind: DownloadItemKind;
  readonly producer: DownloadItemProducer;
  readonly objectKey: string;
  readonly byteSize: number | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: DownloadItemState;
}

// The stored column is JSON text. Read defensively: a row whose list cannot be parsed reports an
// empty one rather than throwing, because "we cannot tell which formats you took" must not cost the
// member the row itself — the artifact behind it is still theirs to fetch.
function parseFormats(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function toRow(record: Record<string, unknown>): DownloadItemRow {
  return {
    id: record["id"] as DownloadItemId,
    memberId: String(record["member_id"]),
    title: String(record["title"]),
    kind: record["kind"] as DownloadItemKind,
    producer: record["producer"] as DownloadItemProducer,
    objectKey: String(record["object_key"]),
    byteSize: record["byte_size"] === null ? null : Number(record["byte_size"]),
    downloadedFormats: parseFormats(record["downloaded_formats_json"]),
    createdAt: String(record["created_at"]),
    expiresAt: String(record["expires_at"]),
    state: record["state"] as DownloadItemState,
  };
}

const COLUMNS =
  "id, member_id, title, kind, producer, object_key, byte_size, downloaded_formats_json, created_at, expires_at, state";

export function insertDownloadItemStatement(
  database: SqlDatabase,
  row: DownloadItemInsert,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DOWNLOAD_ITEM_TABLE} (id, member_id, title, kind, producer, object_key, byte_size, downloaded_formats_json, created_at, expires_at, state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[]', ?8, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.memberId,
      row.title,
      row.kind,
      row.producer,
      row.objectKey,
      row.byteSize,
      row.createdAt,
      row.expiresAt,
      row.state,
    );
}

/**
 * One member's shelf, newest first. Bounded by the caller's limit — the shelf is short-lived by
 * construction, so this is a whole read rather than a cursor page, and the limit exists to keep a
 * pathological producer from returning an unbounded list rather than to paginate.
 */
export async function readDownloadShelf(
  database: SqlDatabase,
  memberId: string,
  limit: number,
): Promise<DownloadItemRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${COLUMNS} FROM ${DOWNLOAD_ITEM_TABLE} WHERE member_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2`,
    )
    .bind(memberId, limit)
    .all();
  return results.map(toRow);
}

/**
 * One row, and the member scope is part of the LOOKUP rather than a check the caller makes after it.
 * A member asking for somebody else's item gets the same answer as a member asking for one that does
 * not exist, which is the only shape that does not confirm the other row is there.
 */
export async function readDownloadItem(
  database: SqlDatabase,
  memberId: string,
  id: DownloadItemId,
): Promise<DownloadItemRow | undefined> {
  const record = await database
    .prepare(`SELECT ${COLUMNS} FROM ${DOWNLOAD_ITEM_TABLE} WHERE id = ?1 AND member_id = ?2`)
    .bind(id, memberId)
    .first();
  return record === null || record === undefined ? undefined : toRow(record);
}

/**
 * Record that a format was taken. APPENDS rather than replaces, and does it in SQL so two downloads
 * racing cannot each write a list that lost the other's entry. A format already present is left
 * alone, so the list stays a set and re-fetching the same format twice does not grow the row.
 */
export function recordDownloadedFormatStatement(
  database: SqlDatabase,
  memberId: string,
  id: DownloadItemId,
  format: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOWNLOAD_ITEM_TABLE}
         SET downloaded_formats_json = CASE
           WHEN EXISTS (SELECT 1 FROM json_each(downloaded_formats_json) WHERE value = ?3)
             THEN downloaded_formats_json
           ELSE json_insert(downloaded_formats_json, '$[#]', ?3)
         END
       WHERE id = ?1 AND member_id = ?2`,
    )
    .bind(id, memberId, format);
}

/** Move a row to a terminal or ready state — the producers' write when their work finishes. */
export function setDownloadItemStateStatement(
  database: SqlDatabase,
  id: DownloadItemId,
  state: DownloadItemState,
  byteSize: number | null,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOWNLOAD_ITEM_TABLE} SET state = ?2, byte_size = COALESCE(?3, byte_size) WHERE id = ?1`,
    )
    .bind(id, state, byteSize);
}

/** A member clearing their own shelf. Member-scoped for the reason the single read is. */
export function deleteDownloadItemStatement(
  database: SqlDatabase,
  memberId: string,
  id: DownloadItemId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${DOWNLOAD_ITEM_TABLE} WHERE id = ?1 AND member_id = ?2`)
    .bind(id, memberId);
}

/**
 * The retention sweep's read: rows whose window has closed, across the firm rather than one member.
 * Bounded, because a sweep that tried to answer for an unbounded backlog in one pass is a sweep that
 * times out and never makes progress; the next pass takes the next batch.
 */
export async function readExpiredDownloadItems(
  database: SqlDatabase,
  now: string,
  limit: number,
): Promise<DownloadItemRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${COLUMNS} FROM ${DOWNLOAD_ITEM_TABLE} WHERE expires_at <= ?1 ORDER BY expires_at ASC LIMIT ?2`,
    )
    .bind(now, limit)
    .all();
  return results.map(toRow);
}

export function deleteDownloadItemByIdStatement(
  database: SqlDatabase,
  id: DownloadItemId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${DOWNLOAD_ITEM_TABLE} WHERE id = ?1`).bind(id);
}
