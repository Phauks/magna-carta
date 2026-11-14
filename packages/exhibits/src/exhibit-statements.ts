import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FileId,
  FileVersionId,
  MatterExhibitId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { ExhibitSourceKind } from "./types.ts";

// Table names are tracked against @magna-carta/database's per-firm schema by the schema-sync test.
// `file` and `file_version` are READ here, to check a file belongs to the matter and has a clean
// version; nothing in this package writes them, and no byte of a document passes through it.
export const MATTER_EXHIBIT_TABLE = "matter_exhibit";
const FILE_TABLE = "file";
const FILE_VERSION_TABLE = "file_version";

export interface MatterExhibitRow {
  readonly id: MatterExhibitId;
  readonly matter_id: MatterId;
  readonly reference_name: string;
  readonly title: string;
  readonly description: string | null;
  readonly source_kind: ExhibitSourceKind;
  readonly file_id: FileId;
  readonly pinned_file_version_id: FileVersionId | null;
  readonly page_count: number | null;
  readonly bates_begin: string | null;
  readonly bates_end: string | null;
  readonly created_by: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

export const EXHIBIT_COLUMNS =
  "id, matter_id, reference_name, title, description, source_kind, file_id, " +
  "pinned_file_version_id, page_count, bates_begin, bates_end, created_by, created_at, " +
  "updated_at, archived_at";

export function insertMatterExhibitStatement(
  database: SqlDatabase,
  row: Omit<MatterExhibitRow, "archived_at" | "updated_at">,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_EXHIBIT_TABLE} (${EXHIBIT_COLUMNS}) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, NULL)`,
    )
    .bind(
      row.id,
      row.matter_id,
      row.reference_name,
      row.title,
      row.description,
      row.source_kind,
      row.file_id,
      row.pinned_file_version_id,
      row.page_count,
      row.bates_begin,
      row.bates_end,
      row.created_by,
      row.created_at,
    );
}

// The editable facts. reference_name is deliberately absent: it is minted once and never moves.
export function updateMatterExhibitStatement(
  database: SqlDatabase,
  id: MatterExhibitId,
  fields: {
    readonly title: string;
    readonly description: string | null;
    readonly pinnedFileVersionId: FileVersionId | null;
    readonly pageCount: number | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_EXHIBIT_TABLE} SET title = ?2, description = ?3, ` +
        `pinned_file_version_id = ?4, page_count = ?5, updated_at = ?6 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.title,
      fields.description,
      fields.pinnedFileVersionId,
      fields.pageCount,
      fields.now,
    );
}

// fitness:unguarded-write — archiving an exhibit that is already archived is the outcome asked for.
export function archiveMatterExhibitStatement(
  database: SqlDatabase,
  id: MatterExhibitId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_EXHIBIT_TABLE} SET archived_at = ?2, updated_at = ?2 ` +
        `WHERE id = ?1 AND archived_at IS NULL`,
    )
    .bind(id, now);
}

export async function readMatterExhibit(
  database: SqlDatabase,
  id: MatterExhibitId,
): Promise<MatterExhibitRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${EXHIBIT_COLUMNS} FROM ${MATTER_EXHIBIT_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<MatterExhibitRow>();
  return results[0];
}

/** The reference names on a matter that begin with a base, for the one-shot mint. */
export async function readReferenceNamesLike(
  database: SqlDatabase,
  matterId: MatterId,
  base: string,
): Promise<Set<string>> {
  const { results } = await database
    .prepare(
      `SELECT reference_name FROM ${MATTER_EXHIBIT_TABLE} WHERE matter_id = ?1 ` +
        `AND (reference_name = ?2 OR reference_name GLOB ?2 || '[0-9]*')`,
    )
    .bind(matterId, base)
    .all<{ reference_name: string }>();
  return new Set(results.map((row) => row.reference_name));
}

export async function countMatterExhibits(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${MATTER_EXHIBIT_TABLE} WHERE matter_id = ?1`)
    .bind(matterId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

export interface AttachableFile {
  readonly matterId: MatterId;
  readonly currentVersionId: FileVersionId | null;
  readonly currentVersionClean: boolean;
}

/** A file's matter and whether its current version is clean; undefined when deleted or absent. */
export async function readAttachableFile(
  database: SqlDatabase,
  fileId: FileId,
): Promise<AttachableFile | undefined> {
  const { results } = await database
    .prepare(
      `SELECT f.matter_id AS matter_id, f.current_version_id AS current_version_id, ` +
        `v.status AS status FROM ${FILE_TABLE} f ` +
        `LEFT JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id ` +
        `WHERE f.id = ?1 AND f.deleted_at IS NULL`,
    )
    .bind(fileId)
    .all<{
      matter_id: MatterId;
      current_version_id: FileVersionId | null;
      status: string | null;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    matterId: row.matter_id,
    currentVersionId: row.current_version_id,
    currentVersionClean: row.status === "clean",
  };
}

/** True when the version belongs to the file and is clean. */
export async function isCleanVersionOf(
  database: SqlDatabase,
  fileId: FileId,
  versionId: FileVersionId,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT 1 AS present FROM ${FILE_VERSION_TABLE} WHERE id = ?1 AND file_id = ?2 ` +
        `AND status = 'clean'`,
    )
    .bind(versionId, fileId)
    .all<{ present: number }>();
  return results.length > 0;
}
