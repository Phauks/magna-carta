import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  FileId,
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  MatterPlanTaskTemplateId,
  MatterPlanTemplateId,
  MatterTaskDocumentId,
  MatterTaskId,
  TaskListId,
  TaskListStatusId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  TASK_PRIORITY_RANK,
  columnsForRung,
  type TaskDue,
  type TaskPriority,
  type TaskProgress,
  type TaskRecurrenceMode,
  type TaskRung,
  type TaskState,
} from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_TASK_TABLE = "matter_task";
export const MATTER_TASK_DOCUMENT_TABLE = "matter_task_document";

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
//   - A task with NO MATTER is visible to every member. It used to be private to its assignee and
//     creator; the owner ruled on 2026-11-09 that every member sees every task, and that narrowing
//     the screen to your own work is the reader's Me Mode rather than a property of the task. Work
//     that must not be seen firm-wide belongs on a matter, where the matter's own access decides.
export const MATTERLESS_TASK_MARKER = `${MATTER_TASK_TABLE}.matter_id IS NULL`;

export interface TaskVisibility {
  readonly condition: string;
  readonly bindings: readonly unknown[];
}

// The viewer is still taken, though neither rule reads it today: every caller already has one, and a
// rule that narrows by viewer again is one line here rather than a signature change at every read.
export function taskVisibilityFragment(
  visibility: VisibleMatterPredicate,
  _viewerUserId: UserId,
): TaskVisibility {
  return {
    condition:
      `(${MATTERLESS_TASK_MARKER} OR (${MATTER_TASK_TABLE}.matter_id IS NOT NULL AND ` +
      `${visibility.fragmentFor(`${MATTER_TASK_TABLE}.matter_id`)}))`,
    bindings: [...visibility.bindings],
  };
}

// ---- rows ----

export interface MatterTaskRow {
  readonly id: MatterTaskId;
  readonly matter_id: MatterId | null;
  readonly title: string;
  readonly body: string | null;
  readonly assignee_user_id: UserId | null;
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
  // Which list the task is on and where it stands on that list's own statuses. Null only on a row a
  // fixture wrote straight into the table; every write path fills both.
  readonly list_id: TaskListId | null;
  readonly status_id: TaskListStatusId | null;
  // The task this one is a sub-task of, if any.
  readonly parent_task_id: MatterTaskId | null;
  readonly starts_on: string | null;
  readonly location: string | null;
  // A repeating task: its rule from this copy onward, when the next copy appears, the day of the
  // series this copy stands for, and the copy made from it once there is one.
  readonly recurrence_rule: string | null;
  readonly recurrence_mode: TaskRecurrenceMode | null;
  readonly recurrence_occurrence_on: string | null;
  readonly recurrence_next_task_id: MatterTaskId | null;
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

// Exported so the change feed projects exactly what every other task read projects — a sync that
// saw a different shape from the screen would be a second definition of what a task is.
export const TASK_COLUMNS = [
  "id",
  "matter_id",
  "title",
  "body",
  "assignee_user_id",
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
  "list_id",
  "status_id",
  "parent_task_id",
  "starts_on",
  "location",
  "recurrence_rule",
  "recurrence_mode",
  "recurrence_occurrence_on",
  "recurrence_next_task_id",
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
  readonly assigneeUserId: UserId | null;
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
  // The list and status. Omitted, the task lands on the firm's default list at that list's first
  // status, resolved inside the INSERT so no path (a plan acceptance, a fixture) can leave either
  // empty. A status given without a list is read against the list the row lands on.
  readonly listId?: TaskListId | null;
  readonly statusId?: TaskListStatusId | null;
  readonly parentTaskId?: MatterTaskId | null;
  readonly startsOn?: string | null;
  readonly location?: string | null;
  readonly now: string;
}

export function insertMatterTaskStatement(
  database: SqlDatabase,
  input: InsertMatterTaskInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_TABLE} (id, matter_id, title, body, assignee_user_id, created_by, ` +
        `priority, due_on, due_at_time, time_zone, state, completed_at, completed_by, cancelled_at, ` +
        `cancelled_by, cancellation_reason, progress, archived_at, archived_by, archive_reason, ` +
        `blocked_by_task_id, trigger_event_id, deadline_id, ` +
        `plan_template_id, plan_task_template_id, created_at, updated_at, updated_by, ` +
        `list_id, status_id, parent_task_id, starts_on, location) ` +
        // updated_by is the CREATOR on a fresh row: "who touched it last" at creation is whoever
        // wrote it, and a feed where some rows have an actor and some do not would make echo
        // suppression a special case at exactly the moment a sync first sees a task.
        // A fresh task is on the first rung, unarchived, and open. None of the three is a caller's
        // to set at creation: a task nobody has started is To Do, and one archived at birth is one
        // nobody should have written.
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', NULL, NULL, NULL, NULL, NULL, ` +
        `'to_do', NULL, NULL, NULL, ` +
        `?11, ?12, ?13, ?14, ?15, ?16, ?16, ?6, ` +
        `COALESCE(?17, (SELECT id FROM task_list WHERE is_default = 1 AND retired_at IS NULL)), ` +
        `COALESCE(?18, (SELECT task_list_status.id FROM task_list_status WHERE task_list_status.list_id = ` +
        `COALESCE(?17, (SELECT id FROM task_list WHERE is_default = 1 AND retired_at IS NULL)) ` +
        `ORDER BY task_list_status.position ASC, task_list_status.id ASC LIMIT 1)), ` +
        `?19, ?20, ?21)`,
    )
    .bind(
      input.id,
      input.matterId,
      input.title,
      input.body,
      input.assigneeUserId,
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
      input.listId ?? null,
      input.statusId ?? null,
      input.parentTaskId ?? null,
      input.startsOn ?? null,
      input.location ?? null,
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
    readonly startsOn: string | null;
    readonly location: string | null;
    readonly now: string;
    readonly actor: UserId | null;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET title = ?1, body = ?2, priority = ?3, due_on = ?4, ` +
        `due_at_time = ?5, time_zone = ?6, blocked_by_task_id = ?7, trigger_event_id = ?8, ` +
        `deadline_id = ?9, updated_at = ?10, updated_by = ?11, starts_on = ?13, location = ?14 ` +
        `WHERE id = ?12`,
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
      input.startsOn,
      input.location,
    );
}

// Reassignment is its own statement, and it moves the zone with the assignee only when the caller
// supplies one. A task reassigned across offices keeps its due date and its zone otherwise, because
// silently moving a due date by three hours on a reassignment is worse than a mismatch a person can
// see and fix.
export function reassignMatterTaskStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskId;
    readonly assigneeUserId: UserId | null;
    readonly now: string;
    readonly actor: UserId | null;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET assignee_user_id = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4`,
    )
    .bind(input.assigneeUserId, input.now, input.actor, input.id);
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
  readonly assigneeUserId?: UserId;
  readonly priorities?: readonly TaskPriority[];
  readonly search?: string;
  // Both civil dates, inclusive, and compared against `due_on` as text — which is why the column is
  // a civil date rather than an instant. An undated task matches no window.
  readonly dueFrom?: string;
  readonly dueTo?: string;
  // Which of the firm's lists to show. Absent, every list.
  readonly listIds?: readonly TaskListId[];
  // Only tasks that are nobody's sub-task: the rows a list screen draws at its top level, with each
  // one's sub-tasks read separately so a page boundary never splits a tree.
  readonly topLevelOnly?: boolean;
  // ME MODE, as two independent narrowings the reader combines: work assigned to this member
  // (directly, or through a team they are on), and work they are watching. Both set means EITHER.
  readonly assignedToUserId?: UserId;
  readonly watchedByUserId?: UserId;
  // Completed work only, or open work only. Absent, the rung filter above decides.
  readonly completed?: boolean;
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
  if (filters.assigneeUserId !== undefined) {
    conditions.push(`${MATTER_TASK_TABLE}.assignee_user_id = ?`);
    bindings.push(filters.assigneeUserId);
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
  if (filters.listIds !== undefined && filters.listIds.length > 0) {
    conditions.push(
      `${MATTER_TASK_TABLE}.list_id IN (${filters.listIds.map(() => "?").join(", ")})`,
    );
    bindings.push(...filters.listIds);
  }
  if (filters.topLevelOnly === true) {
    conditions.push(`${MATTER_TASK_TABLE}.parent_task_id IS NULL`);
  }
  if (filters.completed !== undefined) {
    conditions.push(`${MATTER_TASK_TABLE}.state = ?`);
    bindings.push(filters.completed ? "done" : "open");
  }
  const mine: string[] = [];
  if (filters.assignedToUserId !== undefined) {
    // Directly, or through any live team the member is on. Read from the assignee rows rather than
    // `assignee_user_id`, which only ever holds the first person named.
    mine.push(
      `EXISTS (SELECT 1 FROM matter_task_assignee WHERE matter_task_assignee.task_id = ` +
        `${MATTER_TASK_TABLE}.id AND (matter_task_assignee.user_id = ? OR ` +
        `matter_task_assignee.team_id IN (SELECT task_team_member.team_id FROM task_team_member ` +
        `JOIN task_team ON task_team.id = task_team_member.team_id ` +
        `WHERE task_team_member.user_id = ? AND task_team.retired_at IS NULL)))`,
    );
    bindings.push(filters.assignedToUserId, filters.assignedToUserId);
  }
  if (filters.watchedByUserId !== undefined) {
    mine.push(
      `EXISTS (SELECT 1 FROM matter_task_watcher WHERE matter_task_watcher.task_id = ` +
        `${MATTER_TASK_TABLE}.id AND matter_task_watcher.user_id = ?)`,
    );
    bindings.push(filters.watchedByUserId);
  }
  if (mine.length > 0) conditions.push(`(${mine.join(" OR ")})`);
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

// Is this member somebody this firm can assign work to, and can they see the matter the task is on?
//
// Both halves in one read, because both refusals are about the same act and neither should be
// reachable separately. Assigning to a member who cannot see the matter is refused at the write: the
// alternative is a task list with holes in it that nobody can explain, and an assignee is not an
// access grant.
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

// EVERY SUB-TASK UNDER THE GIVEN TASKS, at any depth, in one read. A list screen pages its top-level
// rows and then asks for their trees here, so a page boundary never splits a parent from its
// children. The walk is bounded by the depth sub-tasks may nest to, which the write paths hold.
export function selectSubtaskTreesStatement(
  database: SqlDatabase,
  rootIds: readonly MatterTaskId[],
  options: {
    readonly visibility: VisibleMatterPredicate;
    readonly viewerUserId: UserId;
    readonly includeArchived?: boolean;
    readonly maxDepth: number;
  },
): SqlStatement {
  const placeholders = rootIds.map(() => "?").join(", ");
  const reach = taskVisibilityFragment(options.visibility, options.viewerUserId);
  return database
    .prepare(
      `WITH RECURSIVE tree(id, depth) AS (` +
        `SELECT id, 1 FROM ${MATTER_TASK_TABLE} WHERE parent_task_id IN (${placeholders}) ` +
        `UNION ALL SELECT child.id, tree.depth + 1 FROM ${MATTER_TASK_TABLE} AS child ` +
        `JOIN tree ON child.parent_task_id = tree.id WHERE tree.depth < ?) ` +
        `SELECT ${TASK_COLUMNS}, ${PRIORITY_RANK_EXPRESSION} AS priority_rank ` +
        `FROM ${MATTER_TASK_TABLE} JOIN tree ON tree.id = ${MATTER_TASK_TABLE}.id ` +
        `WHERE ${reach.condition}` +
        (options.includeArchived === true ? "" : ` AND ${MATTER_TASK_TABLE}.archived_at IS NULL`) +
        ` ORDER BY ${TASK_ORDER}`,
    )
    .bind(...rootIds, options.maxDepth, ...reach.bindings);
}

export async function readSubtaskTrees(
  database: SqlDatabase,
  rootIds: readonly MatterTaskId[],
  options: {
    readonly visibility: VisibleMatterPredicate;
    readonly viewerUserId: UserId;
    readonly includeArchived?: boolean;
    readonly maxDepth: number;
  },
): Promise<readonly MatterTaskRow[]> {
  if (rootIds.length === 0) return [];
  const { results } = await selectSubtaskTreesStatement(
    database,
    rootIds,
    options,
  ).all<MatterTaskRow>();
  return results;
}

// How deep a task sits: 0 for a top-level task, 1 for its sub-task, and so on. Walks up the parent
// chain, bounded, so a corrupted chain costs a few reads rather than a request handler.
export async function taskDepth(
  database: SqlDatabase,
  taskId: MatterTaskId,
  limit: number,
): Promise<number> {
  const { results } = await database
    .prepare(
      `WITH RECURSIVE up(id, parent, depth) AS (` +
        `SELECT id, parent_task_id, 0 FROM ${MATTER_TASK_TABLE} WHERE id = ? ` +
        `UNION ALL SELECT ${MATTER_TASK_TABLE}.id, ${MATTER_TASK_TABLE}.parent_task_id, up.depth + 1 ` +
        `FROM ${MATTER_TASK_TABLE} JOIN up ON ${MATTER_TASK_TABLE}.id = up.parent WHERE up.depth < ?) ` +
        `SELECT MAX(depth) AS depth FROM up`,
    )
    .bind(taskId, limit + 1)
    .all<{ depth: number | null }>();
  return results[0]?.depth ?? 0;
}

// How deep the tree under a task goes: 0 for a task with no sub-tasks.
export async function subtreeHeight(
  database: SqlDatabase,
  taskId: MatterTaskId,
  limit: number,
): Promise<number> {
  const { results } = await database
    .prepare(
      `WITH RECURSIVE down(id, depth) AS (` +
        `SELECT id, 1 FROM ${MATTER_TASK_TABLE} WHERE parent_task_id = ? ` +
        `UNION ALL SELECT ${MATTER_TASK_TABLE}.id, down.depth + 1 FROM ${MATTER_TASK_TABLE} ` +
        `JOIN down ON ${MATTER_TASK_TABLE}.parent_task_id = down.id WHERE down.depth < ?) ` +
        `SELECT MAX(depth) AS depth FROM down`,
    )
    .bind(taskId, limit + 1)
    .all<{ depth: number | null }>();
  return results[0]?.depth ?? 0;
}

// Whether `candidateId` sits anywhere under `taskId`, so a task is never made a sub-task of its own
// descendant.
export async function isDescendantOf(
  database: SqlDatabase,
  candidateId: MatterTaskId,
  taskId: MatterTaskId,
  limit: number,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `WITH RECURSIVE down(id, depth) AS (` +
        `SELECT id, 1 FROM ${MATTER_TASK_TABLE} WHERE parent_task_id = ? ` +
        `UNION ALL SELECT ${MATTER_TASK_TABLE}.id, down.depth + 1 FROM ${MATTER_TASK_TABLE} ` +
        `JOIN down ON ${MATTER_TASK_TABLE}.parent_task_id = down.id WHERE down.depth < ?) ` +
        `SELECT 1 AS present FROM down WHERE id = ? LIMIT 1`,
    )
    .bind(taskId, limit + 1, candidateId)
    .all<{ present: number }>();
  return results.length > 0;
}

// Moves a task and its whole subtree onto one list and matter together. A sub-task shares its
// parent's list and matter, so they move as one or not at all.
export function moveSubtreeStatement(
  database: SqlDatabase,
  input: {
    readonly rootId: MatterTaskId;
    readonly listId: TaskListId;
    readonly statusIdForMoved: TaskListStatusId | null;
    readonly matterId: MatterId | null;
    readonly maxDepth: number;
    readonly now: string;
    readonly actor: UserId;
  },
): SqlStatement {
  return database
    .prepare(
      `WITH RECURSIVE down(id, depth) AS (` +
        `SELECT id, 1 FROM ${MATTER_TASK_TABLE} WHERE parent_task_id = ?1 ` +
        `UNION ALL SELECT ${MATTER_TASK_TABLE}.id, down.depth + 1 FROM ${MATTER_TASK_TABLE} ` +
        `JOIN down ON ${MATTER_TASK_TABLE}.parent_task_id = down.id WHERE down.depth < ?2) ` +
        `UPDATE ${MATTER_TASK_TABLE} SET matter_id = ?3, ` +
        // A task changing lists lands on the new list's first status; one staying keeps its own.
        `status_id = CASE WHEN list_id = ?4 THEN status_id ELSE ?5 END, list_id = ?4, ` +
        `updated_at = ?6, updated_by = ?7 ` +
        `WHERE id = ?1 OR id IN (SELECT id FROM down)`,
    )
    .bind(
      input.rootId,
      input.maxDepth,
      input.matterId,
      input.listId,
      input.statusIdForMoved,
      input.now,
      input.actor,
    );
}
