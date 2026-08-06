import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterAssetTypeId } from "@magna-carta/identifiers/types";
import type { MatterAssetClass } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_ASSET_TYPE_TABLE = "matter_asset_type";

export interface MatterAssetTypeRow {
  readonly id: MatterAssetTypeId;
  readonly name: string;
  readonly class: MatterAssetClass;
  readonly code: string | null;
  readonly active: number;
  readonly position: number;
}

const TYPE_COLUMNS = "id, name, class, code, active, position";

export function selectMatterAssetTypeStatement(
  database: SqlDatabase,
  id: MatterAssetTypeId,
): SqlStatement {
  return database
    .prepare(`SELECT ${TYPE_COLUMNS} FROM ${MATTER_ASSET_TYPE_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readMatterAssetType(
  database: SqlDatabase,
  id: MatterAssetTypeId,
): Promise<MatterAssetTypeRow | undefined> {
  const { results } = await selectMatterAssetTypeStatement(database, id).all<MatterAssetTypeRow>();
  return results[0];
}

export function selectMatterAssetTypeIdByNameStatement(
  database: SqlDatabase,
  name: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${MATTER_ASSET_TYPE_TABLE} WHERE name = ?1`).bind(name);
}

export function selectMatterAssetTypeIdByCodeStatement(
  database: SqlDatabase,
  code: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${MATTER_ASSET_TYPE_TABLE} WHERE code = ?1`).bind(code);
}

// The class is written by a follow-up statement in the same batch rather than by this insert,
// because the shared classification-type shape owns the (id, name, code) insert and this catalog's
// one extra column rides beside it — the custody item type's intrinsic-value default precedent.
export function insertMatterAssetTypeStatement(
  database: SqlDatabase,
  row: { id: MatterAssetTypeId; name: string; code: string | null; createdAt: string },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_TYPE_TABLE} (id, name, class, code, created_at, updated_at) ` +
        `VALUES (?1, ?2, 'other', ?3, ?4, ?4)`,
    )
    .bind(row.id, row.name, row.code, row.createdAt);
}

export function updateMatterAssetTypeStatement(
  database: SqlDatabase,
  id: MatterAssetTypeId,
  name: string,
  code: string | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_ASSET_TYPE_TABLE} SET name = ?2, code = ?3, updated_at = ?4 WHERE id = ?1`,
    )
    .bind(id, name, code, updatedAt);
}

// A type is deactivated, never deleted: every asset already classified under it keeps its meaning.
export function deactivateMatterAssetTypeStatement(
  database: SqlDatabase,
  id: MatterAssetTypeId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${MATTER_ASSET_TYPE_TABLE} SET active = 0, updated_at = ?2 WHERE id = ?1`)
    .bind(id, updatedAt);
}

// The class a new type is declared under, set in the same batch as the insert. There is no path that
// MOVES an existing type between classes: an asset already carries the class, so a type that changed
// class would silently break the type-class agreement on every row already filed under it.
export function setMatterAssetTypeClassStatement(
  database: SqlDatabase,
  id: MatterAssetTypeId,
  assetClass: MatterAssetClass,
  position: number,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_ASSET_TYPE_TABLE} SET class = ?2, position = ?3, updated_at = ?4 WHERE id = ?1`,
    )
    .bind(id, assetClass, position, updatedAt);
}

// The catalog read: everything under one class in the firm's own order, or the whole catalog when no
// class is named.
export function selectMatterAssetTypesStatement(
  database: SqlDatabase,
  options: { readonly assetClass?: MatterAssetClass; readonly includeInactive?: boolean },
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.assetClass !== undefined) {
    bindings.push(options.assetClass);
    conditions.push(`class = ?${bindings.length}`);
  }
  if (options.includeInactive !== true) conditions.push("active = 1");
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")} `;
  return database
    .prepare(
      `SELECT ${TYPE_COLUMNS} FROM ${MATTER_ASSET_TYPE_TABLE} ${where}ORDER BY class ASC, position ASC, name ASC`,
    )
    .bind(...bindings);
}

export async function readMatterAssetTypes(
  database: SqlDatabase,
  options: { readonly assetClass?: MatterAssetClass; readonly includeInactive?: boolean } = {},
): Promise<MatterAssetTypeRow[]> {
  const { results } = await selectMatterAssetTypesStatement(
    database,
    options,
  ).all<MatterAssetTypeRow>();
  return results;
}
