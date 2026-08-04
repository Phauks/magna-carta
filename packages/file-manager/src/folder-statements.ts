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

// Termination bound on the in-UPDATE ancestor walk. A matter's folder tree is nowhere near this deep,
// so the cap only ever bites on a tree that is ALREADY cyclic — where an uncapped recursive CTE would
// climb the same loop forever and hang the statement. It bounds the walk; the refusal itself comes
// from the folder being found on the chain, which happens within the first few steps of any cycle this
// guard exists to prevent.
const ANCESTOR_WALK_MAX_DEPTH = 256;

// Re-parents a folder, with the cycle check carried INSIDE the UPDATE. The service walks the ancestor
// chain first, but D1 has no interactive transaction: between that read and this write, a concurrent
// move can re-parent the target under this very folder, and two such moves crossing each other commit
// a parent cycle that detaches a subtree with no repair path (nothing can reach it to move it back).
// So the predicate is re-evaluated against the rows as they are at write time — the recursive CTE
// climbs from the new parent and the move only lands if this folder is not on that chain. A racing
// pair therefore has at most one winner; the loser matches zero rows and moves nothing.
//
// Moving to the matter root (parent NULL) can form no cycle and short-circuits — necessary as well as
// cheap, since `NOT IN` over a set seeded with NULL evaluates to NULL and would refuse every root move.
export function moveFolderStatement(
  database: SqlDatabase,
  id: FolderId,
  parentFolderId: FolderId | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FOLDER_TABLE} SET parent_folder_id = ?2, updated_at = ?3 WHERE id = ?1 AND (?2 IS NULL OR ?1 NOT IN (` +
        `WITH RECURSIVE ancestors(id, depth) AS (` +
        `SELECT ?2, 0 UNION ALL ` +
        `SELECT parent.parent_folder_id, ancestors.depth + 1 FROM ${FOLDER_TABLE} parent ` +
        `JOIN ancestors ON parent.id = ancestors.id ` +
        `WHERE parent.parent_folder_id IS NOT NULL AND ancestors.depth < ${ANCESTOR_WALK_MAX_DEPTH}` +
        `) SELECT id FROM ancestors))`,
    )
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
