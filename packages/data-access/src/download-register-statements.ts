import type { DownloadItemId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";
import { askableTerm, likePattern, LIKE_ESCAPE_CLAUSE } from "./like-search.ts";

// The download register — one member's shelf of what the platform produced for them, held for a
// short window and swept. Behavior over the table lives here; the structure lives in
// @magna-carta/database's per-firm schema.
//
// EVERY READ IS SCOPED TO A MEMBER, and that is a property of this module rather than of its
// callers: there is deliberately no "list the firm's shelf" statement, so a route cannot acquire one
// by forgetting a parameter. A firm-wide administrative view is a different question with a
// different key, and it would get its own statement saying so.
export const DOWNLOAD_ITEM_TABLE = "download_item";

export type DownloadItemKind = "artifact" | "snapshot" | "reference" | "record";
export type DownloadItemProducer = "export" | "bundle" | "conversion" | "file" | "discovery";
export type DownloadItemState = "building" | "ready" | "failed" | "expired";

export interface DownloadItemRow {
  readonly id: DownloadItemId;
  readonly memberId: string;
  readonly title: string;
  readonly kind: DownloadItemKind;
  readonly producer: DownloadItemProducer;
  /** The bytes' key; null on a reference, which holds none of the register's own. */
  readonly objectKey: string | null;
  /** The matter file a reference points at; null on every other kind. */
  readonly subjectFileId: string | null;
  readonly byteSize: number | null;
  /** The format the item was MADE for; null on rows written before the column existed. */
  readonly requestedFormat: string | null;
  readonly downloadedFormats: readonly string[];
  readonly createdAt: string;
  /** When the BYTES let go — not the row, which is kept. Null on a reference. */
  readonly expiresAt: string | null;
  readonly state: DownloadItemState;
}

export interface DownloadItemInsert {
  readonly id: DownloadItemId;
  readonly memberId: string;
  readonly title: string;
  readonly kind: DownloadItemKind;
  readonly producer: DownloadItemProducer;
  readonly objectKey: string | null;
  readonly subjectFileId: string | null;
  readonly byteSize: number | null;
  readonly requestedFormat: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
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
    objectKey: typeof record["object_key"] === "string" ? record["object_key"] : null,
    subjectFileId: typeof record["subject_file_id"] === "string" ? record["subject_file_id"] : null,
    byteSize: record["byte_size"] === null ? null : Number(record["byte_size"]),
    requestedFormat:
      typeof record["requested_format"] === "string" ? record["requested_format"] : null,
    downloadedFormats: parseFormats(record["downloaded_formats_json"]),
    createdAt: String(record["created_at"]),
    expiresAt: typeof record["expires_at"] === "string" ? record["expires_at"] : null,
    state: record["state"] as DownloadItemState,
  };
}

const COLUMNS =
  "id, member_id, title, kind, producer, object_key, subject_file_id, byte_size, requested_format, downloaded_formats_json, created_at, expires_at, state";

export function insertDownloadItemStatement(
  database: SqlDatabase,
  row: DownloadItemInsert,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DOWNLOAD_ITEM_TABLE} (id, member_id, title, kind, producer, object_key, subject_file_id, byte_size, requested_format, downloaded_formats_json, created_at, expires_at, state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]', ?10, ?11, ?12)`,
    )
    .bind(
      row.id,
      row.memberId,
      row.title,
      row.kind,
      row.producer,
      row.objectKey,
      row.subjectFileId,
      row.byteSize,
      row.requestedFormat,
      row.createdAt,
      row.expiresAt,
      row.state,
    );
}

/** Where a page left off: the (created_at, id) pair of the last row it returned. */
export interface DownloadShelfCursor {
  readonly createdAt: string;
  readonly id: string;
}

/**
 * One member's register, newest first, one page at a time.
 *
 * IT USED TO BE A WHOLE READ, and the comment here said why: the shelf was short-lived by
 * construction, so a limit was a guard against a pathological producer rather than a page. Two
 * changes took that premise away — every download registers now, not only what the platform made,
 * and the row outlives the bytes rather than being swept with them — so a member's register grows
 * without bound and paging is the only honest read.
 *
 * The walk is the (created_at, id) pair the index leads on, which is what makes the order TOTAL: two
 * rows written in the same millisecond still have a definite order, so a page boundary landing
 * between them can neither repeat one nor drop it. Comparing the pair as a tuple is the whole
 * mechanism — `created_at < ?` alone would skip every sibling of the last row on the page.
 *
 * A `search` narrows the whole register rather than the page in hand, which is the only honest way
 * to search a paged read: narrowing what was loaded would answer confidently about a fraction of a
 * register that has no bound.
 */
export async function readDownloadShelf(
  database: SqlDatabase,
  memberId: string,
  limit: number,
  after?: DownloadShelfCursor,
  search?: string,
): Promise<DownloadItemRow[]> {
  const bindings: (string | number)[] = [memberId];
  const conditions = ["member_id = ?1"];
  if (after !== undefined) {
    bindings.push(after.createdAt, after.id);
    conditions.push(
      `(created_at, id) < (?${String(bindings.length - 1)}, ?${String(bindings.length)})`,
    );
  }
  // The title is the whole of what is searched, because it is the whole of what a member has to
  // recognise a row by: everything else on a download is a kind, a state or an instant, each of
  // which the register's own column filters already narrow on, exactly and without a term.
  const term = askableTerm(search);
  if (term !== undefined) {
    bindings.push(likePattern(term));
    conditions.push(`title LIKE ?${String(bindings.length)} ${LIKE_ESCAPE_CLAUSE}`);
  }
  bindings.push(limit);
  const { results } = await database
    .prepare(
      `SELECT ${COLUMNS} FROM ${DOWNLOAD_ITEM_TABLE}
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC, id DESC LIMIT ?${String(bindings.length)}`,
    )
    .bind(...bindings)
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
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
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

/**
 * Advance a row that was registered before its bytes existed, found by the object it named.
 *
 * Keyed on the OBJECT rather than on the row id, because the producer that learns the work finished
 * is not always the one that wrote the row — a conversion is registered by the route that submits it
 * and completed by whichever poll first sees the job done, and carrying the row id between those two
 * would mean threading it through a Durable Object's state. The key is already unique per job, and
 * it is the same fact both halves have.
 *
 * Idempotent on purpose: the poll runs repeatedly, so setting a ready row ready again is a no-op
 * rather than something the caller has to guard.
 */
// fitness:unguarded-write — the poll is repeated by design, so matching no row means an earlier poll already marked it ready
export function markDownloadItemReadyByObjectKeyStatement(
  database: SqlDatabase,
  memberId: string,
  objectKey: string,
  byteSize: number | null,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOWNLOAD_ITEM_TABLE}
         SET state = 'ready', byte_size = COALESCE(?4, byte_size)
       WHERE member_id = ?1 AND object_key = ?2 AND state = ?3`,
    )
    .bind(memberId, objectKey, "building", byteSize);
}

/** A member clearing their own shelf. Member-scoped for the reason the single read is. */
// fitness:unguarded-write — a member clearing their own shelf; an item already gone is the state they asked for
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
 * The retention sweep's read: rows whose BYTES are due to be released, across the firm rather than
 * one member. Bounded, because a sweep that tried to answer for an unbounded backlog in one pass is
 * a sweep that times out and never makes progress; the next pass takes the next batch.
 *
 * ALREADY-EXPIRED ROWS ARE EXCLUDED, and that predicate is what makes the sweep terminate now that
 * it marks rather than deletes. Without it every swept row would be re-selected by every later pass
 * for ever, and the batch ceiling would mean the oldest rows were the only ones ever looked at.
 *
 * A REFERENCE IS NEVER SELECTED, without a predicate naming it: its expiry is null, and null never
 * satisfies the range. That is the point of storing it as null rather than as a far-future instant.
 */
export async function readExpiredDownloadItems(
  database: SqlDatabase,
  now: string,
  limit: number,
): Promise<DownloadItemRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${COLUMNS} FROM ${DOWNLOAD_ITEM_TABLE}
         WHERE expires_at <= ?1 AND state <> 'expired'
         ORDER BY expires_at ASC LIMIT ?2`,
    )
    .bind(now, limit)
    .all();
  return results.map(toRow);
}

/**
 * Release a row's bytes without releasing the row.
 *
 * The register keeps what a member downloaded; the seven-day window is about the COPY it was holding
 * for them. So the sweep marks instead of deleting.
 *
 * THE OBJECT KEY IS DELIBERATELY LEFT IN PLACE. Clearing it reads like tidiness and is not: the
 * schema states that a key is present exactly when the row is not a reference, which is the
 * constraint that stops a matter file ever reaching the presigning branch, and nulling the key on
 * expiry would make that biconditional unwritable. The stale key is not a capability either — every
 * fetch checks `state` before it reaches the key, so an expired row is refused before anything is
 * signed, and keeping the key leaves a support question ("which object was that") answerable.
 */
export function expireDownloadItemStatement(
  database: SqlDatabase,
  id: DownloadItemId,
): SqlStatement {
  return database
    .prepare(`UPDATE ${DOWNLOAD_ITEM_TABLE} SET state = 'expired' WHERE id = ?1`)
    .bind(id);
}
