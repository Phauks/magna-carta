import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterId,
  MatterPlanTaskTemplateId,
  MatterPlanTemplateId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { PlanDueAnchor, TaskPriority } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_PLAN_TEMPLATE_TABLE = "matter_plan_template";
export const MATTER_PLAN_TASK_TEMPLATE_TABLE = "matter_plan_task_template";

// A plan carries no matter and therefore no visible-matter predicate. It is firm configuration —
// the same posture matter_type and firm_resource take — and reaching it is governed by
// tasks:managePlans at the route rather than by a predicate here. The one read that DOES touch a
// matter is the proposal, and it takes the predicate like every other matter-scoped read.

export interface MatterPlanTemplateRow {
  readonly id: MatterPlanTemplateId;
  readonly name: string;
  readonly description: string | null;
  readonly matter_type_id: MatterTypeId | null;
  readonly active: number;
  readonly created_by: UserId;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MatterPlanTaskTemplateRow {
  readonly id: MatterPlanTaskTemplateId;
  readonly template_id: MatterPlanTemplateId;
  readonly title: string;
  readonly body: string | null;
  readonly priority: TaskPriority;
  readonly default_assignee_role: string | null;
  readonly due_anchor: PlanDueAnchor;
  readonly offset_days: number | null;
  readonly blocked_by_template_task_id: MatterPlanTaskTemplateId | null;
  readonly position: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const TEMPLATE_COLUMNS =
  "id, name, description, matter_type_id, active, created_by, created_at, updated_at";
const TASK_TEMPLATE_COLUMNS =
  "id, template_id, title, body, priority, default_assignee_role, due_anchor, offset_days, " +
  "blocked_by_template_task_id, position, created_at, updated_at";

// ---- the plan itself ----

export function insertPlanTemplateStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterPlanTemplateId;
    readonly name: string;
    readonly description: string | null;
    readonly matterTypeId: MatterTypeId | null;
    readonly createdBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_PLAN_TEMPLATE_TABLE} (id, name, description, matter_type_id, active, ` +
        `created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)`,
    )
    .bind(input.id, input.name, input.description, input.matterTypeId, input.createdBy, input.now);
}

export function updatePlanTemplateStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterPlanTemplateId;
    readonly name: string;
    readonly description: string | null;
    readonly matterTypeId: MatterTypeId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_PLAN_TEMPLATE_TABLE} SET name = ?1, description = ?2, matter_type_id = ?3, ` +
        `updated_at = ?4 WHERE id = ?5`,
    )
    .bind(input.name, input.description, input.matterTypeId, input.now, input.id);
}

// Deactivating, and there is no delete path. A plan that stops being offered still has to exist:
// tasks accepted from it carry its handle as provenance, and a firm asking which matters came off
// the old intake plan needs the row to answer. The same discipline matter_type and firm_resource use.
export function setPlanTemplateActiveStatement(
  database: SqlDatabase,
  input: { readonly id: MatterPlanTemplateId; readonly active: boolean; readonly now: string },
): SqlStatement {
  return database
    .prepare(`UPDATE ${MATTER_PLAN_TEMPLATE_TABLE} SET active = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(input.active ? 1 : 0, input.now, input.id);
}

export async function readPlanTemplate(
  database: SqlDatabase,
  id: MatterPlanTemplateId,
): Promise<MatterPlanTemplateRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM ${MATTER_PLAN_TEMPLATE_TABLE} WHERE id = ?`)
    .bind(id)
    .all<MatterPlanTemplateRow>();
  return results[0];
}

// The firm's plans, newest last so a settings list reads in the order they were authored.
export function selectPlanTemplatesStatement(
  database: SqlDatabase,
  options: { readonly limit: number; readonly includeInactive?: boolean },
): SqlStatement {
  const condition = options.includeInactive === true ? "" : "WHERE active = 1 ";
  return database
    .prepare(
      `SELECT ${TEMPLATE_COLUMNS} FROM ${MATTER_PLAN_TEMPLATE_TABLE} ${condition}` +
        `ORDER BY name ASC, id ASC LIMIT ?`,
    )
    .bind(options.limit);
}

// WHICH PLANS ARE OFFERED when a matter of this type opens: those bound to the type, plus those bound
// to no type at all, which are offered on every matter. Inactive plans are never offered.
export async function readPlansOfferedFor(
  database: SqlDatabase,
  matterTypeId: MatterTypeId | null,
  limit: number,
): Promise<readonly MatterPlanTemplateRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${TEMPLATE_COLUMNS} FROM ${MATTER_PLAN_TEMPLATE_TABLE} ` +
        `WHERE active = 1 AND (matter_type_id IS NULL OR matter_type_id = ?1) ` +
        `ORDER BY name ASC, id ASC LIMIT ?2`,
    )
    .bind(matterTypeId, limit)
    .all<MatterPlanTemplateRow>();
  return results;
}

// ---- the tasks a plan proposes ----

export function insertPlanTaskTemplateStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterPlanTaskTemplateId;
    readonly templateId: MatterPlanTemplateId;
    readonly title: string;
    readonly body: string | null;
    readonly priority: TaskPriority;
    readonly defaultAssigneeRole: string | null;
    readonly dueAnchor: PlanDueAnchor;
    readonly offsetDays: number | null;
    readonly blockedByTemplateTaskId: MatterPlanTaskTemplateId | null;
    readonly position: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_PLAN_TASK_TEMPLATE_TABLE} (id, template_id, title, body, priority, ` +
        `default_assignee_role, due_anchor, offset_days, blocked_by_template_task_id, position, ` +
        `created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
    )
    .bind(
      input.id,
      input.templateId,
      input.title,
      input.body,
      input.priority,
      input.defaultAssigneeRole,
      input.dueAnchor,
      input.offsetDays,
      input.blockedByTemplateTaskId,
      input.position,
      input.now,
    );
}

export function updatePlanTaskTemplateStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterPlanTaskTemplateId;
    readonly title: string;
    readonly body: string | null;
    readonly priority: TaskPriority;
    readonly defaultAssigneeRole: string | null;
    readonly dueAnchor: PlanDueAnchor;
    readonly offsetDays: number | null;
    readonly blockedByTemplateTaskId: MatterPlanTaskTemplateId | null;
    readonly position: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_PLAN_TASK_TEMPLATE_TABLE} SET title = ?1, body = ?2, priority = ?3, ` +
        `default_assignee_role = ?4, due_anchor = ?5, offset_days = ?6, ` +
        `blocked_by_template_task_id = ?7, position = ?8, updated_at = ?9 WHERE id = ?10`,
    )
    .bind(
      input.title,
      input.body,
      input.priority,
      input.defaultAssigneeRole,
      input.dueAnchor,
      input.offsetDays,
      input.blockedByTemplateTaskId,
      input.position,
      input.now,
      input.id,
    );
}

// Removing a step from a plan. A REAL delete, unlike deactivating the plan itself: a task template is
// a line in a document the firm is still writing, and tasks already accepted from it carry their own
// copy of what it said. Anything in the same plan that waited on it stops waiting, in the same batch,
// because nothing in SQLite enforces the self-reference.
export function deletePlanTaskTemplateStatement(
  database: SqlDatabase,
  id: MatterPlanTaskTemplateId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_PLAN_TASK_TEMPLATE_TABLE} WHERE id = ?1`).bind(id);
}

export function clearTemplateBlockedByStatement(
  database: SqlDatabase,
  input: { readonly taskTemplateId: MatterPlanTaskTemplateId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_PLAN_TASK_TEMPLATE_TABLE} SET blocked_by_template_task_id = NULL, ` +
        `updated_at = ?1 WHERE blocked_by_template_task_id = ?2`,
    )
    .bind(input.now, input.taskTemplateId);
}

export async function readPlanTaskTemplate(
  database: SqlDatabase,
  id: MatterPlanTaskTemplateId,
): Promise<MatterPlanTaskTemplateRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${TASK_TEMPLATE_COLUMNS} FROM ${MATTER_PLAN_TASK_TEMPLATE_TABLE} WHERE id = ?`)
    .bind(id)
    .all<MatterPlanTaskTemplateRow>();
  return results[0];
}

export async function readPlanTaskTemplates(
  database: SqlDatabase,
  templateId: MatterPlanTemplateId,
): Promise<readonly MatterPlanTaskTemplateRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${TASK_TEMPLATE_COLUMNS} FROM ${MATTER_PLAN_TASK_TEMPLATE_TABLE} ` +
        `WHERE template_id = ?1 ORDER BY position ASC, id ASC`,
    )
    .bind(templateId)
    .all<MatterPlanTaskTemplateRow>();
  return results;
}

export async function countPlanTaskTemplates(
  database: SqlDatabase,
  templateId: MatterPlanTemplateId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${MATTER_PLAN_TASK_TEMPLATE_TABLE} WHERE template_id = ?`,
    )
    .bind(templateId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

// ---- what a proposal reads from the matter ----

export interface MatterAnchorRow {
  readonly id: MatterId;
  readonly matter_type_id: MatterTypeId | null;
  // The civil day the matter opened, CUT FROM whatever shape the column holds. `opened_at` is written
  // as a civil date by some paths and as an instant by others, and the anchor only ever wants the
  // day — so the first ten characters are taken rather than the value parsed, which is the same cut
  // the note ordering and the matter-team validity window already make.
  readonly opened_on: string | null;
  // The zone the matter's office reads dates in, for the tasks a proposal dates. Null where the
  // office records none; the caller falls back rather than inventing one here.
  readonly time_zone: string | null;
}

export async function readMatterAnchor(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterAnchorRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT matter.id, matter.matter_type_id, substr(matter.opened_at, 1, 10) AS opened_on, ` +
        `location.time_zone AS time_zone FROM matter ` +
        `LEFT JOIN location ON location.id = matter.location_id WHERE matter.id = ?1`,
    )
    .bind(matterId)
    .all<MatterAnchorRow>();
  return results[0];
}

// WHO A ROLE RESOLVES TO on this matter, right now.
//
// The validity window is read exactly as packages/document-assembly/src/merge-statements.ts reads it
// and as the notifications matter-team audience does: a creation bound is a civil date inclusive of
// its day, an end bound is the ending instant and exclusive. Three readings of one window would
// eventually disagree, and the one somebody acted on would be whichever they saw last.
//
// Returns at most one member. A role held by two people resolves to the first by handle, which is
// stable rather than arbitrary-looking, and the proposal shows who it picked so a person can change
// it before accepting.
export async function resolveAssignmentRole(
  database: SqlDatabase,
  matterId: MatterId,
  role: string,
  now: string,
): Promise<UserId | null> {
  const { results } = await database
    .prepare(
      `SELECT assignment.member_user_id AS user_id FROM matter_assignment AS assignment ` +
        `JOIN member ON member.user_id = assignment.member_user_id AND member.status = 'active' ` +
        `WHERE assignment.matter_id = ?1 AND assignment.assignment_role = ?2 ` +
        `AND (assignment.valid_from IS NULL OR assignment.valid_from <= ?3) ` +
        `AND (assignment.valid_to IS NULL ` +
        `OR (length(assignment.valid_to) = 10 AND assignment.valid_to >= substr(?3, 1, 10)) ` +
        `OR (length(assignment.valid_to) > 10 AND assignment.valid_to > ?3)) ` +
        `ORDER BY assignment.member_user_id ASC LIMIT 1`,
    )
    .bind(matterId, role, now)
    .all<{ user_id: UserId }>();
  return results[0]?.user_id ?? null;
}

// The template's blocking chain, walked from a proposed predecessor. Returns true when following it
// reaches `taskTemplateId`, which is the cycle. Bounded by depth and by a seen-set so an already
// corrupted chain cannot spin a request handler.
export async function templateChainReaches(
  database: SqlDatabase,
  from: MatterPlanTaskTemplateId,
  taskTemplateId: MatterPlanTaskTemplateId,
  maxDepth: number,
): Promise<boolean> {
  const seen = new Set<string>();
  let current: MatterPlanTaskTemplateId | null = from;
  for (let depth = 0; depth < maxDepth && current !== null; depth++) {
    if (current === taskTemplateId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    const {
      results,
    }: { results: { blocked_by_template_task_id: MatterPlanTaskTemplateId | null }[] } =
      await database
        .prepare(
          `SELECT blocked_by_template_task_id FROM ${MATTER_PLAN_TASK_TEMPLATE_TABLE} WHERE id = ?`,
        )
        .bind(current)
        .all<{ blocked_by_template_task_id: MatterPlanTaskTemplateId | null }>();
    current = results[0]?.blocked_by_template_task_id ?? null;
  }
  return false;
}
