import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterEventTypeId } from "@magna-carta/identifiers/types";
import type { MatterEventCategory, MatterEventTypeOrigin } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_EVENT_TYPE_TABLE = "matter_event_type";

export interface MatterEventTypeRow {
  readonly id: MatterEventTypeId;
  readonly name: string;
  readonly code: string | null;
  readonly category: MatterEventCategory;
  readonly origin: MatterEventTypeOrigin;
  readonly active: number;
}

const TYPE_COLUMNS = "id, name, code, category, origin, active";

export function insertMatterEventTypeStatement(
  database: SqlDatabase,
  row: {
    readonly id: MatterEventTypeId;
    readonly name: string;
    readonly code: string | null;
    readonly category: MatterEventCategory;
    readonly createdAt: string;
  },
): SqlStatement {
  // A firm-created row is always `firm` origin. Nothing in the API can mint a `platform` row: the
  // platform vocabulary arrives by migration, so a firm cannot quietly claim a shared term.
  return database
    .prepare(
      `INSERT INTO ${MATTER_EVENT_TYPE_TABLE} (id, name, code, category, origin, active, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, 'firm', 1, ?5, ?5)`,
    )
    .bind(row.id, row.name, row.code, row.category, row.createdAt);
}

export function updateMatterEventTypeStatement(
  database: SqlDatabase,
  id: MatterEventTypeId,
  patch: {
    readonly name: string;
    readonly code: string | null;
    readonly category: MatterEventCategory;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_EVENT_TYPE_TABLE} SET name = ?2, code = ?3, category = ?4, updated_at = ?5 WHERE id = ?1`,
    )
    .bind(id, patch.name, patch.code, patch.category, updatedAt);
}

// Deactivated, never deleted: every event already classified under a retired type keeps its meaning.
export function deactivateMatterEventTypeStatement(
  database: SqlDatabase,
  id: MatterEventTypeId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${MATTER_EVENT_TYPE_TABLE} SET active = 0, updated_at = ?2 WHERE id = ?1`)
    .bind(id, updatedAt);
}

export function selectMatterEventTypeStatement(
  database: SqlDatabase,
  id: MatterEventTypeId,
): SqlStatement {
  return database
    .prepare(`SELECT ${TYPE_COLUMNS} FROM ${MATTER_EVENT_TYPE_TABLE} WHERE id = ?1`)
    .bind(id);
}

export function selectMatterEventTypeIdByNameStatement(
  database: SqlDatabase,
  name: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${MATTER_EVENT_TYPE_TABLE} WHERE name = ?1`).bind(name);
}

export function selectMatterEventTypeIdByCodeStatement(
  database: SqlDatabase,
  code: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${MATTER_EVENT_TYPE_TABLE} WHERE code = ?1`).bind(code);
}

export function selectMatterEventTypesStatement(
  database: SqlDatabase,
  includeInactive: boolean,
): SqlStatement {
  const activeFilter = includeInactive ? "" : "WHERE active = 1 ";
  return database.prepare(
    `SELECT ${TYPE_COLUMNS} FROM ${MATTER_EVENT_TYPE_TABLE} ${activeFilter}ORDER BY category ASC, name ASC`,
  );
}

export async function readMatterEventType(
  database: SqlDatabase,
  id: MatterEventTypeId,
): Promise<MatterEventTypeRow | undefined> {
  const { results } = await selectMatterEventTypeStatement(database, id).all<MatterEventTypeRow>();
  return results[0];
}

export async function readMatterEventTypes(
  database: SqlDatabase,
  includeInactive = false,
): Promise<MatterEventTypeRow[]> {
  const { results } = await selectMatterEventTypesStatement(
    database,
    includeInactive,
  ).all<MatterEventTypeRow>();
  return results;
}
