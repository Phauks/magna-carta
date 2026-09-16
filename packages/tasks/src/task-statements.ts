import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  FileId,
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  MatterPlanTaskTemplateId,
  MatterPlanTemplateId,
  MatterTaskChecklistItemId,
  MatterTaskDocumentId,
  MatterTaskId,
  MatterTaskParticipantId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  TASK_PARTICIPANT_ROLE_RANK,
  TASK_PRIORITY_RANK,
  columnsForRung,
  type TaskDue,
  type TaskParticipantRole,
  type TaskPriority,
  type TaskProgress,
  type TaskRung,
  type TaskState,
} from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_TASK_TABLE = "matter_task";
export const MATTER_TASK_DOCUMENT_TABLE = "matter_task_document";
export const MATTER_TASK_PARTICIPANT_TABLE = "matter_task_participant";
export const MATTER_TASK_CHECKLIST_ITEM_TABLE = "matter_task_checklist_item";

// "This member is on this task", as a fragment over the participant table. Composed by the
// visibility branch below and by the list filter, so the two cannot disagree about what being on a
// task means. Correlated on the outer matter_task row; the placeholder is the member.
const ON_TASK_FRAGMENT =
  `EXISTS (SELECT 1 FROM ${MATTER_TASK_PARTICIPANT_TABLE} ` +
  `WHERE ${MATTER_TASK_PARTICIPANT_TABLE}.task_id = ${MATTER_TASK_TABLE}.id ` +
  `AND ${MATTER_TASK_PARTICIPANT_TABLE}.user_id = ?)`;

// ---- THE visibility branch, and the only place it exists ----

// A task's matter is nullable, so "may this member see this task" has two answers, and this function
// is the entire population of that fact. Every read in this module composes it; nothing else in the
// package writes the branch out again, and nothing outside the package writes it at all.
//
// The confinement is the point rather than a tidiness preference. `firm_event` exists as its own
// table specifically to avoid a null matter putting a does-not-apply branch inside the visibility
// seam, and that concern is real — a branch copied into nine reads is a branch that will be wrong in
// one of them. Tasks answer it by making the branch a single composable fragment instead of a second
// table, because unlike a calendar entry a task has ONE surface: "what is on my plate" spans a
// member's client work and their firm work, and two tables would mean unioning them back together on
// the read every member makes most often.
//
// The two rules:
//   - A task ON A MATTER is firm-visible within that matter, screened by the same visible-matter
//     predicate every calendar source composes. Not narrowed to the assignee: a colleague covering a
//     file needs to see what is outstanding on it, and an assignee is not an access grant.
//   - A task with NO MATTER is private to the people on it and whoever created it. There is no
//     matter to screen it by, and a firm-wide default would put "review the associate's
//     performance" in front of the associate. "The people on it" is every role, watcher included:
//     being added to the firm's own work in any role is what lets a member see it.
export const MATTERLESS_TASK_MARKER = `${MATTER_TASK_TABLE}.matter_id IS NULL`;

export interface TaskVisibility {
  readonly condition: string;
  readonly bindings: readonly unknown[];
}

export function taskVisibilityFragment(
  visibility: VisibleMatterPredicate,
  viewerUserId: UserId,
): TaskVisibility {
  return {
    condition:
      `((${MATTERLESS_TASK_MARKER} AND (${MATTER_TASK_TABLE}.created_by = ? ` +
      `OR ${ON_TASK_FRAGMENT})) OR (${MATTER_TASK_TABLE}.matter_id IS NOT NULL AND ` +
      `${visibility.fragmentFor(`${MATTER_TASK_TABLE}.matter_id`)}))`,
    bindings: [viewerUserId, viewerUserId, ...visibility.bindings],
  };
}

// ---- rows ----

export interface MatterTaskRow {
  readonly id: MatterTaskId;
  readonly matter_id: MatterId | null;
  readonly title: string;
  readonly body: string | null;
  // The people are in matter_task_participant and are read beside the page (readTaskParticipants),
  // never off this row. The retired one-name column is not projected: nothing reads it.
  readonly created_by: UserId;
  readonly priority: TaskPriority;
  readonly due_on: string | null;
  readonly due_at_time: string | null;
  readonly time_zone: string | null;
  readonly state: TaskState;
  readonly completed_at: string | null;
  readonly completed_by: UserId | null;
  // Retired with `cancelled`, kept because a column cannot be dropped from a parent table here.
  // Always null, never read, never written. See packages/database/src/per-firm-schema.ts.
  readonly cancelled_at: string | null;
  readonly cancelled_by: UserId | null;
  readonly cancellation_reason: string | null;
  // Where an OPEN task stands. The fourth rung a reader sees is `state` above — rungOf() in
  // ./types.ts is the one place the two are put back together.
  readonly progress: TaskProgress;
  // Put away, kept. Orthogonal to the rungs: a task is archived from wherever it stood.
  readonly archived_at: string | null;
  readonly archived_by: UserId | null;
  readonly archive_reason: string | null;
  readonly blocked_by_task_id: MatterTaskId | null;
  readonly trigger_event_id: MatterEventId | null;
  readonly deadline_id: MatterDeadlineId | null;
  // Where this task came from, where a plan proposed it. PROVENANCE: no read resolves these, so a
  // template edit cannot reach a matter that already accepted one.
  readonly plan_template_id: MatterPlanTemplateId | null;
  readonly plan_task_template_id: MatterPlanTaskTemplateId | null;
  readonly created_at: string;
  readonly updated_at: string;
  // Who touched it last, and null on a row nothing has edited since it was written. A mirror reads
  // this to tell its own writes from a person's; without it a two-way sync pushes back what it just
  // pulled and the two sides oscillate.
  readonly updated_by: UserId | null;
}

export interface MatterTaskDocumentRow {
  readonly id: MatterTaskDocumentId;
  readonly task_id: MatterTaskId;
  readonly file_id: FileId;
  readonly linked_at: string;
  readonly linked_by: UserId | null;
  // Resolved by the read from the matter's own file record, so a surface names a document the way
  // the File Manager names it rather than keeping a second copy of the name that could drift.
  readonly file_name: string;
  readonly content_type: string | null;
}

export interface MatterTaskParticipantRow {
  readonly id: MatterTaskParticipantId;
  readonly task_id: MatterTaskId;
  readonly user_id: UserId;
  readonly role: TaskParticipantRole;
  readonly added_by: UserId | null;
  readonly added_at: string;
}

export interface MatterTaskChecklistItemRow {
  readonly id: MatterTaskChecklistItemId;
  readonly task_id: MatterTaskId;
  readonly title: string;
  readonly position: number;
  readonly done_at: string | null;
  readonly done_by: UserId | null;
  readonly created_by: UserId;
  readonly created_at: string;
  readonly updated_at: string;
}

// Exported so the change feed projects exactly what every other task read projects — a sync that
// saw a different shape from the screen would be a second definition of what a task is.
export const TASK_COLUMNS = [
  "id",
  "matter_id",
  "title",
  "body",
  "created_by",
  "priority",
  "due_on",
  "due_at_time",
  "time_zone",
  "state",
  "completed_at",
  "completed_by",
  "cancelled_at",
  "cancelled_by",
  "cancellation_reason",
  "progress",
  "archived_at",
  "archived_by",
  "archive_reason",
  "blocked_by_task_id",
  "trigger_event_id",
  "deadline_id",
  "plan_template_id",
  "plan_task_template_id",
  "created_at",
  "updated_at",
  "updated_by",
]
  .map((column) => `${MATTER_TASK_TABLE}.${column}`)
  .join(", ");

// Priority ranked for the ORDER BY, from the one home the ranks live in. Built from
// TASK_PRIORITY_RANK rather than written out, so a fifth priority could never sort differently here
// than it does anywhere else in the product.
const PRIORITY_RANK_EXPRESSION = `CASE ${MATTER_TASK_TABLE}.priority ${Object.entries(
  TASK_PRIORITY_RANK,
)
  .map(([priority, rank]) => `WHEN '${priority}' THEN ${String(rank)}`)
  .join(" ")} ELSE ${String(Object.keys(TASK_PRIORITY_RANK).length)} END`;

// THE ordering, and it is the same on every task list so a task does not move between surfaces.
//
// Undated tasks sort AFTER dated ones rather than before. SQLite orders NULL first on an ascending
// sort, which would put every task nobody has scheduled at the top of a list whose whole job is to
// say what is due next — so the null-ness is lifted into its own leading term. Within a date,
// urgency decides, and the handle is the final tiebreak so a page boundary is stable.
const TASK_ORDER = `${MATTER_TASK_TABLE}.due_on IS NULL ASC, ${MATTER_TASK_TABLE}.due_on ASC, ${PRIORITY_RANK_EXPRESSION} ASC, ${MATTER_TASK_TABLE}.id ASC`;

// ---- writes ----

export interface InsertMatterTaskInput {
  readonly id: MatterTaskId;
  readonly matterId: MatterId | null;
  readonly title: string;
  readonly body: string | null;
  readonly createdBy: UserId;
  readonly priority: TaskPriority;
  readonly due: TaskDue;
  readonly blockedByTaskId: MatterTaskId | null;
  readonly triggerEventId: MatterEventId | null;
  readonly deadlineId: MatterDeadlineId | null;
  // Filled only by a plan acceptance. Every other write path leaves both null, which is what makes
  // "came off a plan" answerable by the column's presence rather than by a join.
  readonly planTemplateId?: MatterPlanTemplateId | null;
  readonly planTaskTemplateId?: MatterPlanTaskTemplateId | null;
  readonly now: string;
}

export function insertMatterTaskStatement(
  database: SqlDatabase,
  input: InsertMatterTaskInput,
): SqlStatement {
  return database
    .prepare(
      // The retired one-name column is not in the list: it stays NULL on every row ever written
      // from here on, and the people go into matter_task_participant in the same batch.
      `INSERT INTO ${MATTER_TASK_TABLE} (id, matter_id, title, body, created_by, ` +
        `priority, due_on, due_at_time, time_zone, state, completed_at, completed_by, cancelled_at, ` +
        `cancelled_by, cancellation_reason, progress, archived_at, archived_by, archive_reason, ` +
        `blocked_by_task_id, trigger_event_id, deadline_id, ` +
        `plan_template_id, plan_task_template_id, created_at, updated_at, updated_by) ` +
        // updated_by is the CREATOR on a fresh row: "who touched it last" at creation is whoever
        // wrote it, and a feed where some rows have an actor and some do not would make echo
        // suppression a special case at exactly the moment a sync first sees a task.
        // A fresh task is on the first rung, unarchived, and open. None of the three is a caller's
        // to set at creation: a task nobody has started is To Do, and one archived at birth is one
        // nobody should have written.
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', NULL, NULL, NULL, NULL, NULL, ` +
        `'to_do', NULL, NULL, NULL, ` +
        `?10, ?11, ?12, ?13, ?14, ?15, ?15, ?5)`,
    )
    .bind(
      input.id,
      input.matterId,
      input.title,
      input.body,
      input.createdBy,
      input.priority,
      input.due.dueOn,
      input.due.dueAtTime,
      input.due.timeZone,
      input.blockedByTaskId,
      input.triggerEventId,
      input.deadlineId,
      input.planTemplateId ?? null,
      input.planTaskTemplateId ?? null,
      input.now,
    );
}

// Editing a task in place, which is a deliberate departure from how a note used to work and the same
// call the calendar made for firm events: a task's value is that it says what to do NOW, so a
// correction overwrites rather than appending. The audit row in the same batch carries that it
// changed; assignment and due-date moves additionally raise their own topics, because those two are
// the changes other people need to hear about.
//
// The state columns are deliberately absent from this statement. A state move is its own path with
// its own preconditions, and an edit that could also mark something done would be a way to complete
// a task without the completion actor and instant the CHECK requires.
export function updateMatterTaskStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskId;
    readonly title: string;
    readonly body: string | null;
    readonly priority: TaskPriority;
    readonly due: TaskDue;
    readonly blockedByTaskId: MatterTaskId | null;
    readonly triggerEventId: MatterEventId | null;
    readonly deadlineId: MatterDeadlineId | null;
    readonly now: string;
    readonly actor: UserId | null;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET title = ?1, body = ?2, priority = ?3, due_on = ?4, ` +
        `due_at_time = ?5, time_zone = ?6, blocked_by_task_id = ?7, trigger_event_id = ?8, ` +
        `deadline_id = ?9, updated_at = ?10, updated_by = ?11 WHERE id = ?12`,
    )
    .bind(
      input.title,
      input.body,
      input.priority,
      input.due.dueOn,
      input.due.dueAtTime,
      input.due.timeZone,
      input.blockedByTaskId,
      input.triggerEventId,
      input.deadlineId,
      input.now,
      input.actor,
      input.id,
    );
}

// The task CHANGED, though none of its own columns did: somebody joined or left it, or a checklist
// line moved. Stamped so the change feed reports it — a mirror that missed a new watcher or a
// ticked line would go on showing the task as it was — and so "who touched it last" stays true.
export function touchMatterTaskStatement(
  database: SqlDatabase,
  input: { readonly id: MatterTaskId; readonly now: string; readonly actor: UserId },
): SqlStatement {
  return database
    .prepare(`UPDATE ${MATTER_TASK_TABLE} SET updated_at = ?1, updated_by = ?2 WHERE id = ?3`)
    .bind(input.now, input.actor, input.id);
}

// ---- the people on a task ----

export function insertMatterTaskParticipantStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskParticipantId;
    readonly taskId: MatterTaskId;
    readonly userId: UserId;
    readonly role: TaskParticipantRole;
    readonly addedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_PARTICIPANT_TABLE} (id, task_id, user_id, role, added_by, added_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(input.id, input.taskId, input.userId, input.role, input.addedBy, input.now);
}

// A person's role changes IN PLACE rather than by delete-and-insert, so the row keeps who first put
// them on the task and when. Who changed the role is on the audit row in the same batch.
export function updateMatterTaskParticipantRoleStatement(
  database: SqlDatabase,
  input: { readonly id: MatterTaskParticipantId; readonly role: TaskParticipantRole },
): SqlStatement {
  return database
    .prepare(`UPDATE ${MATTER_TASK_PARTICIPANT_TABLE} SET role = ?1 WHERE id = ?2`)
    .bind(input.role, input.id);
}

export function deleteMatterTaskParticipantStatement(
  database: SqlDatabase,
  id: MatterTaskParticipantId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_TASK_PARTICIPANT_TABLE} WHERE id = ?1`).bind(id);
}

export function deleteMatterTaskParticipantsStatement(
  database: SqlDatabase,
  taskId: MatterTaskId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MATTER_TASK_PARTICIPANT_TABLE} WHERE task_id = ?1`)
    .bind(taskId);
}

// The role ranked for the ORDER BY, from the one home the ranks live in, so a task's people read in
// the same order on every surface: who answers for it, who does it, who reviews it, who watches.
const ROLE_RANK_EXPRESSION = `CASE ${MATTER_TASK_PARTICIPANT_TABLE}.role ${Object.entries(
  TASK_PARTICIPANT_ROLE_RANK,
)
  .map(([role, rank]) => `WHEN '${role}' THEN ${String(rank)}`)
  .join(" ")} ELSE ${String(Object.keys(TASK_PARTICIPANT_ROLE_RANK).length)} END`;

// The people on a set of tasks, in ONE read keyed by the page, never one per row. No visibility
// predicate of its own: the task ids arrive from a read that already composed it, and a
// participant row says nothing about a task the reader could not already see.
export async function readMatterTaskParticipants(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
): Promise<readonly MatterTaskParticipantRow[]> {
  if (taskIds.length === 0) return [];
  const placeholders = taskIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT id, task_id, user_id, role, added_by, added_at FROM ${MATTER_TASK_PARTICIPANT_TABLE} ` +
        `WHERE task_id IN (${placeholders}) ` +
        `ORDER BY ${ROLE_RANK_EXPRESSION} ASC, added_at ASC, id ASC`,
    )
    .bind(...taskIds)
    .all<MatterTaskParticipantRow>();
  return results;
}

// ---- the checklist inside a task ----

export function insertMatterTaskChecklistItemStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskChecklistItemId;
    readonly taskId: MatterTaskId;
    readonly title: string;
    readonly position: number;
    readonly createdBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_CHECKLIST_ITEM_TABLE} ` +
        `(id, task_id, title, position, done_at, done_by, created_by, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, ?6)`,
    )
    .bind(input.id, input.taskId, input.title, input.position, input.createdBy, input.now);
}

export function updateMatterTaskChecklistItemStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskChecklistItemId;
    readonly title: string;
    readonly position: number;
    readonly doneAt: string | null;
    readonly doneBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_CHECKLIST_ITEM_TABLE} SET title = ?1, position = ?2, done_at = ?3, ` +
        `done_by = ?4, updated_at = ?5 WHERE id = ?6`,
    )
    .bind(input.title, input.position, input.doneAt, input.doneBy, input.now, input.id);
}

export function deleteMatterTaskChecklistItemStatement(
  database: SqlDatabase,
  id: MatterTaskChecklistItemId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_TASK_CHECKLIST_ITEM_TABLE} WHERE id = ?1`).bind(id);
}

export function deleteMatterTaskChecklistItemsStatement(
  database: SqlDatabase,
  taskId: MatterTaskId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MATTER_TASK_CHECKLIST_ITEM_TABLE} WHERE task_id = ?1`)
    .bind(taskId);
}

// The checklist lines on a set of tasks, in one read keyed by the page, in the order they were
// written. No predicate of its own, on the participants read's reasoning.
export async function readMatterTaskChecklists(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
): Promise<readonly MatterTaskChecklistItemRow[]> {
  if (taskIds.length === 0) return [];
  const placeholders = taskIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT id, task_id, title, position, done_at, done_by, created_by, created_at, updated_at ` +
        `FROM ${MATTER_TASK_CHECKLIST_ITEM_TABLE} WHERE task_id IN (${placeholders}) ` +
        `ORDER BY task_id ASC, position ASC, id ASC`,
    )
    .bind(...taskIds)
    .all<MatterTaskChecklistItemRow>();
  return results;
}

// One line, addressed by its own id, for the write paths' precondition read. Composes the task's
// visibility so an id-addressed write cannot reach a line on a task a list read could not.
export async function readMatterTaskChecklistItem(
  database: SqlDatabase,
  id: MatterTaskChecklistItemId,
  visibility: VisibleMatterPredicate,
  viewerUserId: UserId,
): Promise<MatterTaskChecklistItemRow | undefined> {
  const reach = taskVisibilityFragment(visibility, viewerUserId);
  const item = MATTER_TASK_CHECKLIST_ITEM_TABLE;
  const { results } = await database
    .prepare(
      `SELECT ${item}.id, ${item}.task_id, ${item}.title, ${item}.position, ${item}.done_at, ` +
        `${item}.done_by, ${item}.created_by, ${item}.created_at, ${item}.updated_at ` +
        `FROM ${item} JOIN ${MATTER_TASK_TABLE} ON ${MATTER_TASK_TABLE}.id = ${item}.task_id ` +
        `WHERE ${item}.id = ? AND ${reach.condition}`,
    )
    .bind(id, ...reach.bindings)
    .all<MatterTaskChecklistItemRow>();
  return results[0];
}

export async function countMatterTaskChecklistItems(
  database: SqlDatabase,
  taskId: MatterTaskId,
): Promise<{ count: number; nextPosition: number }> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(MAX(position), -1) + 1 AS next_position ` +
        `FROM ${MATTER_TASK_CHECKLIST_ITEM_TABLE} WHERE task_id = ?`,
    )
    .bind(taskId)
    .all<{ count: number; next_position: number }>();
  return { count: results[0]?.count ?? 0, nextPosition: results[0]?.next_position ?? 0 };
}

// ---- the matter a task is on, as a reader names it ----

export interface MatterLabelRow {
  readonly id: MatterId;
  readonly title: string;
  readonly matter_number: string | null;
}

// The titles and numbers of the matters a page of tasks sits on, in one read keyed by the page. A
// list that spans matters sorts and filters by the matter's NAME, and a row printing `matter_01J…`
// at a person is not an answer. No predicate: every id here came off a task read that composed it.
export async function readMatterLabels(
  database: SqlDatabase,
  matterIds: readonly MatterId[],
): Promise<readonly MatterLabelRow[]> {
  if (matterIds.length === 0) return [];
  const placeholders = matterIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(`SELECT id, title, matter_number FROM matter WHERE id IN (${placeholders})`)
    .bind(...matterIds)
    .all<MatterLabelRow>();
  return results;
}

/*
 * MOVING A TASK TO A RUNG — one statement for all four, because a reader pressing To Do and a reader
 * pressing Done are doing the same thing and a surface that reached for four endpoints would be
 * deciding that they are not.
 *
 * `progress` is written only where the rung names one, so moving OFF Done restores the rung the task
 * was left on rather than sending it back to the start. That is what somebody who ticked the wrong
 * row means by putting it back, and it is why completing a task does not clear the rung.
 *
 * The completion pair moves with the state because the database requires it: a `done` row carries an
 * actor and an instant, an `open` row carries neither. The audit row records that a completion was
 * undone, so a task that was closed and reopened stays a fact about how the matter ran even though
 * the row no longer shows it.
 */
export function moveMatterTaskToRungStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskId;
    readonly rung: TaskRung;
    readonly actor: UserId;
    readonly now: string;
  },
): SqlStatement {
  const columns = columnsForRung(input.rung);
  if (columns.state === "done") {
    return database
      .prepare(
        `UPDATE ${MATTER_TASK_TABLE} SET state = 'done', completed_at = ?1, completed_by = ?2, ` +
          `updated_at = ?1, updated_by = ?2 WHERE id = ?3`,
      )
      .bind(input.now, input.actor, input.id);
  }
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET state = 'open', progress = ?1, completed_at = NULL, ` +
        `completed_by = NULL, updated_at = ?2, updated_by = ?3 WHERE id = ?4`,
    )
    .bind(columns.progress, input.now, input.actor, input.id);
}

/*
 * PUT AWAY, KEPT. The rung is untouched on purpose: a task is archived FROM wherever it stood, and
 * unarchiving puts it back there rather than at the start. Archiving a done task keeps it done.
 *
 * The reason is optional and may be null, which is the difference from the cancellation this
 * replaces — requiring a sentence is why that state went unused.
 */
export function archiveMatterTaskStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskId;
    readonly archivedBy: UserId;
    readonly reason: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET archived_at = ?1, archived_by = ?2, archive_reason = ?3, ` +
        `updated_at = ?1, updated_by = ?2 WHERE id = ?4`,
    )
    .bind(input.now, input.archivedBy, input.reason, input.id);
}

// Back onto the list, on the rung it left from. The reason clears with the archiving because the
// database pairs them: a reason with no archiving says why something happened that did not.
export function unarchiveMatterTaskStatement(
  database: SqlDatabase,
  input: { readonly id: MatterTaskId; readonly now: string; readonly actor: UserId },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET archived_at = NULL, archived_by = NULL, ` +
        `archive_reason = NULL, updated_at = ?1, updated_by = ?2 WHERE id = ?3`,
    )
    .bind(input.now, input.actor, input.id);
}

// Deleting a task, and it really is a delete. Archiving and deleting are not redundant and they
// differ in exactly one thing: an archive keeps the data, a delete takes it. A delete is for a task
// that should not exist — a typo, a duplicate, a line somebody abandoned before it meant anything. The
// audit row is what survives, and it carries identifiers rather than text.
export function deleteMatterTaskStatement(
  database: SqlDatabase,
  taskId: MatterTaskId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_TASK_TABLE} WHERE id = ?1`).bind(taskId);
}

export function deleteMatterTaskDocumentsStatement(
  database: SqlDatabase,
  taskId: MatterTaskId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MATTER_TASK_DOCUMENT_TABLE} WHERE task_id = ?1`)
    .bind(taskId);
}

// Whatever was blocked on this task stops being blocked, in the same batch as the deletion. Left
// behind, the pointer would dangle: nothing in SQLite enforces the self-reference, so the successor
// would render as blocked by a task nobody can open and no surface could explain it.
export function clearBlockedByStatement(
  database: SqlDatabase,
  input: { readonly taskId: MatterTaskId; readonly now: string; readonly actor: UserId | null },
): SqlStatement {
  // The cascade stamps the actor too. A successor whose blocker vanished is a task that CHANGED, so
  // it has to reach the change feed like any other edit — a mirror that missed it would keep showing
  // work as blocked by something that no longer exists.
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET blocked_by_task_id = NULL, updated_at = ?1, updated_by = ?3 ` +
        `WHERE blocked_by_task_id = ?2`,
    )
    .bind(input.now, input.taskId, input.actor);
}

// ---- reads ----

export function selectMatterTaskStatement(
  database: SqlDatabase,
  id: MatterTaskId,
  visibility: VisibleMatterPredicate,
  viewerUserId: UserId,
): SqlStatement {
  const reach = taskVisibilityFragment(visibility, viewerUserId);
  return database
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM ${MATTER_TASK_TABLE} ` +
        `WHERE ${MATTER_TASK_TABLE}.id = ? AND ${reach.condition}`,
    )
    .bind(id, ...reach.bindings);
}

export async function readMatterTask(
  database: SqlDatabase,
  id: MatterTaskId,
  visibility: VisibleMatterPredicate,
  viewerUserId: UserId,
): Promise<MatterTaskRow | undefined> {
  const { results } = await selectMatterTaskStatement(
    database,
    id,
    visibility,
    viewerUserId,
  ).all<MatterTaskRow>();
  return results[0];
}

// Finding a task again, matched against its title and body. A LIKE scan rather than an index, and a
// bounded cost rather than an unmeasured one: the matter or the assignee narrows the set first.
function searchConditionFor(
  search: string | undefined,
): { condition: string; bindings: readonly unknown[] } | undefined {
  const term = search?.trim();
  if (term === undefined || term.length === 0) return undefined;
  // The wildcards are the caller's text, not their instruction: a task about a 50% fee split must
  // not turn every following character into a match-anything.
  const escaped = term.replace(/[\\%_]/gu, (character) => `\\${character}`);
  return {
    condition:
      `(${MATTER_TASK_TABLE}.title LIKE ? ESCAPE '\\' OR ` +
      `(${MATTER_TASK_TABLE}.body IS NOT NULL AND ${MATTER_TASK_TABLE}.body LIKE ? ESCAPE '\\'))`,
    bindings: [`%${escaped}%`, `%${escaped}%`],
  };
}

export interface TaskListFilters {
  /**
   * Which rungs to show. The four the reader has, not the two columns behind them — a caller asking
   * for On Hold work should not have to know that three of the four live in one column and the
   * fourth in another.
   */
  readonly rungs?: readonly TaskRung[];
  /**
   * Whether ARCHIVED tasks are included. Left off, they are not, which is the whole point of putting
   * one away: a list that still showed it would be a list nobody could clear. `true` adds them to
   * whatever the rungs already select; there is no "archived only" here, because that is a rung
   * filter of all four plus this.
   */
  readonly includeArchived?: boolean;
  /**
   * Only the tasks this member is ON, in any role — "mine" on a list that spans the firm. Any role
   * rather than the work roles alone, because a watcher asked to see their tasks means the ones
   * they are watching too; a list that dropped those would be one they had to keep elsewhere.
   */
  readonly participantUserId?: UserId;
  readonly priorities?: readonly TaskPriority[];
  readonly search?: string;
  // Both civil dates, inclusive, and compared against `due_on` as text — which is why the column is
  // a civil date rather than an instant. An undated task matches no window.
  readonly dueFrom?: string;
  readonly dueTo?: string;
}

interface TaskListConditions {
  readonly conditions: string[];
  readonly bindings: unknown[];
}

function filterConditions(filters: TaskListFilters): TaskListConditions {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  // The four rungs, resolved back onto the two columns that hold them. `done` is the state; the
  // other three are the progress column on an open row — so a request for some of each is one OR
  // over two terms rather than a scan.
  if (filters.rungs !== undefined && filters.rungs.length > 0) {
    const open = filters.rungs.filter((rung): rung is TaskProgress => rung !== "done");
    const terms: string[] = [];
    if (filters.rungs.includes("done")) terms.push(`${MATTER_TASK_TABLE}.state = 'done'`);
    if (open.length > 0) {
      terms.push(
        `(${MATTER_TASK_TABLE}.state = 'open' AND ${MATTER_TASK_TABLE}.progress IN ` +
          `(${open.map(() => "?").join(", ")}))`,
      );
      bindings.push(...open);
    }
    conditions.push(`(${terms.join(" OR ")})`);
  }
  // Archived work is absent unless it is asked for. Stated as its own condition rather than folded
  // into the rungs because it is orthogonal to them: a task is archived FROM a rung.
  if (filters.includeArchived !== true) {
    conditions.push(`${MATTER_TASK_TABLE}.archived_at IS NULL`);
  }
  if (filters.participantUserId !== undefined) {
    conditions.push(ON_TASK_FRAGMENT);
    bindings.push(filters.participantUserId);
  }
  if (filters.priorities !== undefined && filters.priorities.length > 0) {
    conditions.push(
      `${MATTER_TASK_TABLE}.priority IN (${filters.priorities.map(() => "?").join(", ")})`,
    );
    bindings.push(...filters.priorities);
  }
  if (filters.dueFrom !== undefined) {
    conditions.push(`${MATTER_TASK_TABLE}.due_on >= ?`);
    bindings.push(filters.dueFrom);
  }
  if (filters.dueTo !== undefined) {
    conditions.push(`${MATTER_TASK_TABLE}.due_on <= ?`);
    bindings.push(filters.dueTo);
  }
  const search = searchConditionFor(filters.search);
  if (search !== undefined) {
    conditions.push(search.condition);
    bindings.push(...search.bindings);
  }
  return { conditions, bindings };
}

// The keyset cursor, in the same direction and over the same terms TASK_ORDER sorts. Three sort
// terms means a three-level comparison, and getting it wrong skips or repeats rows at a page
// boundary rather than failing — so it is written once here and nowhere else.
function cursorCondition(cursor: TaskCursor): { condition: string; bindings: unknown[] } {
  const undated = cursor.dueOn === null ? 1 : 0;
  return {
    condition:
      `((${MATTER_TASK_TABLE}.due_on IS NULL) > ? ` +
      `OR ((${MATTER_TASK_TABLE}.due_on IS NULL) = ? AND (` +
      `${MATTER_TASK_TABLE}.due_on > ? ` +
      `OR (${MATTER_TASK_TABLE}.due_on IS ? AND (${PRIORITY_RANK_EXPRESSION} > ? ` +
      `OR (${PRIORITY_RANK_EXPRESSION} = ? AND ${MATTER_TASK_TABLE}.id > ?))))))`,
    bindings: [
      undated,
      undated,
      cursor.dueOn,
      cursor.dueOn,
      cursor.priorityRank,
      cursor.priorityRank,
      cursor.id,
    ],
  };
}

export interface TaskCursor {
  readonly dueOn: string | null;
  readonly priorityRank: number;
  readonly id: string;
}

// The cursor's two halves, and they live HERE rather than at the route because the sort key has to
// agree with TASK_ORDER and cursorCondition above. Three sort terms means the key is a composite,
// and the shared cursor primitive carries one string — so the composite is packed into it rather
// than a second encoding being invented. If the ordering changes and this does not, the walk skips
// or repeats rows at a page boundary instead of failing.
//
// The separator is a character no civil date contains, so splitting is unambiguous. An undated row
// packs an empty date, which is exactly what `cursorCondition` compares against null.
const CURSOR_SEPARATOR = "|";

export function encodeTaskSortKey(row: {
  readonly due_on: string | null;
  readonly priority_rank: number;
}): string {
  return `${row.due_on ?? ""}${CURSOR_SEPARATOR}${String(row.priority_rank)}`;
}

// A malformed key is treated as no cursor at all — the first page — which is the shared primitive's
// own posture: a tampered cursor reveals nothing and rewinds rather than throwing.
export function decodeTaskCursor(sortKey: string, id: string): TaskCursor | undefined {
  const separator = sortKey.lastIndexOf(CURSOR_SEPARATOR);
  if (separator < 0) return undefined;
  const dueOn = sortKey.slice(0, separator);
  const priorityRank = Number(sortKey.slice(separator + 1));
  if (!Number.isInteger(priorityRank)) return undefined;
  return { dueOn: dueOn.length === 0 ? null : dueOn, priorityRank, id };
}

// The matter's own task list.
export function selectMatterTasksStatement(
  database: SqlDatabase,
  matterId: MatterId,
  options: {
    readonly cursor?: TaskCursor;
    readonly limit: number;
    readonly visibility: VisibleMatterPredicate;
    readonly viewerUserId: UserId;
    readonly filters?: TaskListFilters;
  },
): SqlStatement {
  const { conditions, bindings } = filterConditions(options.filters ?? {});
  conditions.unshift(`${MATTER_TASK_TABLE}.matter_id = ?`);
  bindings.unshift(matterId);
  if (options.cursor !== undefined) {
    const cursor = cursorCondition(options.cursor);
    conditions.push(cursor.condition);
    bindings.push(...cursor.bindings);
  }
  const reach = taskVisibilityFragment(options.visibility, options.viewerUserId);
  conditions.push(reach.condition);
  bindings.push(...reach.bindings);
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${TASK_COLUMNS}, ${PRIORITY_RANK_EXPRESSION} AS priority_rank ` +
        `FROM ${MATTER_TASK_TABLE} WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${TASK_ORDER} LIMIT ?`,
    )
    .bind(...bindings);
}

// "What is on my plate" — the firm-wide read, spanning every matter this member can see plus their
// own matterless work. It is one statement rather than two unioned, which is the whole argument for
// the nullable column: the branch is in the visibility fragment and the list does not know it exists.
//
// CLOSED MATTERS ARE FILTERED OUT, not their tasks archived. The matter close is advisory and
// changes no task row, so reopening a matter brings its tasks back with no backfill. A matterless
// task has no matter to be closed and is always in scope.
export function selectMyTasksStatement(
  database: SqlDatabase,
  options: {
    readonly cursor?: TaskCursor;
    readonly limit: number;
    readonly visibility: VisibleMatterPredicate;
    readonly viewerUserId: UserId;
    readonly filters?: TaskListFilters;
    readonly includeClosedMatters?: boolean;
  },
): SqlStatement {
  const { conditions, bindings } = filterConditions(options.filters ?? {});
  if (options.includeClosedMatters !== true) {
    conditions.push(
      `(${MATTER_TASK_TABLE}.matter_id IS NULL OR EXISTS (SELECT 1 FROM matter ` +
        `WHERE matter.id = ${MATTER_TASK_TABLE}.matter_id AND matter.status != 'closed'))`,
    );
  }
  if (options.cursor !== undefined) {
    const cursor = cursorCondition(options.cursor);
    conditions.push(cursor.condition);
    bindings.push(...cursor.bindings);
  }
  const reach = taskVisibilityFragment(options.visibility, options.viewerUserId);
  conditions.push(reach.condition);
  bindings.push(...reach.bindings);
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${TASK_COLUMNS}, ${PRIORITY_RANK_EXPRESSION} AS priority_rank ` +
        `FROM ${MATTER_TASK_TABLE} WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${TASK_ORDER} LIMIT ?`,
    )
    .bind(...bindings);
}

// The count the matter close advisory reads, and nothing more than a count. An advisory that listed
// titles would put free text on a close response, and a task title is free text on a matter.
export async function countOpenMatterTasks(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<number> {
  const { results } = await database
    .prepare(
      // An ARCHIVED task is not outstanding. Putting one away is the firm saying it is not happening,
      // so counting it would make the close advisory warn about work nobody is waiting on.
      `SELECT COUNT(*) AS count FROM ${MATTER_TASK_TABLE} ` +
        `WHERE matter_id = ? AND state = 'open' AND archived_at IS NULL`,
    )
    .bind(matterId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

// ---- preconditions ----

// Is this member somebody this firm can put on a task, and can they see the matter the task is on?
//
// Both halves in one read, because both refusals are about the same act and neither should be
// reachable separately. Putting a member who cannot see the matter on its task is refused at the
// write, whatever the role: the alternative is a task list with holes in it that nobody can explain,
// and being on a task is not an access grant.
//
// `assigneeVisibility` MUST be the predicate resolved for the ASSIGNEE, not for whoever is doing the
// assigning. Today those are the same object — the visible-matter predicate carries no per-member
// narrowing, and its one clause excludes the platform-owned holding matters for every member alike —
// so passing the actor's costs nothing and reads correctly. The day an information-barrier overlay
// lands it becomes one more clause in that predicate, per-member, and this parameter is where the
// difference has to arrive. Named for whose it is so that day is a call-site change somebody can
// find, rather than a silent wrong answer.
export async function memberCanBeAssigned(
  database: SqlDatabase,
  assigneeUserId: UserId,
  matterId: MatterId | null,
  assigneeVisibility: VisibleMatterPredicate,
): Promise<{ memberExists: boolean; canSeeMatter: boolean }> {
  const { results } = await database
    .prepare(`SELECT 1 AS present FROM member WHERE user_id = ? AND status = 'active'`)
    .bind(assigneeUserId)
    .all<{ present: number }>();
  const memberExists = results.length > 0;
  if (!memberExists) return { memberExists: false, canSeeMatter: false };
  // A matterless task screens nobody by matter, so there is nothing here to check.
  if (matterId === null) return { memberExists: true, canSeeMatter: true };
  // The predicate is composed over a BOUND PARAMETER rather than a column, which is what lets one
  // matter be tested without a correlated reference the fragment's own subquery would shadow.
  const visible = await database
    .prepare(`SELECT 1 AS present WHERE ${assigneeVisibility.fragmentFor("?")}`)
    .bind(matterId, ...assigneeVisibility.bindings)
    .all<{ present: number }>();
  return { memberExists: true, canSeeMatter: visible.results.length > 0 };
}

// The blocking chain, walked from a proposed predecessor. Returns true when following it reaches
// `taskId`, which is the cycle.
//
// Bounded by MAX_BLOCKING_CHAIN_DEPTH and by a seen-set, so a chain that is already corrupted cannot
// spin a request handler. One predecessor per task means this is a walk rather than a search.
export async function blockingChainReaches(
  database: SqlDatabase,
  from: MatterTaskId,
  taskId: MatterTaskId,
  maxDepth: number,
): Promise<boolean> {
  const seen = new Set<string>();
  let current: MatterTaskId | null = from;
  for (let depth = 0; depth < maxDepth && current !== null; depth++) {
    if (current === taskId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    const { results }: { results: { blocked_by_task_id: MatterTaskId | null }[] } = await database
      .prepare(`SELECT blocked_by_task_id FROM ${MATTER_TASK_TABLE} WHERE id = ?`)
      .bind(current)
      .all<{ blocked_by_task_id: MatterTaskId | null }>();
    current = results[0]?.blocked_by_task_id ?? null;
  }
  return false;
}

// ---- the files a task points at ----

export function insertMatterTaskDocumentStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskDocumentId;
    readonly taskId: MatterTaskId;
    readonly fileId: FileId;
    readonly linkedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_DOCUMENT_TABLE} (id, task_id, file_id, linked_at, linked_by) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.id, input.taskId, input.fileId, input.now, input.linkedBy);
}

// Detaching. The association goes; the document does not. This statement names the link's own id
// rather than the pair, so a caller cannot express "remove whatever links these two" and accidentally
// remove a row somebody else created in the same instant.
export function deleteMatterTaskDocumentStatement(
  database: SqlDatabase,
  id: MatterTaskDocumentId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_TASK_DOCUMENT_TABLE} WHERE id = ?1`).bind(id);
}

// The files on a set of tasks, joined to the matter's file record for the name a person reads.
// Soft-deleted files are excluded: a document the firm deleted is not on the task's list either, and
// the link row staying behind is what lets it come back if the deletion is undone.
export function selectMatterTaskDocumentsStatement(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
  visibility: VisibleMatterPredicate,
  viewerUserId: UserId,
): SqlStatement {
  const placeholders = taskIds.map(() => "?").join(", ");
  const reach = taskVisibilityFragment(visibility, viewerUserId);
  return database
    .prepare(
      `SELECT ${MATTER_TASK_DOCUMENT_TABLE}.id, ${MATTER_TASK_DOCUMENT_TABLE}.task_id, ` +
        `${MATTER_TASK_DOCUMENT_TABLE}.file_id, ${MATTER_TASK_DOCUMENT_TABLE}.linked_at, ` +
        `${MATTER_TASK_DOCUMENT_TABLE}.linked_by, file.name AS file_name, ` +
        // The media type lives on the file's CURRENT version, not on the file, and the sniffed type
        // wins over the declared one: what a file says it is was typed by whoever uploaded it, and
        // what it was read to be came from the file-type verifier.
        `COALESCE(current_version.sniffed_content_type, current_version.declared_content_type) AS content_type ` +
        `FROM ${MATTER_TASK_DOCUMENT_TABLE} ` +
        `JOIN file ON file.id = ${MATTER_TASK_DOCUMENT_TABLE}.file_id ` +
        `LEFT JOIN file_version AS current_version ON current_version.id = file.current_version_id ` +
        `JOIN ${MATTER_TASK_TABLE} ON ${MATTER_TASK_TABLE}.id = ${MATTER_TASK_DOCUMENT_TABLE}.task_id ` +
        `WHERE ${MATTER_TASK_DOCUMENT_TABLE}.task_id IN (${placeholders}) ` +
        `AND file.deleted_at IS NULL AND ${reach.condition} ` +
        `ORDER BY ${MATTER_TASK_DOCUMENT_TABLE}.linked_at ASC, ${MATTER_TASK_DOCUMENT_TABLE}.id ASC`,
    )
    .bind(...taskIds, ...reach.bindings);
}

export async function readMatterTaskDocuments(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
  visibility: VisibleMatterPredicate,
  viewerUserId: UserId,
): Promise<readonly MatterTaskDocumentRow[]> {
  if (taskIds.length === 0) return [];
  const { results } = await selectMatterTaskDocumentsStatement(
    database,
    taskIds,
    visibility,
    viewerUserId,
  ).all<MatterTaskDocumentRow>();
  return results;
}

// One link, addressed by its own id, for the detach path's precondition read.
export async function readMatterTaskDocument(
  database: SqlDatabase,
  id: MatterTaskDocumentId,
  visibility: VisibleMatterPredicate,
  viewerUserId: UserId,
): Promise<{ id: MatterTaskDocumentId; task_id: MatterTaskId } | undefined> {
  const reach = taskVisibilityFragment(visibility, viewerUserId);
  const { results } = await database
    .prepare(
      `SELECT ${MATTER_TASK_DOCUMENT_TABLE}.id, ${MATTER_TASK_DOCUMENT_TABLE}.task_id ` +
        `FROM ${MATTER_TASK_DOCUMENT_TABLE} ` +
        `JOIN ${MATTER_TASK_TABLE} ON ${MATTER_TASK_TABLE}.id = ${MATTER_TASK_DOCUMENT_TABLE}.task_id ` +
        `WHERE ${MATTER_TASK_DOCUMENT_TABLE}.id = ? AND ${reach.condition}`,
    )
    .bind(id, ...reach.bindings)
    .all<{ id: MatterTaskDocumentId; task_id: MatterTaskId }>();
  return results[0];
}

// Is this file a live file on this task's matter? The link path's one precondition, and the reason a
// task cannot point at another matter's document: a link across matters would be a disclosure
// wearing an association, and the check is in SQL rather than in the caller's head.
export async function fileIsOnMatter(
  database: SqlDatabase,
  fileId: FileId,
  matterId: MatterId,
): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT 1 AS present FROM file WHERE id = ? AND matter_id = ? AND deleted_at IS NULL`)
    .bind(fileId, matterId)
    .all<{ present: number }>();
  return results.length > 0;
}

export async function countMatterTaskDocuments(
  database: SqlDatabase,
  taskId: MatterTaskId,
): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${MATTER_TASK_DOCUMENT_TABLE} WHERE task_id = ?`)
    .bind(taskId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}
