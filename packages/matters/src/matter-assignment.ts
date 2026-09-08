import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import {
  DEFAULT_PAGE_SIZE,
  assembleCompositePage,
  compositeKeysetClause,
  decodeCompositeCursor,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
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

// A validity bound recorded at creation is a civil date. The end path is different on purpose: it
// stamps valid_to with the ending INSTANT, exclusive from that moment, so "remove them now" means
// now and not "at the end of today". The staffing read in
// packages/document-assembly/src/merge-statements.ts distinguishes the two forms by length.
// The shape itself is @magna-carta/civil-time's; imported at the head of this file.

export interface CreateMatterAssignmentInput {
  readonly matterId: MatterId;
  readonly memberUserId: UserId;
  readonly assignmentRole: string;
  // Optional validity window, each bound a CIVIL DATE (YYYY-MM-DD) — staffing is recorded in whole
  // days, the way a person says "Pat carried this file through August 7", and both bounds are
  // INCLUSIVE of their day. Open-ended when absent — the ordinary current assignment. The format is
  // enforced here because the staffing read compares these strings lexicographically: an arbitrary
  // string would not error, it would silently mis-window who a document names.
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

// The matter's staffing, every recorded window included — the reader decides what "current" means
// for its own question. The order is the display order (role, then when the window was recorded),
// so the keyset carries all three columns; see packages/data-access/src/cursor-pagination.ts for
// why a two-part cursor cannot express it.
//
// A matter's staffing is a HISTORY: every re-assignment over the life of the matter keeps its row,
// so it grows with how long the firm has run the matter rather than with the firm's headcount. It
// used to be read whole with no LIMIT at any layer, which made the response size a function of the
// matter's age. The document engine reads staffing through its own windowed statement in
// packages/document-assembly/src/merge-statements.ts and does not come through here.
export async function pageMatterAssignments(
  database: SqlDatabase,
  matterId: MatterId,
  options: { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<MatterAssignmentRow>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const cursor = decodeCompositeCursor(options.cursor);
  const bindings: unknown[] = [matterId];
  const keyset = compositeKeysetClause(
    bindings,
    cursor,
    { primary: "assignment_role", secondary: "created_at", id: "id" },
    true,
  );
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at
         FROM matter_assignment WHERE matter_id = ?1 ${keyset}
        ORDER BY assignment_role ASC, created_at ASC, id ASC
        LIMIT ${String(pageSize + 1)}`,
    )
    .bind(...bindings)
    .all<MatterAssignmentColumns>();
  return assembleCompositePage(
    results,
    pageSize,
    (columns) => ({
      primary: columns.assignment_role,
      secondary: columns.created_at,
      id: columns.id,
    }),
    toRow,
  );
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
  const validFrom = input.validFrom ?? null;
  const validTo = input.validTo ?? null;
  for (const bound of [validFrom, validTo]) {
    if (bound !== null && !CIVIL_DATE_PATTERN.test(bound)) {
      throw new MatterValidationError(
        "invalid-validity-window",
        "a validity bound must be a civil date (YYYY-MM-DD)",
      );
    }
  }
  // Civil dates in this format order lexicographically, so string comparison is date comparison.
  // A one-day assignment records the same date on both bounds; both are inclusive of their day.
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    throw new MatterValidationError(
      "invalid-validity-window",
      "the validity window must start on or before the day it ends",
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
        .bind(assignmentId, input.matterId, input.memberUserId, role, validFrom, validTo, now),
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

// The statements that END an assignment: valid_to is stamped with the ending INSTANT, the row
// stays. Staffing history is a matter record — who carried a file, and when, outlives the
// assignment — so there is no delete. The instant stamp is deliberate where a created window's
// bound is a civil date: ending an assignment means "off the file from this moment", not "through
// the end of today".
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
