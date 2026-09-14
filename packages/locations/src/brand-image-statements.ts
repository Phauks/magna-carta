import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const FIRM_BRAND_IMAGE_TABLE = "firm_brand_image";

export type FirmBrandImageRole = "primary" | "additional";

/** One of the firm's marks, as stored. The id IS the SHA-256 of the bytes. */
export interface FirmBrandImageRow {
  readonly id: string;
  readonly role: FirmBrandImageRole;
  readonly label: string | null;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawFirmBrandImageRow {
  id: string;
  role: FirmBrandImageRole;
  label: string | null;
  object_key: string;
  content_type: string;
  size_bytes: number;
  width_pixels: number;
  height_pixels: number;
  created_at: string;
  updated_at: string;
}

function rowOf(row: RawFirmBrandImageRow): FirmBrandImageRow {
  return {
    id: row.id,
    role: row.role,
    label: row.label,
    objectKey: row.object_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    widthPixels: row.width_pixels,
    heightPixels: row.height_pixels,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS =
  "id, role, label, object_key, content_type, size_bytes, width_pixels, height_pixels, created_at, updated_at";

/** Every mark the firm holds, the primary first, then the rest in the order they were added. */
export async function readFirmBrandImages(
  database: SqlDatabase,
): Promise<readonly FirmBrandImageRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${COLUMNS} FROM ${FIRM_BRAND_IMAGE_TABLE} ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, created_at, id`,
    )
    .all<RawFirmBrandImageRow>();
  return results.map(rowOf);
}

export async function readFirmBrandImage(
  database: SqlDatabase,
  id: string,
): Promise<FirmBrandImageRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${COLUMNS} FROM ${FIRM_BRAND_IMAGE_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<RawFirmBrandImageRow>();
  const row = results[0];
  return row === undefined ? undefined : rowOf(row);
}

export interface InsertFirmBrandImageRow {
  readonly id: string;
  readonly role: FirmBrandImageRole;
  readonly label: string | null;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly createdAt: string;
}

// Content-addressed, so the same bytes uploaded again is the same row: the insert becomes an update
// of the role and the label, and the facts about the bytes — which cannot have changed — stand.
export function upsertFirmBrandImageStatement(
  database: SqlDatabase,
  row: InsertFirmBrandImageRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FIRM_BRAND_IMAGE_TABLE} (id, role, label, object_key, content_type, size_bytes, width_pixels, height_pixels, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) ON CONFLICT(id) DO UPDATE SET role = excluded.role, label = excluded.label, updated_at = excluded.updated_at`,
    )
    .bind(
      row.id,
      row.role,
      row.label,
      row.objectKey,
      row.contentType,
      row.sizeBytes,
      row.widthPixels,
      row.heightPixels,
      row.createdAt,
    );
}

export function updateFirmBrandImageStatement(
  database: SqlDatabase,
  id: string,
  fields: { readonly role: FirmBrandImageRole; readonly label: string | null },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FIRM_BRAND_IMAGE_TABLE} SET role = ?2, label = ?3, updated_at = ?4 WHERE id = ?1`,
    )
    .bind(id, fields.role, fields.label, updatedAt);
}

// Every primary becomes additional. Run ahead of the statement that makes a new primary, so the
// batch never holds two: the previous mark is kept, not dropped — choosing a new primary is a
// promotion, and nothing is lost by it.
export function demoteFirmPrimaryBrandImageStatement(
  database: SqlDatabase,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FIRM_BRAND_IMAGE_TABLE} SET role = 'additional', updated_at = ?1 WHERE role = 'primary'`,
    )
    .bind(updatedAt);
}

export function deleteFirmBrandImageStatement(database: SqlDatabase, id: string): SqlStatement {
  return database.prepare(`DELETE FROM ${FIRM_BRAND_IMAGE_TABLE} WHERE id = ?1`).bind(id);
}
