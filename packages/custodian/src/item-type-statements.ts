import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyItemTypeId } from "@magna-carta/identifiers/types";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CUSTODY_ITEM_TYPE_TABLE = "custody_item_type";

export interface CustodyItemTypeRow {
  readonly id: CustodyItemTypeId;
  readonly name: string;
  readonly code: string | null;
  readonly intrinsic_value_default: number;
  readonly active: number;
}

export function insertCustodyItemTypeStatement(
  database: SqlDatabase,
  row: { id: CustodyItemTypeId; name: string; code: string | null; createdAt: string },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_ITEM_TYPE_TABLE} (id, name, code, intrinsic_value_default, active, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 1, ?4, ?4)`,
    )
    .bind(row.id, row.name, row.code, row.createdAt);
}

export function updateCustodyItemTypeStatement(
  database: SqlDatabase,
  id: CustodyItemTypeId,
  name: string,
  code: string | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_ITEM_TYPE_TABLE} SET name = ?2, code = ?3, updated_at = ?4 WHERE id = ?1`,
    )
    .bind(id, name, code, updatedAt);
}

export function deactivateCustodyItemTypeStatement(
  database: SqlDatabase,
  id: CustodyItemTypeId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${CUSTODY_ITEM_TYPE_TABLE} SET active = 0, updated_at = ?2 WHERE id = ?1`)
    .bind(id, updatedAt);
}

// The type's own intrinsic-value default, which seeds (never fixes) the flag on a new item. Split
// from the shared classification insert because the shared shape is (id, name, code, active) and
// this column is Custodian's alone; carrying it as a follow-up statement in the same effect batch is
// cheaper than forking the shared service for one column.
export function setCustodyItemTypeIntrinsicDefaultStatement(
  database: SqlDatabase,
  id: CustodyItemTypeId,
  intrinsicValueDefault: boolean,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_ITEM_TYPE_TABLE} SET intrinsic_value_default = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, intrinsicValueDefault ? 1 : 0, updatedAt);
}

export function selectCustodyItemTypeStatement(
  database: SqlDatabase,
  id: CustodyItemTypeId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, name, code, intrinsic_value_default, active FROM ${CUSTODY_ITEM_TYPE_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// Uniqueness pre-checks; the UNIQUE indexes are the backstop.
export function selectCustodyItemTypeIdByNameStatement(
  database: SqlDatabase,
  name: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${CUSTODY_ITEM_TYPE_TABLE} WHERE name = ?1`).bind(name);
}

export function selectCustodyItemTypeIdByCodeStatement(
  database: SqlDatabase,
  code: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${CUSTODY_ITEM_TYPE_TABLE} WHERE code = ?1`).bind(code);
}

export function selectCustodyItemTypesStatement(
  database: SqlDatabase,
  includeInactive: boolean,
): SqlStatement {
  const activeFilter = includeInactive ? "" : "WHERE active = 1 ";
  return database.prepare(
    `SELECT id, name, code, intrinsic_value_default, active FROM ${CUSTODY_ITEM_TYPE_TABLE} ${activeFilter}ORDER BY name ASC`,
  );
}

export async function readCustodyItemType(
  database: SqlDatabase,
  id: CustodyItemTypeId,
): Promise<CustodyItemTypeRow | undefined> {
  const { results } = await selectCustodyItemTypeStatement(database, id).all<CustodyItemTypeRow>();
  return results[0];
}

export async function readCustodyItemTypes(
  database: SqlDatabase,
  includeInactive = false,
): Promise<CustodyItemTypeRow[]> {
  const { results } = await selectCustodyItemTypesStatement(
    database,
    includeInactive,
  ).all<CustodyItemTypeRow>();
  return results;
}
