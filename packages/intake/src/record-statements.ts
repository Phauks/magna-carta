import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  IntakeProcedureStepId,
  MatterId,
  MatterIntakeStepRecordId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { IntakeRecordOutcome } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_INTAKE_STEP_RECORD_TABLE = "matter_intake_step_record";

export interface MatterIntakeStepRecordRow {
  readonly id: MatterIntakeStepRecordId;
  readonly matter_id: MatterId;
  readonly procedure_step_id: IntakeProcedureStepId;
  readonly outcome: IntakeRecordOutcome;
  readonly rationale: string | null;
  readonly note: string | null;
  readonly recorded_by: UserId;
  readonly recorded_at: string;
  readonly superseded_at: string | null;
  readonly superseded_by: UserId | null;
}

const RECORD_COLUMNS =
  "id, matter_id, procedure_step_id, outcome, rationale, note, recorded_by, recorded_at, " +
  "superseded_at, superseded_by";

export function insertStepRecordStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterIntakeStepRecordId;
    readonly matterId: MatterId;
    readonly procedureStepId: IntakeProcedureStepId;
    readonly outcome: IntakeRecordOutcome;
    readonly rationale: string | null;
    readonly note: string | null;
    readonly recordedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_INTAKE_STEP_RECORD_TABLE} (id, matter_id, procedure_step_id, outcome, ` +
        `rationale, note, recorded_by, recorded_at, superseded_at, superseded_by) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL)`,
    )
    .bind(
      input.id,
      input.matterId,
      input.procedureStepId,
      input.outcome,
      input.rationale,
      input.note,
      input.recordedBy,
      input.now,
    );
}

// The FLIP half of append-and-flip: the live record for this step on this matter, if any, is stamped
// superseded. A statement matching zero rows is fine here — there was nothing live — which is why the
// service reads first when the absence of a live record is itself the refusal (reopening nothing).
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function supersedeLiveStepRecordStatement(
  database: SqlDatabase,
  input: {
    readonly matterId: MatterId;
    readonly procedureStepId: IntakeProcedureStepId;
    readonly supersededBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_INTAKE_STEP_RECORD_TABLE} SET superseded_at = ?1, superseded_by = ?2 ` +
        `WHERE matter_id = ?3 AND procedure_step_id = ?4 AND superseded_at IS NULL`,
    )
    .bind(input.now, input.supersededBy, input.matterId, input.procedureStepId);
}

// Every live record on a matter in one read — the checklist joins them to the steps in memory.
export async function readLiveStepRecords(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterIntakeStepRecordRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${RECORD_COLUMNS} FROM ${MATTER_INTAKE_STEP_RECORD_TABLE} ` +
        `WHERE matter_id = ?1 AND superseded_at IS NULL`,
    )
    .bind(matterId)
    .all<MatterIntakeStepRecordRow>();
  return results;
}

// Every record ever made on a matter, oldest first: the history the append-and-flip rule exists to
// keep, so a step that was recorded done, reopened and recorded again reads as three facts.
export async function readStepRecordHistory(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterIntakeStepRecordRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${RECORD_COLUMNS} FROM ${MATTER_INTAKE_STEP_RECORD_TABLE} ` +
        // rowid breaks a same-instant tie: identifiers are random tokens with no time order.
        `WHERE matter_id = ?1 ORDER BY recorded_at ASC, rowid ASC`,
    )
    .bind(matterId)
    .all<MatterIntakeStepRecordRow>();
  return results;
}
