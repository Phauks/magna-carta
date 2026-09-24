import type { UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// The member's own picture — the row, and the three statements over it.
//
// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test. This table exists only in the per-firm database; the caller supplies that handle.
//
// EVERY STATEMENT IS ADDRESSED BY THE MEMBER'S USER ID, which is what makes the whole surface safe
// to expose without a permission of its own: the routes bind the SESSION's user id, so a member can
// only ever write their own row and the query has no other shape to take. Reading somebody else's
// picture is a different question with a different door — the roster's.
export const MEMBER_PHOTO_TABLE = "member_photo";

/** One member's picture, as stored. */
export interface MemberPhotoRow {
  readonly memberUserId: UserId;
  readonly sha256: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawMemberPhotoRow {
  member_user_id: UserId;
  sha256: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  width_pixels: number;
  height_pixels: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "member_user_id, sha256, object_key, content_type, size_bytes, width_pixels, height_pixels, created_at, updated_at";

function rowOf(row: RawMemberPhotoRow): MemberPhotoRow {
  return {
    memberUserId: row.member_user_id,
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

/** The member's picture, or undefined where they hold none. */
export async function readMemberPhoto(
  database: SqlDatabase,
  memberUserId: UserId,
): Promise<MemberPhotoRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${COLUMNS} FROM ${MEMBER_PHOTO_TABLE} WHERE member_user_id = ?1`)
    .bind(memberUserId)
    .all<RawMemberPhotoRow>();
  const row = results[0];
  return row === undefined ? undefined : rowOf(row);
}

export interface SetMemberPhotoInput {
  readonly memberUserId: UserId;
  readonly sha256: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly now: string; // ISO-8601 instant
}

/**
 * Sets the member's picture, replacing whatever they held.
 *
 * ONE ROW PER MEMBER IS THE WHOLE MODEL, so this is an upsert rather than a delete-then-insert: a
 * replacement that ran as two statements could be interrupted between them and leave a member with
 * no picture, which is a worse outcome than either of the two they chose between. `created_at`
 * survives the replacement — it dates the member having a picture at all, not these bytes.
 */
export function setMemberPhotoStatement(
  database: SqlDatabase,
  input: SetMemberPhotoInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEMBER_PHOTO_TABLE} ` +
        "(member_user_id, sha256, object_key, content_type, size_bytes, width_pixels, height_pixels, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) " +
        "ON CONFLICT(member_user_id) DO UPDATE SET " +
        "sha256 = excluded.sha256, object_key = excluded.object_key, " +
        "content_type = excluded.content_type, size_bytes = excluded.size_bytes, " +
        "width_pixels = excluded.width_pixels, height_pixels = excluded.height_pixels, " +
        "updated_at = excluded.updated_at",
    )
    .bind(
      input.memberUserId,
      input.sha256,
      input.objectKey,
      input.contentType,
      input.sizeBytes,
      input.widthPixels,
      input.heightPixels,
      input.now,
    );
}

/** Removes the member's picture. A member who holds none is not an error — the act is idempotent. */
export function removeMemberPhotoStatement(
  database: SqlDatabase,
  memberUserId: UserId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MEMBER_PHOTO_TABLE} WHERE member_user_id = ?1`)
    .bind(memberUserId);
}
