import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  FileId,
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  MatterTaskDocumentId,
  MatterTaskId,
  UserId,
} from "@magna-carta/identifiers/types";
import { TASK_PRIORITY_RANK, type TaskDue, type TaskPriority, type TaskState } from "./types.ts";

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
//   - A task with NO MATTER is private to its assignee and whoever created it. There is no matter to
//     screen it by, and a firm-wide default would put "review the associate's performance" in front
//     of the associate.
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
      `((${MATTERLESS_TASK_MARKER} AND (${MATTER_TASK_TABLE}.assignee_user_id = ? ` +
      `OR ${MATTER_TASK_TABLE}.created_by = ?)) OR (${MATTER_TASK_TABLE}.matter_id IS NOT NULL AND ` +
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
  readonly assignee_user_id: UserId | null;
  readonly created_by: UserId;
  readonly priority: TaskPriority;
  readonly due_on: string | null;
  readonly due_at_time: string | null;
  readonly time_zone: string | null;
  readonly state: TaskState;
  readonly completed_at: string | null;
  readonly completed_by: UserId | null;
  readonly cancelled_at: string | null;
  readonly cancelled_by: UserId | null;
  readonly cancellation_reason: string | null;
  readonly blocked_by_task_id: MatterTaskId | null;
  readonly trigger_event_id: MatterEventId | null;
  readonly deadline_id: MatterDeadlineId | null;
  readonly created_at: string;
  readonly updated_at: string;
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

const TASK_COLUMNS = [
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
  "blocked_by_task_id",
  "trigger_event_id",
  "deadline_id",
  "created_at",
  "updated_at",
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
        `cancelled_by, cancellation_reason, blocked_by_task_id, trigger_event_id, deadline_id, ` +
        `created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', NULL, NULL, NULL, NULL, NULL, ` +
        `?11, ?12, ?13, ?14, ?14)`,
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
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET title = ?1, body = ?2, priority = ?3, due_on = ?4, ` +
        `due_at_time = ?5, time_zone = ?6, blocked_by_task_id = ?7, trigger_event_id = ?8, ` +
        `deadline_id = ?9, updated_at = ?10 WHERE id = ?11`,
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
      input.id,
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
  },
): SqlStatement {
  return database
    .prepare(`UPDATE ${MATTER_TASK_TABLE} SET assignee_user_id = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(input.assigneeUserId, input.now, input.id);
}

export function completeMatterTaskStatement(
  database: SqlDatabase,
  input: { readonly id: MatterTaskId; readonly completedBy: UserId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET state = 'done', completed_at = ?1, completed_by = ?2, ` +
        `updated_at = ?1 WHERE id = ?3`,
    )
    .bind(input.now, input.completedBy, input.id);
}

// Reopening. The completion columns clear because the CHECK requires an `open` row to carry none —
// but the audit row records that a completion was undone, so a task that was closed and reopened
// stays a fact about how the matter ran even though the row no longer shows it.
export function reopenMatterTaskStatement(
  database: SqlDatabase,
  input: { readonly id: MatterTaskId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET state = 'open', completed_at = NULL, completed_by = NULL, ` +
        `cancelled_at = NULL, cancelled_by = NULL, cancellation_reason = NULL, updated_at = ?1 ` +
        `WHERE id = ?2`,
    )
    .bind(input.now, input.id);
}

export function cancelMatterTaskStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskId;
    readonly cancelledBy: UserId;
    readonly reason: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET state = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, ` +
        `cancellation_reason = ?3, completed_at = NULL, completed_by = NULL, updated_at = ?1 ` +
        `WHERE id = ?4`,
    )
    .bind(input.now, input.cancelledBy, input.reason, input.id);
}

// Deleting a task, and it really is a delete. Cancellation and deletion are not redundant: a
// cancellation is a decision about work and carries its reason, while a delete is for a task that
// should not exist — a typo, a duplicate, a line somebody abandoned before it meant anything. The
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
  input: { readonly taskId: MatterTaskId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_TABLE} SET blocked_by_task_id = NULL, updated_at = ?1 ` +
        `WHERE blocked_by_task_id = ?2`,
    )
    .bind(input.now, input.taskId);
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
  readonly states?: readonly TaskState[];
  readonly assigneeUserId?: UserId;
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
  if (filters.states !== undefined && filters.states.length > 0) {
    conditions.push(`${MATTER_TASK_TABLE}.state IN (${filters.states.map(() => "?").join(", ")})`);
    bindings.push(...filters.states);
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
// CLOSED MATTERS ARE FILTERED OUT, not their tasks cancelled. The matter close is advisory and
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
      `SELECT COUNT(*) AS count FROM ${MATTER_TASK_TABLE} WHERE matter_id = ? AND state = 'open'`,
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
