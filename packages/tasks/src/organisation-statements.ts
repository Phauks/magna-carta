import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterTaskAssigneeId,
  MatterTaskChecklistItemId,
  MatterTaskId,
  MatterTaskLinkId,
  TaskListId,
  TaskListStatusId,
  TaskTeamId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { TaskStatusColour } from "./types.ts";

// How a firm organises its task work — its lists, each list's statuses and flow, its teams — and the
// parts of a task that are rows of their own: assignees, watchers, checklist lines and links. Plain
// statements and reads; the rules about when each may be written live in organisation-service.ts.
//
// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync test.
export const TASK_LIST_TABLE = "task_list";
export const TASK_LIST_STATUS_TABLE = "task_list_status";
export const TASK_LIST_STATUS_TRANSITION_TABLE = "task_list_status_transition";
export const TASK_TEAM_TABLE = "task_team";
export const TASK_TEAM_MEMBER_TABLE = "task_team_member";
export const MATTER_TASK_ASSIGNEE_TABLE = "matter_task_assignee";
export const MATTER_TASK_WATCHER_TABLE = "matter_task_watcher";
export const MATTER_TASK_CHECKLIST_ITEM_TABLE = "matter_task_checklist_item";
export const MATTER_TASK_LINK_TABLE = "matter_task_link";

// ---- rows ----

export interface TaskListRow {
  readonly id: TaskListId;
  readonly name: string;
  readonly position: number;
  readonly is_default: number;
  readonly created_at: string;
  readonly updated_at: string;
  // Open tasks on the list, top level and sub-tasks alike, for the count beside its name.
  readonly open_count: number;
}

export interface TaskListStatusRow {
  readonly id: TaskListStatusId;
  readonly list_id: TaskListId;
  readonly name: string;
  readonly colour: TaskStatusColour;
  readonly position: number;
}

export interface TaskListTransitionRow {
  readonly from_status_id: TaskListStatusId;
  readonly to_status_id: TaskListStatusId;
}

export interface TaskTeamRow {
  readonly id: TaskTeamId;
  readonly name: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface TaskTeamMemberRow {
  readonly team_id: TaskTeamId;
  readonly user_id: UserId;
}

export interface MatterTaskAssigneeRow {
  readonly id: MatterTaskAssigneeId;
  readonly task_id: MatterTaskId;
  readonly user_id: UserId | null;
  readonly team_id: TaskTeamId | null;
  readonly position: number;
}

export interface MatterTaskWatcherRow {
  readonly task_id: MatterTaskId;
  readonly user_id: UserId;
}

export interface MatterTaskChecklistItemRow {
  readonly id: MatterTaskChecklistItemId;
  readonly task_id: MatterTaskId;
  readonly text: string;
  readonly position: number;
  readonly done_at: string | null;
  readonly done_by: UserId | null;
}

export interface MatterTaskLinkRow {
  readonly id: MatterTaskLinkId;
  readonly task_id: MatterTaskId;
  readonly url: string;
  readonly label: string | null;
  readonly position: number;
}

// ---- lists ----

export async function readTaskLists(database: SqlDatabase): Promise<readonly TaskListRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${TASK_LIST_TABLE}.id, ${TASK_LIST_TABLE}.name, ${TASK_LIST_TABLE}.position, ` +
        `${TASK_LIST_TABLE}.is_default, ${TASK_LIST_TABLE}.created_at, ${TASK_LIST_TABLE}.updated_at, ` +
        `(SELECT COUNT(*) FROM matter_task WHERE matter_task.list_id = ${TASK_LIST_TABLE}.id ` +
        `AND matter_task.state = 'open' AND matter_task.archived_at IS NULL) AS open_count ` +
        `FROM ${TASK_LIST_TABLE} WHERE ${TASK_LIST_TABLE}.retired_at IS NULL ` +
        `ORDER BY ${TASK_LIST_TABLE}.position ASC, ${TASK_LIST_TABLE}.name ASC`,
    )
    .all<TaskListRow>();
  return results;
}

export async function readTaskList(
  database: SqlDatabase,
  id: TaskListId,
): Promise<TaskListRow | undefined> {
  const lists = await readTaskLists(database);
  return lists.find((list) => list.id === id);
}

export async function readDefaultTaskListId(database: SqlDatabase): Promise<TaskListId | null> {
  const { results } = await database
    .prepare(
      `SELECT id FROM ${TASK_LIST_TABLE} WHERE is_default = 1 AND retired_at IS NULL LIMIT 1`,
    )
    .all<{ id: TaskListId }>();
  return results[0]?.id ?? null;
}

export function insertTaskListStatement(
  database: SqlDatabase,
  input: {
    readonly id: TaskListId;
    readonly name: string;
    readonly position: number;
    readonly actor: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TASK_LIST_TABLE} (id, name, position, is_default, created_at, created_by, ` +
        `updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?4)`,
    )
    .bind(input.id, input.name, input.position, input.now, input.actor);
}

export function renameTaskListStatement(
  database: SqlDatabase,
  input: { readonly id: TaskListId; readonly name: string; readonly now: string },
): SqlStatement {
  return database
    .prepare(`UPDATE ${TASK_LIST_TABLE} SET name = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(input.name, input.now, input.id);
}

// Two statements in one batch, the first clearing the old default so the partial unique index never
// sees two at once.
export function makeDefaultTaskListStatements(
  database: SqlDatabase,
  input: { readonly id: TaskListId; readonly now: string },
): readonly SqlStatement[] {
  return [
    database
      .prepare(`UPDATE ${TASK_LIST_TABLE} SET is_default = 0, updated_at = ?1 WHERE is_default = 1`)
      .bind(input.now),
    database
      .prepare(`UPDATE ${TASK_LIST_TABLE} SET is_default = 1, updated_at = ?1 WHERE id = ?2`)
      .bind(input.now, input.id),
  ];
}

export function retireTaskListStatement(
  database: SqlDatabase,
  input: { readonly id: TaskListId; readonly now: string },
): SqlStatement {
  return database
    .prepare(`UPDATE ${TASK_LIST_TABLE} SET retired_at = ?1, updated_at = ?1 WHERE id = ?2`)
    .bind(input.now, input.id);
}

export async function liveTaskListNameTaken(
  database: SqlDatabase,
  name: string,
  exceptId: TaskListId | null,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT 1 AS present FROM ${TASK_LIST_TABLE} WHERE retired_at IS NULL AND name = ? COLLATE NOCASE ` +
        `AND id IS NOT ? LIMIT 1`,
    )
    .bind(name, exceptId)
    .all<{ present: number }>();
  return results.length > 0;
}

// ---- statuses and the flow ----

export async function readTaskListStatuses(
  database: SqlDatabase,
  listIds?: readonly TaskListId[],
): Promise<readonly TaskListStatusRow[]> {
  const scoped = listIds !== undefined;
  if (scoped && listIds.length === 0) return [];
  const { results } = await database
    .prepare(
      `SELECT id, list_id, name, colour, position FROM ${TASK_LIST_STATUS_TABLE} ` +
        (scoped ? `WHERE list_id IN (${listIds.map(() => "?").join(", ")}) ` : "") +
        `ORDER BY list_id ASC, position ASC, id ASC`,
    )
    .bind(...(listIds ?? []))
    .all<TaskListStatusRow>();
  return results;
}

export async function readTaskListTransitions(
  database: SqlDatabase,
): Promise<readonly TaskListTransitionRow[]> {
  const { results } = await database
    .prepare(
      `SELECT from_status_id, to_status_id FROM ${TASK_LIST_STATUS_TRANSITION_TABLE} ` +
        `ORDER BY from_status_id ASC, to_status_id ASC`,
    )
    .all<TaskListTransitionRow>();
  return results;
}

export async function transitionAllowed(
  database: SqlDatabase,
  fromStatusId: TaskListStatusId,
  toStatusId: TaskListStatusId,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT 1 AS present FROM ${TASK_LIST_STATUS_TRANSITION_TABLE} ` +
        `WHERE from_status_id = ? AND to_status_id = ?`,
    )
    .bind(fromStatusId, toStatusId)
    .all<{ present: number }>();
  return results.length > 0;
}

export function insertTaskListStatusStatement(
  database: SqlDatabase,
  input: {
    readonly id: TaskListStatusId;
    readonly listId: TaskListId;
    readonly name: string;
    readonly colour: TaskStatusColour;
    readonly position: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TASK_LIST_STATUS_TABLE} (id, list_id, name, colour, position, created_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(input.id, input.listId, input.name, input.colour, input.position, input.now);
}

export function updateTaskListStatusStatement(
  database: SqlDatabase,
  input: {
    readonly id: TaskListStatusId;
    readonly name: string;
    readonly colour: TaskStatusColour;
    readonly position: number;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TASK_LIST_STATUS_TABLE} SET name = ?1, colour = ?2, position = ?3 WHERE id = ?4`,
    )
    .bind(input.name, input.colour, input.position, input.id);
}

// Removing a status takes its flow rows with it, in the same batch, before the status itself.
export function deleteTaskListStatusStatements(
  database: SqlDatabase,
  id: TaskListStatusId,
): readonly SqlStatement[] {
  return [
    database
      .prepare(
        `DELETE FROM ${TASK_LIST_STATUS_TRANSITION_TABLE} WHERE from_status_id = ?1 OR to_status_id = ?1`,
      )
      .bind(id),
    database.prepare(`DELETE FROM ${TASK_LIST_STATUS_TABLE} WHERE id = ?1`).bind(id),
  ];
}

// The whole flow out of one status, replaced in one batch: what the Can Move To toggles write.
export function replaceStatusFlowStatements(
  database: SqlDatabase,
  fromStatusId: TaskListStatusId,
  toStatusIds: readonly TaskListStatusId[],
): readonly SqlStatement[] {
  return [
    database
      .prepare(`DELETE FROM ${TASK_LIST_STATUS_TRANSITION_TABLE} WHERE from_status_id = ?1`)
      .bind(fromStatusId),
    ...toStatusIds.map((toStatusId) =>
      database
        .prepare(
          `INSERT INTO ${TASK_LIST_STATUS_TRANSITION_TABLE} (from_status_id, to_status_id) VALUES (?1, ?2)`,
        )
        .bind(fromStatusId, toStatusId),
    ),
  ];
}

export async function countTasksOnStatus(
  database: SqlDatabase,
  statusId: TaskListStatusId,
): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS count FROM matter_task WHERE status_id = ?`)
    .bind(statusId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

export async function countTasksOnList(database: SqlDatabase, listId: TaskListId): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM matter_task WHERE list_id = ? AND archived_at IS NULL ` +
        `AND state = 'open'`,
    )
    .bind(listId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

// Every task on a retiring list moves to another list's first status, in the same batch.
export function moveListTasksStatement(
  database: SqlDatabase,
  input: {
    readonly fromListId: TaskListId;
    readonly toListId: TaskListId;
    readonly toStatusId: TaskListStatusId;
    readonly now: string;
    readonly actor: UserId;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE matter_task SET list_id = ?1, status_id = ?2, updated_at = ?3, updated_by = ?4 ` +
        `WHERE list_id = ?5`,
    )
    .bind(input.toListId, input.toStatusId, input.now, input.actor, input.fromListId);
}

export function setTaskStatusStatement(
  database: SqlDatabase,
  input: {
    readonly taskId: MatterTaskId;
    readonly statusId: TaskListStatusId;
    readonly now: string;
    readonly actor: UserId;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE matter_task SET status_id = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4`,
    )
    .bind(input.statusId, input.now, input.actor, input.taskId);
}

// ---- teams ----

export async function readTaskTeams(database: SqlDatabase): Promise<readonly TaskTeamRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, name, created_at, updated_at FROM ${TASK_TEAM_TABLE} WHERE retired_at IS NULL ` +
        `ORDER BY name ASC`,
    )
    .all<TaskTeamRow>();
  return results;
}

export async function readTaskTeamMembers(
  database: SqlDatabase,
): Promise<readonly TaskTeamMemberRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${TASK_TEAM_MEMBER_TABLE}.team_id, ${TASK_TEAM_MEMBER_TABLE}.user_id ` +
        `FROM ${TASK_TEAM_MEMBER_TABLE} JOIN ${TASK_TEAM_TABLE} ON ${TASK_TEAM_TABLE}.id = ` +
        `${TASK_TEAM_MEMBER_TABLE}.team_id WHERE ${TASK_TEAM_TABLE}.retired_at IS NULL ` +
        `ORDER BY ${TASK_TEAM_MEMBER_TABLE}.added_at ASC, ${TASK_TEAM_MEMBER_TABLE}.user_id ASC`,
    )
    .all<TaskTeamMemberRow>();
  return results;
}

export async function liveTaskTeamNameTaken(
  database: SqlDatabase,
  name: string,
  exceptId: TaskTeamId | null,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT 1 AS present FROM ${TASK_TEAM_TABLE} WHERE retired_at IS NULL AND name = ? COLLATE NOCASE ` +
        `AND id IS NOT ? LIMIT 1`,
    )
    .bind(name, exceptId)
    .all<{ present: number }>();
  return results.length > 0;
}

export function insertTaskTeamStatement(
  database: SqlDatabase,
  input: {
    readonly id: TaskTeamId;
    readonly name: string;
    readonly actor: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TASK_TEAM_TABLE} (id, name, created_at, created_by, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?3)`,
    )
    .bind(input.id, input.name, input.now, input.actor);
}

export function renameTaskTeamStatement(
  database: SqlDatabase,
  input: { readonly id: TaskTeamId; readonly name: string; readonly now: string },
): SqlStatement {
  return database
    .prepare(`UPDATE ${TASK_TEAM_TABLE} SET name = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(input.name, input.now, input.id);
}

// Retiring a team leaves its past assignments as history but stops them counting: a task assigned
// only to a retired team reads as unassigned to that team's members, because the Me Mode read joins
// live teams only. The assignee rows naming it are removed so no task shows a team nobody can open.
export function retireTaskTeamStatements(
  database: SqlDatabase,
  input: { readonly id: TaskTeamId; readonly now: string },
): readonly SqlStatement[] {
  return [
    database.prepare(`DELETE FROM ${MATTER_TASK_ASSIGNEE_TABLE} WHERE team_id = ?1`).bind(input.id),
    database
      .prepare(`UPDATE ${TASK_TEAM_TABLE} SET retired_at = ?1, updated_at = ?1 WHERE id = ?2`)
      .bind(input.now, input.id),
  ];
}

export function replaceTaskTeamMembersStatements(
  database: SqlDatabase,
  input: { readonly id: TaskTeamId; readonly userIds: readonly UserId[]; readonly now: string },
): readonly SqlStatement[] {
  return [
    database.prepare(`DELETE FROM ${TASK_TEAM_MEMBER_TABLE} WHERE team_id = ?1`).bind(input.id),
    ...input.userIds.map((userId) =>
      database
        .prepare(
          `INSERT INTO ${TASK_TEAM_MEMBER_TABLE} (team_id, user_id, added_at) VALUES (?1, ?2, ?3)`,
        )
        .bind(input.id, userId, input.now),
    ),
  ];
}

// ---- a task's assignees and watchers ----

export async function readTaskAssignees(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
): Promise<readonly MatterTaskAssigneeRow[]> {
  if (taskIds.length === 0) return [];
  const { results } = await database
    .prepare(
      `SELECT id, task_id, user_id, team_id, position FROM ${MATTER_TASK_ASSIGNEE_TABLE} ` +
        `WHERE task_id IN (${taskIds.map(() => "?").join(", ")}) ORDER BY task_id ASC, position ASC`,
    )
    .bind(...taskIds)
    .all<MatterTaskAssigneeRow>();
  return results;
}

export async function readTaskWatchers(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
): Promise<readonly MatterTaskWatcherRow[]> {
  if (taskIds.length === 0) return [];
  const { results } = await database
    .prepare(
      `SELECT task_id, user_id FROM ${MATTER_TASK_WATCHER_TABLE} ` +
        `WHERE task_id IN (${taskIds.map(() => "?").join(", ")}) ORDER BY task_id ASC, added_at ASC`,
    )
    .bind(...taskIds)
    .all<MatterTaskWatcherRow>();
  return results;
}

export type TaskAssigneeInput =
  | { readonly userId: UserId; readonly teamId?: undefined }
  | { readonly teamId: TaskTeamId; readonly userId?: undefined };

// The whole assignee set, replaced in one batch, with the task's own `assignee_user_id` kept as the
// first person named: the assignment notification, the mirror seam and the "what is on my plate"
// index all read that column.
export function replaceTaskAssigneesStatements(
  database: SqlDatabase,
  input: {
    readonly taskId: MatterTaskId;
    readonly assignees: readonly (TaskAssigneeInput & { readonly id: MatterTaskAssigneeId })[];
    readonly actor: UserId;
    readonly now: string;
  },
): readonly SqlStatement[] {
  const firstPerson = input.assignees.find((assignee) => assignee.userId !== undefined)?.userId;
  return [
    database
      .prepare(`DELETE FROM ${MATTER_TASK_ASSIGNEE_TABLE} WHERE task_id = ?1`)
      .bind(input.taskId),
    ...input.assignees.map((assignee, position) =>
      database
        .prepare(
          `INSERT INTO ${MATTER_TASK_ASSIGNEE_TABLE} (id, task_id, user_id, team_id, position, ` +
            `added_at, added_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          assignee.id,
          input.taskId,
          assignee.userId ?? null,
          assignee.teamId ?? null,
          position,
          input.now,
          input.actor,
        ),
    ),
    database
      .prepare(
        `UPDATE matter_task SET assignee_user_id = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4`,
      )
      .bind(firstPerson ?? null, input.now, input.actor, input.taskId),
  ];
}

export function replaceTaskWatchersStatements(
  database: SqlDatabase,
  input: {
    readonly taskId: MatterTaskId;
    readonly userIds: readonly UserId[];
    readonly actor: UserId;
    readonly now: string;
  },
): readonly SqlStatement[] {
  return [
    database
      .prepare(`DELETE FROM ${MATTER_TASK_WATCHER_TABLE} WHERE task_id = ?1`)
      .bind(input.taskId),
    ...input.userIds.map((userId) =>
      database
        .prepare(
          `INSERT INTO ${MATTER_TASK_WATCHER_TABLE} (task_id, user_id, added_at, added_by) ` +
            `VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(input.taskId, userId, input.now, input.actor),
    ),
  ];
}

// ---- a task's checklist and links ----

export async function readTaskChecklistItems(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
): Promise<readonly MatterTaskChecklistItemRow[]> {
  if (taskIds.length === 0) return [];
  const { results } = await database
    .prepare(
      `SELECT id, task_id, text, position, done_at, done_by FROM ${MATTER_TASK_CHECKLIST_ITEM_TABLE} ` +
        `WHERE task_id IN (${taskIds.map(() => "?").join(", ")}) ORDER BY task_id ASC, position ASC, id ASC`,
    )
    .bind(...taskIds)
    .all<MatterTaskChecklistItemRow>();
  return results;
}

export async function readTaskLinks(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
): Promise<readonly MatterTaskLinkRow[]> {
  if (taskIds.length === 0) return [];
  const { results } = await database
    .prepare(
      `SELECT id, task_id, url, label, position FROM ${MATTER_TASK_LINK_TABLE} ` +
        `WHERE task_id IN (${taskIds.map(() => "?").join(", ")}) ORDER BY task_id ASC, position ASC, id ASC`,
    )
    .bind(...taskIds)
    .all<MatterTaskLinkRow>();
  return results;
}

export function insertChecklistItemStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskChecklistItemId;
    readonly taskId: MatterTaskId;
    readonly text: string;
    readonly now: string;
  },
): SqlStatement {
  // Appended after the last line, whatever positions earlier deletes left behind.
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_CHECKLIST_ITEM_TABLE} (id, task_id, text, position, created_at) ` +
        `VALUES (?1, ?2, ?3, COALESCE((SELECT MAX(position) + 1 FROM ${MATTER_TASK_CHECKLIST_ITEM_TABLE} ` +
        `WHERE task_id = ?2), 0), ?4)`,
    )
    .bind(input.id, input.taskId, input.text, input.now);
}

export function updateChecklistItemStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskChecklistItemId;
    readonly text: string;
    readonly done: boolean;
    readonly actor: UserId;
    readonly now: string;
  },
): SqlStatement {
  // A line already ticked keeps who ticked it and when; unticking clears both together.
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_CHECKLIST_ITEM_TABLE} SET text = ?1, ` +
        `done_at = CASE WHEN ?2 = 0 THEN NULL ELSE COALESCE(done_at, ?3) END, ` +
        `done_by = CASE WHEN ?2 = 0 THEN NULL ELSE COALESCE(done_by, ?4) END WHERE id = ?5`,
    )
    .bind(input.text, input.done ? 1 : 0, input.now, input.actor, input.id);
}

export function deleteChecklistItemStatement(
  database: SqlDatabase,
  id: MatterTaskChecklistItemId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_TASK_CHECKLIST_ITEM_TABLE} WHERE id = ?1`).bind(id);
}

export function insertTaskLinkStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskLinkId;
    readonly taskId: MatterTaskId;
    readonly url: string;
    readonly label: string | null;
    readonly actor: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_LINK_TABLE} (id, task_id, url, label, position, created_at, created_by) ` +
        `VALUES (?1, ?2, ?3, ?4, COALESCE((SELECT MAX(position) + 1 FROM ${MATTER_TASK_LINK_TABLE} ` +
        `WHERE task_id = ?2), 0), ?5, ?6)`,
    )
    .bind(input.id, input.taskId, input.url, input.label, input.now, input.actor);
}

export function deleteTaskLinkStatement(database: SqlDatabase, id: MatterTaskLinkId): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_TASK_LINK_TABLE} WHERE id = ?1`).bind(id);
}

export async function readChecklistItemTask(
  database: SqlDatabase,
  id: MatterTaskChecklistItemId,
): Promise<{ task_id: MatterTaskId; text: string; done_at: string | null } | undefined> {
  const { results } = await database
    .prepare(`SELECT task_id, text, done_at FROM ${MATTER_TASK_CHECKLIST_ITEM_TABLE} WHERE id = ?`)
    .bind(id)
    .all<{ task_id: MatterTaskId; text: string; done_at: string | null }>();
  return results[0];
}

export async function readTaskLinkTask(
  database: SqlDatabase,
  id: MatterTaskLinkId,
): Promise<MatterTaskId | undefined> {
  const { results } = await database
    .prepare(`SELECT task_id FROM ${MATTER_TASK_LINK_TABLE} WHERE id = ?`)
    .bind(id)
    .all<{ task_id: MatterTaskId }>();
  return results[0]?.task_id;
}

export async function countRows(
  database: SqlDatabase,
  table: typeof MATTER_TASK_CHECKLIST_ITEM_TABLE | typeof MATTER_TASK_LINK_TABLE,
  taskId: MatterTaskId,
): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE task_id = ?`)
    .bind(taskId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

// Everything a deleted task leaves behind in these tables, removed in the same batch as the task.
export function deleteTaskOrganisationRowsStatements(
  database: SqlDatabase,
  taskId: MatterTaskId,
): readonly SqlStatement[] {
  return [
    MATTER_TASK_ASSIGNEE_TABLE,
    MATTER_TASK_WATCHER_TABLE,
    MATTER_TASK_CHECKLIST_ITEM_TABLE,
    MATTER_TASK_LINK_TABLE,
  ].map((table) => database.prepare(`DELETE FROM ${table} WHERE task_id = ?1`).bind(taskId));
}
