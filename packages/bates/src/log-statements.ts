import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { BatesLogId, MatterId, UserId } from "@magna-carta/identifiers/types";

export const BATES_LOG_TABLE = "bates_log";

export interface BatesLogRow {
  readonly id: BatesLogId;
  readonly matter_id: MatterId;
  readonly name: string;
  readonly prefix: string;
  readonly digits: number;
  readonly created_by: UserId | null;
  readonly created_at: string;
}

const LOG_COLUMNS = "id, matter_id, name, prefix, digits, created_by, created_at";

/** Starts a log, guarded on no other log on the matter having the name. */
export function insertLogStatement(
  database: SqlDatabase,
  row: {
    readonly id: BatesLogId;
    readonly matterId: MatterId;
    readonly name: string;
    readonly prefix: string;
    readonly digits: number;
    readonly createdBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${BATES_LOG_TABLE} (${LOG_COLUMNS}) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 ` +
        `WHERE NOT EXISTS (SELECT 1 FROM ${BATES_LOG_TABLE} WHERE matter_id = ?2 AND name = ?3)`,
    )
    .bind(row.id, row.matterId, row.name, row.prefix, row.digits, row.createdBy, row.now);
}

/** Renames a log, guarded on no other log on the matter having the new name. */
export function renameLogStatement(
  database: SqlDatabase,
  id: BatesLogId,
  matterId: MatterId,
  name: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${BATES_LOG_TABLE} SET name = ?3 WHERE id = ?1 AND matter_id = ?2 ` +
        `AND NOT EXISTS (SELECT 1 FROM ${BATES_LOG_TABLE} WHERE matter_id = ?2 AND name = ?3 AND id <> ?1)`,
    )
    .bind(id, matterId, name);
}

export async function readLogRow(
  database: SqlDatabase,
  id: BatesLogId,
): Promise<BatesLogRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${LOG_COLUMNS} FROM ${BATES_LOG_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<BatesLogRow>();
  return results[0];
}

export async function readLogByName(
  database: SqlDatabase,
  matterId: MatterId,
  name: string,
): Promise<BatesLogRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${LOG_COLUMNS} FROM ${BATES_LOG_TABLE} WHERE matter_id = ?1 AND name = ?2`)
    .bind(matterId, name)
    .all<BatesLogRow>();
  return results[0];
}
