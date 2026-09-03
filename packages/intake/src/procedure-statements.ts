import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  IntakeProcedureId,
  IntakeProcedureStepId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { IntakeStepKind } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const INTAKE_PROCEDURE_TABLE = "intake_procedure";
export const INTAKE_PROCEDURE_STEP_TABLE = "intake_procedure_step";

// A procedure carries no matter and therefore no visible-matter predicate. It is firm configuration —
// the posture matter_type and matter_plan_template take — and reaching it is governed by
// intake:manageProcedures at the route rather than by a predicate here. The one read that DOES touch
// a matter is the checklist, and it takes the matter by id like every other matter-scoped read.

export interface IntakeProcedureRow {
  readonly id: IntakeProcedureId;
  readonly name: string;
  readonly description: string | null;
  readonly matter_type_id: MatterTypeId | null;
  readonly active: number;
  readonly created_by: UserId;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface IntakeProcedureStepRow {
  readonly id: IntakeProcedureStepId;
  readonly procedure_id: IntakeProcedureId;
  readonly kind: IntakeStepKind;
  readonly title: string;
  readonly instructions: string | null;
  readonly required: number;
  readonly reference_id: string | null;
  readonly position: number;
  readonly active: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const PROCEDURE_COLUMNS =
  "id, name, description, matter_type_id, active, created_by, created_at, updated_at";
const STEP_COLUMNS =
  "id, procedure_id, kind, title, instructions, required, reference_id, position, active, " +
  "created_at, updated_at";

// ---- the procedure ----

export function insertProcedureStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeProcedureId;
    readonly name: string;
    readonly description: string | null;
    readonly matterTypeId: MatterTypeId | null;
    readonly createdBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTAKE_PROCEDURE_TABLE} (id, name, description, matter_type_id, active, ` +
        `created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)`,
    )
    .bind(input.id, input.name, input.description, input.matterTypeId, input.createdBy, input.now);
}

export function updateProcedureStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeProcedureId;
    readonly name: string;
    readonly description: string | null;
    readonly matterTypeId: MatterTypeId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTAKE_PROCEDURE_TABLE} SET name = ?1, description = ?2, matter_type_id = ?3, ` +
        `updated_at = ?4 WHERE id = ?5`,
    )
    .bind(input.name, input.description, input.matterTypeId, input.now, input.id);
}

// Soft-deactivation. A procedure is never deleted: a record on a matter names one of its steps, and a
// firm asking what its old procedure required needs the row to answer. The same discipline
// matter_type and matter_plan_template use.
export function setProcedureActiveStatement(
  database: SqlDatabase,
  id: IntakeProcedureId,
  active: boolean,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${INTAKE_PROCEDURE_TABLE} SET active = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(active ? 1 : 0, now, id);
}

export function selectProceduresStatement(
  database: SqlDatabase,
  options: { readonly limit: number; readonly includeInactive: boolean },
): SqlStatement {
  const where = options.includeInactive ? "" : "WHERE active = 1 ";
  return database
    .prepare(
      `SELECT ${PROCEDURE_COLUMNS} FROM ${INTAKE_PROCEDURE_TABLE} ${where}ORDER BY name ASC, id ASC LIMIT ?1`,
    )
    .bind(options.limit);
}

export async function readProcedure(
  database: SqlDatabase,
  id: IntakeProcedureId,
): Promise<IntakeProcedureRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${PROCEDURE_COLUMNS} FROM ${INTAKE_PROCEDURE_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<IntakeProcedureRow>();
  return results[0];
}

// Whether another procedure already wears this name. Read before the write so the refusal carries a
// code rather than surfacing as the unique index's constraint failure.
export async function readProcedureIdByName(
  database: SqlDatabase,
  name: string,
): Promise<IntakeProcedureId | undefined> {
  const { results } = await database
    .prepare(`SELECT id FROM ${INTAKE_PROCEDURE_TABLE} WHERE name = ?1`)
    .bind(name)
    .all<{ id: IntakeProcedureId }>();
  return results[0]?.id;
}

// The procedures that bind a matter of this type: those bound to the type, plus those bound to no
// type at all. A matter with no type is bound only by the type-less procedures.
export async function readProceduresBinding(
  database: SqlDatabase,
  matterTypeId: MatterTypeId | null,
  limit: number,
): Promise<IntakeProcedureRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${PROCEDURE_COLUMNS} FROM ${INTAKE_PROCEDURE_TABLE} ` +
        `WHERE active = 1 AND (matter_type_id IS NULL OR matter_type_id = ?1) ` +
        `ORDER BY name ASC, id ASC LIMIT ?2`,
    )
    .bind(matterTypeId, limit)
    .all<IntakeProcedureRow>();
  return results;
}

// ---- the steps ----

export function insertProcedureStepStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeProcedureStepId;
    readonly procedureId: IntakeProcedureId;
    readonly kind: IntakeStepKind;
    readonly title: string;
    readonly instructions: string | null;
    readonly required: boolean;
    readonly referenceId: string | null;
    readonly position: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTAKE_PROCEDURE_STEP_TABLE} (id, procedure_id, kind, title, instructions, ` +
        `required, reference_id, position, active, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)`,
    )
    .bind(
      input.id,
      input.procedureId,
      input.kind,
      input.title,
      input.instructions,
      input.required ? 1 : 0,
      input.referenceId,
      input.position,
      input.now,
    );
}

// Every field is replaced. The kind is deliberately NOT among them: a step's kind decides who answers
// it, and a record on a matter that answered a document step must not wake up answering a conflicts
// step. A different kind is a new step.
export function updateProcedureStepStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeProcedureStepId;
    readonly title: string;
    readonly instructions: string | null;
    readonly required: boolean;
    readonly referenceId: string | null;
    readonly position: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTAKE_PROCEDURE_STEP_TABLE} SET title = ?1, instructions = ?2, required = ?3, ` +
        `reference_id = ?4, position = ?5, updated_at = ?6 WHERE id = ?7`,
    )
    .bind(
      input.title,
      input.instructions,
      input.required ? 1 : 0,
      input.referenceId,
      input.position,
      input.now,
      input.id,
    );
}

// Retiring a step deactivates it. The row stays because a matter's record names it.
export function setProcedureStepActiveStatement(
  database: SqlDatabase,
  id: IntakeProcedureStepId,
  active: boolean,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${INTAKE_PROCEDURE_STEP_TABLE} SET active = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(active ? 1 : 0, now, id);
}

export async function readProcedureStep(
  database: SqlDatabase,
  id: IntakeProcedureStepId,
): Promise<IntakeProcedureStepRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${STEP_COLUMNS} FROM ${INTAKE_PROCEDURE_STEP_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<IntakeProcedureStepRow>();
  return results[0];
}

// The active steps of one procedure, in the order the firm listed them.
export async function readProcedureSteps(
  database: SqlDatabase,
  procedureId: IntakeProcedureId,
  options: { readonly includeInactive: boolean } = { includeInactive: false },
): Promise<IntakeProcedureStepRow[]> {
  const activeClause = options.includeInactive ? "" : "AND active = 1 ";
  const { results } = await database
    .prepare(
      `SELECT ${STEP_COLUMNS} FROM ${INTAKE_PROCEDURE_STEP_TABLE} WHERE procedure_id = ?1 ` +
        `${activeClause}ORDER BY position ASC, created_at ASC, id ASC`,
    )
    .bind(procedureId)
    .all<IntakeProcedureStepRow>();
  return results;
}

// The active steps of several procedures in ONE read, for the checklist: a matter bound by three
// procedures is one statement rather than three.
export async function readStepsOfProcedures(
  database: SqlDatabase,
  procedureIds: readonly IntakeProcedureId[],
): Promise<IntakeProcedureStepRow[]> {
  if (procedureIds.length === 0) return [];
  const placeholders = procedureIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${STEP_COLUMNS} FROM ${INTAKE_PROCEDURE_STEP_TABLE} ` +
        `WHERE active = 1 AND procedure_id IN (${placeholders}) ` +
        `ORDER BY procedure_id ASC, position ASC, created_at ASC, id ASC`,
    )
    .bind(...procedureIds)
    .all<IntakeProcedureStepRow>();
  return results;
}

export async function countProcedureSteps(
  database: SqlDatabase,
  procedureId: IntakeProcedureId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${INTAKE_PROCEDURE_STEP_TABLE} WHERE procedure_id = ?1 AND active = 1`,
    )
    .bind(procedureId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}
