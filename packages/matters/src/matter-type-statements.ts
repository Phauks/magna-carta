import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterTypeId } from "@magna-carta/identifiers/types";

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const MATTER_TYPE_TABLE = "matter_type";

export interface InsertMatterTypeRow {
  readonly id: MatterTypeId;
  readonly name: string;
  readonly code: string | null;
  readonly createdAt: string;
}

export function insertMatterTypeStatement(
  database: SqlDatabase,
  row: InsertMatterTypeRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TYPE_TABLE} (id, name, code, active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)`,
    )
    .bind(row.id, row.name, row.code, row.createdAt);
}

export function updateMatterTypeStatement(
  database: SqlDatabase,
  id: MatterTypeId,
  name: string,
  code: string | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${MATTER_TYPE_TABLE} SET name = ?2, code = ?3, updated_at = ?4 WHERE id = ?1`)
    .bind(id, name, code, updatedAt);
}

export function deactivateMatterTypeStatement(
  database: SqlDatabase,
  id: MatterTypeId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${MATTER_TYPE_TABLE} SET active = 0, updated_at = ?2 WHERE id = ?1`)
    .bind(id, updatedAt);
}

export function selectMatterTypeStatement(database: SqlDatabase, id: MatterTypeId): SqlStatement {
  return database
    .prepare(`SELECT id, name, code, active FROM ${MATTER_TYPE_TABLE} WHERE id = ?1`)
    .bind(id);
}

// Uniqueness pre-check: is `name`/`code` already taken by a DIFFERENT type? excludeId lets an update
// re-save its own row without colliding with itself. The UNIQUE indexes are the backstop.
export function selectMatterTypeIdByNameStatement(
  database: SqlDatabase,
  name: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${MATTER_TYPE_TABLE} WHERE name = ?1`).bind(name);
}

export function selectMatterTypeIdByCodeStatement(
  database: SqlDatabase,
  code: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${MATTER_TYPE_TABLE} WHERE code = ?1`).bind(code);
}
