import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { TransferRunId, UserId } from "@magna-carta/identifiers/types";
import { assertSourceSystem } from "./source-record.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const TRANSFER_RUN_TABLE = "transfer_run";

export interface TransferRunRow {
  readonly id: TransferRunId;
  readonly source_system: string;
  readonly label: string;
  readonly started_by: UserId;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly abandoned_at: string | null;
}

export interface NewTransferRun {
  readonly id: TransferRunId;
  readonly sourceSystem: string;
  readonly label: string;
  readonly startedBy: UserId;
}

export function insertTransferRunStatement(
  database: SqlDatabase,
  run: NewTransferRun,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRANSFER_RUN_TABLE} (id, source_system, label, started_by, started_at, completed_at, abandoned_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL)`,
    )
    .bind(run.id, assertSourceSystem(run.sourceSystem), run.label, run.startedBy, now);
}

export function selectTransferRunStatement(database: SqlDatabase, id: TransferRunId): SqlStatement {
  return database
    .prepare(
      `SELECT id, source_system, label, started_by, started_at, completed_at, abandoned_at FROM ${TRANSFER_RUN_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// Newest first: the run an operator is looking for is nearly always the last one.
export function selectTransferRunsStatement(
  database: SqlDatabase,
  sourceSystem: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, source_system, label, started_by, started_at, completed_at, abandoned_at FROM ${TRANSFER_RUN_TABLE} WHERE source_system = ?1 ORDER BY started_at DESC, id DESC`,
    )
    .bind(assertSourceSystem(sourceSystem));
}

// A run ends once. The WHERE repeats "still open", so ending a run that has already ended matches no
// row, and the caller reads the row count to say so.
// fitness:unguarded-write — zero rows means the run had already ended, an outcome the caller reports; the run's links stand either way
export function completeTransferRunStatement(
  database: SqlDatabase,
  id: TransferRunId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRANSFER_RUN_TABLE} SET completed_at = ?2 WHERE id = ?1 AND completed_at IS NULL AND abandoned_at IS NULL`,
    )
    .bind(id, now);
}

// Abandoning keeps the run and every link it wrote: the records it created are real, and "this run
// was stopped part way" is exactly what a later reader needs to know about them.
// fitness:unguarded-write — zero rows means the run had already ended, an outcome the caller reports; the run's links stand either way
export function abandonTransferRunStatement(
  database: SqlDatabase,
  id: TransferRunId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRANSFER_RUN_TABLE} SET abandoned_at = ?2 WHERE id = ?1 AND completed_at IS NULL AND abandoned_at IS NULL`,
    )
    .bind(id, now);
}
