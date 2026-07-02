import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FolderId, MatterId } from "@magna-carta/identifiers/types";

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const FOLDER_TABLE = "folder";

export interface InsertFolderRow {
  readonly id: FolderId;
  readonly matterId: MatterId;
  readonly parentFolderId: FolderId | null;
  readonly name: string;
  readonly createdAt: string;
}

export function insertFolderStatement(database: SqlDatabase, row: InsertFolderRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FOLDER_TABLE} (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    )
    .bind(row.id, row.matterId, row.parentFolderId, row.name, row.createdAt);
}

export function renameFolderStatement(
  database: SqlDatabase,
  id: FolderId,
  name: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FOLDER_TABLE} SET name = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, name, updatedAt);
}

export function moveFolderStatement(
  database: SqlDatabase,
  id: FolderId,
  parentFolderId: FolderId | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FOLDER_TABLE} SET parent_folder_id = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, parentFolderId, updatedAt);
}

export function deleteFolderStatement(database: SqlDatabase, id: FolderId): SqlStatement {
  return database.prepare(`DELETE FROM ${FOLDER_TABLE} WHERE id = ?1`).bind(id);
}

export function selectFolderStatement(database: SqlDatabase, id: FolderId): SqlStatement {
  return database
    .prepare(`SELECT id, matter_id, parent_folder_id, name FROM ${FOLDER_TABLE} WHERE id = ?1`)
    .bind(id);
}

// Sibling-name uniqueness check. NULL parent (matter root) needs an explicit IS-NULL branch because
// SQLite's UNIQUE treats NULLs as distinct — the service enforces the root case the index cannot.
export function selectFolderIdByNameStatement(
  database: SqlDatabase,
  matterId: MatterId,
  parentFolderId: FolderId | null,
  name: string,
): SqlStatement {
  if (parentFolderId === null) {
    return database
      .prepare(
        `SELECT id FROM ${FOLDER_TABLE} WHERE matter_id = ?1 AND parent_folder_id IS NULL AND name = ?2`,
      )
      .bind(matterId, name);
  }
  return database
    .prepare(
      `SELECT id FROM ${FOLDER_TABLE} WHERE matter_id = ?1 AND parent_folder_id = ?2 AND name = ?3`,
    )
    .bind(matterId, parentFolderId, name);
}

// Emptiness check for delete: a child folder or a file (any status, incl. soft-deleted — a folder
// holding deleted files is not "empty" enough to drop) blocks the delete.
export function selectFolderChildFolderStatement(
  database: SqlDatabase,
  id: FolderId,
): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${FOLDER_TABLE} WHERE parent_folder_id = ?1 LIMIT 1`)
    .bind(id);
}
