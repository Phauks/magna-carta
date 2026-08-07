import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterCourtCaseId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { matterAuditStatement } from "./audit.ts";
import { MatterValidationError } from "./validation.ts";

// The matter's court-and-case identity: which court the case is before, the judge, the case number,
// and the two designation words a caption prints in its own jurisdiction's vocabulary. The court
// and the judge are Directory references — an organisation and a person — so a court's own address
// and a judge's name formats are recorded once in the Directory rather than restated per matter.
// One live record per matter (the partial unique index makes a second structurally impossible);
// the write is an upsert because a case's identity accretes — a number arrives at filing, a judge
// at assignment — and each arrival is an edit of the one record, not a second record.

export interface MatterCourtCaseFields {
  readonly courtEntityId: string | null;
  readonly judgeEntityId: string | null;
  readonly caseNumber: string | null;
  readonly division: string | null;
  readonly department: string | null;
  readonly filedOn: string | null;
  readonly clientDesignation: string | null;
  readonly opposingDesignation: string | null;
}

export interface MatterCourtCaseRecord extends MatterCourtCaseFields {
  readonly id: MatterCourtCaseId;
  readonly matterId: MatterId;
}

interface CourtCaseColumns {
  id: string;
  matter_id: string;
  court_entity_id: string | null;
  judge_entity_id: string | null;
  case_number: string | null;
  division: string | null;
  department: string | null;
  filed_on: string | null;
  client_designation: string | null;
  opposing_designation: string | null;
}

function toRecord(columns: CourtCaseColumns): MatterCourtCaseRecord {
  return {
    id: columns.id as MatterCourtCaseId,
    matterId: columns.matter_id as MatterId,
    courtEntityId: columns.court_entity_id,
    judgeEntityId: columns.judge_entity_id,
    caseNumber: columns.case_number,
    division: columns.division,
    department: columns.department,
    filedOn: columns.filed_on,
    clientDesignation: columns.client_designation,
    opposingDesignation: columns.opposing_designation,
  };
}

export async function readMatterCourtCase(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterCourtCaseRecord | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, court_entity_id, judge_entity_id, case_number, division, department, filed_on, client_designation, opposing_designation
         FROM matter_court_case WHERE matter_id = ?1 AND deleted_at IS NULL`,
    )
    .bind(matterId)
    .all<CourtCaseColumns>();
  const row = results[0];
  return row === undefined ? undefined : toRecord(row);
}

async function assertLiveEntity(
  database: SqlDatabase,
  table: "directory_person" | "directory_organization",
  entityId: string,
  what: string,
): Promise<void> {
  const { results } = await database
    .prepare(`SELECT 1 AS one FROM ${table} WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(entityId)
    .all<{ one: number }>();
  if (results.length === 0) {
    throw new MatterValidationError("unknown-entity", `${what} names no live Directory record`);
  }
}

// The statements one court-case upsert writes, for the caller's atomic batch. A dangling Directory
// reference is refused up front: a caption that silently resolved its court to nothing would look
// like a conditional absence forever, and nobody would know a typo caused it.
export async function composeSetMatterCourtCase(
  database: BatchDatabase,
  matterId: MatterId,
  fields: MatterCourtCaseFields,
  context: {
    clock: { now(): string };
    actorUserId: UserId | null;
    randomSource?: RandomSource;
  },
): Promise<{ statements: SqlStatement[]; courtCaseId: MatterCourtCaseId }> {
  const { results: matterRows } = await database
    .prepare("SELECT 1 AS one FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<{ one: number }>();
  if (matterRows.length === 0) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  if (fields.courtEntityId !== null) {
    await assertLiveEntity(database, "directory_organization", fields.courtEntityId, "the court");
  }
  if (fields.judgeEntityId !== null) {
    await assertLiveEntity(database, "directory_person", fields.judgeEntityId, "the judge");
  }

  const existing = await readMatterCourtCase(database, matterId);
  const now = context.clock.now();
  if (existing !== undefined) {
    return {
      courtCaseId: existing.id,
      statements: [
        database
          .prepare(
            `UPDATE matter_court_case
                SET court_entity_id = ?2, judge_entity_id = ?3, case_number = ?4, division = ?5,
                    department = ?6, filed_on = ?7, client_designation = ?8, opposing_designation = ?9,
                    updated_at = ?10
              WHERE id = ?1`,
          )
          .bind(
            existing.id,
            fields.courtEntityId,
            fields.judgeEntityId,
            fields.caseNumber,
            fields.division,
            fields.department,
            fields.filedOn,
            fields.clientDesignation,
            fields.opposingDesignation,
            now,
          ),
        matterAuditStatement(database, context, "matter.court_case.updated", existing.id, {
          matterId,
        }),
      ],
    };
  }
  const courtCaseId = newIdentifier("matterCourtCase", context.randomSource);
  return {
    courtCaseId,
    statements: [
      database
        .prepare(
          `INSERT INTO matter_court_case (id, matter_id, court_entity_id, judge_entity_id, case_number, division, department, filed_on, client_designation, opposing_designation, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
        )
        .bind(
          courtCaseId,
          matterId,
          fields.courtEntityId,
          fields.judgeEntityId,
          fields.caseNumber,
          fields.division,
          fields.department,
          fields.filedOn,
          fields.clientDesignation,
          fields.opposingDesignation,
          now,
        ),
      matterAuditStatement(database, context, "matter.court_case.created", courtCaseId, {
        matterId,
      }),
    ],
  };
}
