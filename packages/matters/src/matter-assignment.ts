import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterAssignmentId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { matterAuditStatement } from "./audit.ts";
import { MatterValidationError } from "./validation.ts";

// The matter's staffing beyond the single responsible attorney — who originated it, who supervises,
// who bills it, which paralegal carries it. `matter_assignment` is the matter shell's own table:
// caseload views, billing attribution, conflicts imputation, and the document engine all read the
// same rows, and this module is the one write path onto them.
//
// THE RESPONSIBLE ATTORNEY IS NOT AN ASSIGNMENT. `matter.responsible_member_id` stays that fact's
// one home, so the write path refuses an assignment role that normalizes to it — otherwise the same
// question would have two answers on exactly the matters where it matters.
//
// `assignment_role` is free text matched the way `matter_party.role` is: lowercased with every
// non-alphanumeric character removed, so `supervising_attorney`, `Supervising Attorney`, and
// `supervising-attorney` all name one role. The normalization here is byte-for-byte the merge
// subject matching rule in packages/document-assembly/src/catalog/subjects.ts — a role recorded
// through this path resolves as a document's staffing subject with no mapping table between them.

export function normalizedAssignmentRoleToken(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const RESPONSIBLE_ATTORNEY_TOKEN = normalizedAssignmentRoleToken("responsibleAttorney");

export interface CreateMatterAssignmentInput {
  readonly matterId: MatterId;
  readonly memberUserId: UserId;
  readonly assignmentRole: string;
  // Optional validity window. Open-ended when absent — the ordinary current assignment.
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
}

export interface MatterAssignmentRow {
  readonly id: MatterAssignmentId;
  readonly matterId: MatterId;
  readonly memberUserId: UserId;
  readonly assignmentRole: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly createdAt: string;
}

interface MatterAssignmentColumns {
  id: string;
  matter_id: string;
  member_user_id: string;
  assignment_role: string;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
}

function toRow(columns: MatterAssignmentColumns): MatterAssignmentRow {
  return {
    id: columns.id as MatterAssignmentId,
    matterId: columns.matter_id as MatterId,
    memberUserId: columns.member_user_id as UserId,
    assignmentRole: columns.assignment_role,
    validFrom: columns.valid_from,
    validTo: columns.valid_to,
    createdAt: columns.created_at,
  };
}

// The staffing on a matter, every recorded window included — the reader decides what "current"
// means for its own question (the merge engine windows by the assembly instant; a staffing screen
// shows history).
export async function listMatterAssignments(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterAssignmentRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at
         FROM matter_assignment WHERE matter_id = ?1
        ORDER BY assignment_role ASC, created_at ASC, id ASC`,
    )
    .bind(matterId)
    .all<MatterAssignmentColumns>();
  return results.map(toRow);
}

async function assertExists(
  database: SqlDatabase,
  sql: string,
  id: string,
  failure: string,
): Promise<void> {
  const { results } = await database.prepare(sql).bind(id).all<{ one: number }>();
  if (results.length === 0) {
    throw new MatterValidationError("matter-not-found", failure);
  }
}

// The statements one staffing addition writes, for the caller's atomic batch: the assignment row
// plus its audit row. Validation runs before composition — D1 has no interactive transactions, so
// everything the write needs is read first.
export async function composeCreateMatterAssignment(
  database: BatchDatabase,
  input: CreateMatterAssignmentInput,
  context: {
    clock: { now(): string };
    actorUserId: UserId | null;
    randomSource?: RandomSource;
  },
): Promise<{ statements: SqlStatement[]; assignmentId: MatterAssignmentId }> {
  const role = input.assignmentRole.trim();
  if (role.length === 0 || normalizedAssignmentRoleToken(role).length === 0) {
    throw new MatterValidationError(
      "invalid-assignment-role",
      "an assignment role needs at least one letter or digit",
    );
  }
  if (normalizedAssignmentRoleToken(role) === RESPONSIBLE_ATTORNEY_TOKEN) {
    throw new MatterValidationError(
      "invalid-assignment-role",
      "the responsible attorney is recorded on the matter itself, not as an assignment — " +
        "edit the matter's responsible attorney instead",
    );
  }
  await assertExists(
    database,
    "SELECT 1 AS one FROM matter WHERE id = ?1",
    input.matterId,
    `no such matter: ${input.matterId}`,
  );
  await assertExists(
    database,
    "SELECT 1 AS one FROM member WHERE user_id = ?1",
    input.memberUserId,
    `no such member: ${input.memberUserId}`,
  );

  const assignmentId = newIdentifier("matterAssignment", context.randomSource);
  const now = context.clock.now();
  return {
    assignmentId,
    statements: [
      database
        .prepare(
          `INSERT INTO matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
        )
        .bind(
          assignmentId,
          input.matterId,
          input.memberUserId,
          role,
          input.validFrom ?? null,
          input.validTo ?? null,
          now,
        ),
      matterAuditStatement(
        database,
        {
          clock: context.clock,
          actorUserId: context.actorUserId,
          ...(context.randomSource === undefined ? {} : { randomSource: context.randomSource }),
        },
        "matter.assignment.created",
        assignmentId,
        {
          matterId: input.matterId,
          memberUserId: input.memberUserId,
        },
      ),
    ],
  };
}

// The statements that END an assignment: valid_to is stamped, the row stays. Staffing history is a
// matter record — who carried a file, and when, outlives the assignment — so there is no delete.
export async function composeEndMatterAssignment(
  database: BatchDatabase,
  matterId: MatterId,
  assignmentId: MatterAssignmentId,
  context: {
    clock: { now(): string };
    actorUserId: UserId | null;
    randomSource?: RandomSource;
  },
): Promise<{ statements: SqlStatement[] }> {
  const { results } = await database
    .prepare(`SELECT 1 AS one FROM matter_assignment WHERE id = ?1 AND matter_id = ?2`)
    .bind(assignmentId, matterId)
    .all<{ one: number }>();
  if (results.length === 0) {
    throw new MatterValidationError(
      "matter-not-found",
      `no such assignment on this matter: ${assignmentId}`,
    );
  }
  return {
    statements: [
      database
        .prepare(`UPDATE matter_assignment SET valid_to = ?2, updated_at = ?2 WHERE id = ?1`)
        .bind(assignmentId, context.clock.now()),
      matterAuditStatement(
        database,
        {
          clock: context.clock,
          actorUserId: context.actorUserId,
          ...(context.randomSource === undefined ? {} : { randomSource: context.randomSource }),
        },
        "matter.assignment.ended",
        assignmentId,
        { matterId },
      ),
    ],
  };
}
