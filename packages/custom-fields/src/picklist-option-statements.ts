import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { PicklistOptionId, CustomFieldId } from "@magna-carta/identifiers/types";

const TABLE = "picklist_option";

export function insertPicklistOptionStatement(
  database: SqlDatabase,
  row: { id: PicklistOptionId; fieldId: CustomFieldId; name: string; position: number },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TABLE} (id, field_id, name, position, archived) VALUES (?1, ?2, ?3, ?4, 0)`,
    )
    .bind(row.id, row.fieldId, row.name, row.position);
}

export function updatePicklistOptionNameStatement(
  database: SqlDatabase,
  id: PicklistOptionId,
  name: string,
): SqlStatement {
  return database.prepare(`UPDATE ${TABLE} SET name = ?2 WHERE id = ?1`).bind(id, name);
}

export function setPicklistOptionArchivedStatement(
  database: SqlDatabase,
  id: PicklistOptionId,
  archived: number,
): SqlStatement {
  return database.prepare(`UPDATE ${TABLE} SET archived = ?2 WHERE id = ?1`).bind(id, archived);
}

export function setPicklistOptionPositionStatement(
  database: SqlDatabase,
  id: PicklistOptionId,
  position: number,
): SqlStatement {
  return database.prepare(`UPDATE ${TABLE} SET position = ?2 WHERE id = ?1`).bind(id, position);
}

export function deletePicklistOptionStatement(
  database: SqlDatabase,
  id: PicklistOptionId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${TABLE} WHERE id = ?1`).bind(id);
}
