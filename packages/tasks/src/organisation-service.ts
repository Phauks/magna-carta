import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  MatterId,
  MatterTaskAssigneeId,
  MatterTaskChecklistItemId,
  MatterTaskId,
  MatterTaskLinkId,
  TaskListId,
  TaskListStatusId,
  TaskTeamId,
  UserId,
} from "@magna-carta/identifiers/types";
import { assignmentTopicFor } from "./notifications.ts";
import {
  MATTER_TASK_CHECKLIST_ITEM_TABLE,
  MATTER_TASK_LINK_TABLE,
  countRows,
  countTasksOnStatus,
  deleteChecklistItemStatement,
  deleteTaskListStatusStatements,
  deleteTaskLinkStatement,
  insertChecklistItemStatement,
  insertTaskLinkStatement,
  insertTaskListStatement,
  insertTaskListStatusStatement,
  insertTaskTeamStatement,
  liveTaskListNameTaken,
  liveTaskTeamNameTaken,
  makeDefaultTaskListStatements,
  moveListTasksStatement,
  readChecklistItemTask,
  readTaskAssignees,
  readTaskLinkTask,
  readTaskListStatuses,
  readTaskLists,
  readTaskTeams,
  renameTaskListStatement,
  renameTaskTeamStatement,
  replaceStatusFlowStatements,
  replaceTaskAssigneesStatements,
  replaceTaskTeamMembersStatements,
  replaceTaskWatchersStatements,
  retireTaskListStatement,
  retireTaskTeamStatements,
  setTaskStatusStatement,
  transitionAllowed,
  updateChecklistItemStatement,
  updateTaskListStatusStatement,
  type TaskAssigneeInput,
  type TaskListStatusRow,
} from "./organisation-statements.ts";
import { requireVisibleTask, type TaskServiceOptions } from "./task-service.ts";
import { memberCanBeAssigned, moveSubtreeStatement } from "./task-statements.ts";
import {
  MAX_SUBTASK_DEPTH,
  MAX_TASK_ASSIGNEES,
  MAX_TASK_CHECKLIST_ITEMS,
  MAX_TASK_LINKS,
  MAX_TASK_LIST_STATUSES,
  MAX_TASK_LISTS,
  MAX_TASK_TEAM_MEMBERS,
  MAX_TASK_TEAMS,
  MAX_TASK_WATCHERS,
} from "./types.ts";
import {
  TaskValidationError,
  normalizeChecklistItemText,
  normalizeTaskLink,
  normalizeTaskListName,
  normalizeTaskStatusColour,
  normalizeTaskStatusName,
  normalizeTaskTeamName,
} from "./validation.ts";

// The write paths for how a firm organises its task work — lists, each list's statuses and flow,
// teams — and for the parts of a task that are rows of their own: assignees, watchers, its status,
// the list it is on, checklist lines and links.
//
// As in task-service.ts, nothing here reads a clock or a database binding of its own: the clock, the
// actor and the random source arrive as options, and every path returns the batch it would write.

type Organisation = Omit<TaskServiceOptions, "visibility">;

function audit(
  database: SqlDatabase,
  options: Organisation,
  event: string,
  subjectId: string,
  metadata: Record<string, unknown>,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
    metadata,
  });
}

function effectOf(statements: readonly SqlStatement[]): { effect: EffectWrite } {
  return { effect: { statements: [...statements], outboxMessages: [] } };
}

// ---- lists ----

export async function createTaskList(
  database: SqlDatabase,
  input: { readonly name: string },
  options: Organisation,
): Promise<{ listId: TaskListId; effect: EffectWrite }> {
  const name = normalizeTaskListName(input.name);
  const lists = await readTaskLists(database);
  if (lists.length >= MAX_TASK_LISTS) {
    throw new TaskValidationError(
      "task-list-too-many",
      `a firm keeps at most ${String(MAX_TASK_LISTS)} task lists`,
    );
  }
  if (await liveTaskListNameTaken(database, name, null)) {
    throw new TaskValidationError("task-list-name-taken", "there is already a list with that name");
  }
  const now = options.clock.now();
  const listId = newIdentifier("taskList", options.randomSource);
  // A new list starts with the two statuses every list needs before a firm shapes it — somewhere to
  // start and somewhere to be working — and the move each way, so it is usable the moment it exists.
  const toDo = newIdentifier("taskListStatus", options.randomSource);
  const inProgress = newIdentifier("taskListStatus", options.randomSource);
  const position = lists.reduce((highest, list) => Math.max(highest, list.position), -1) + 1;
  return {
    listId,
    ...effectOf([
      insertTaskListStatement(database, {
        id: listId,
        name,
        position,
        actor: options.actorUserId,
        now,
      }),
      insertTaskListStatusStatement(database, {
        id: toDo,
        listId,
        name: "To Do",
        colour: "gray",
        position: 0,
        now,
      }),
      insertTaskListStatusStatement(database, {
        id: inProgress,
        listId,
        name: "In Progress",
        colour: "blue",
        position: 1,
        now,
      }),
      ...replaceStatusFlowStatements(database, toDo, [inProgress]),
      ...replaceStatusFlowStatements(database, inProgress, [toDo]),
      audit(database, options, "tasks.list.created", listId, {}),
    ]),
  };
}

async function requireList(database: SqlDatabase, listId: TaskListId) {
  const list = (await readTaskLists(database)).find((candidate) => candidate.id === listId);
  if (list === undefined) {
    throw new TaskValidationError("task-list-unknown", "that is not one of the firm's task lists");
  }
  return list;
}

export async function renameTaskList(
  database: SqlDatabase,
  listId: TaskListId,
  input: { readonly name: string },
  options: Organisation,
): Promise<{ effect: EffectWrite }> {
  const name = normalizeTaskListName(input.name);
  await requireList(database, listId);
  if (await liveTaskListNameTaken(database, name, listId)) {
    throw new TaskValidationError("task-list-name-taken", "there is already a list with that name");
  }
  const now = options.clock.now();
  return effectOf([
    renameTaskListStatement(database, { id: listId, name, now }),
    audit(database, options, "tasks.list.renamed", listId, {}),
  ]);
}

export async function makeTaskListDefault(
  database: SqlDatabase,
  listId: TaskListId,
  options: Organisation,
): Promise<{ effect: EffectWrite }> {
  await requireList(database, listId);
  const now = options.clock.now();
  return effectOf([
    ...makeDefaultTaskListStatements(database, { id: listId, now }),
    audit(database, options, "tasks.list.madeDefault", listId, {}),
  ]);
}

// Retiring a list moves every task on it to another list's first status, in the same batch, so no
// task is ever left on a list nobody can see. The default list cannot be retired: a new task always
// has somewhere to land.
export async function retireTaskList(
  database: SqlDatabase,
  listId: TaskListId,
  input: { readonly moveTasksToListId: TaskListId },
  options: Organisation,
): Promise<{ effect: EffectWrite }> {
  const list = await requireList(database, listId);
  if (list.is_default === 1) {
    throw new TaskValidationError(
      "task-list-is-default",
      "make another list the default before retiring this one",
    );
  }
  if (input.moveTasksToListId === listId) {
    throw new TaskValidationError("task-list-unknown", "move its tasks to a different list");
  }
  await requireList(database, input.moveTasksToListId);
  const [firstStatus] = await readTaskListStatuses(database, [input.moveTasksToListId]);
  if (firstStatus === undefined) {
    throw new TaskValidationError("task-status-unknown", "that list has no status to land on");
  }
  const now = options.clock.now();
  return effectOf([
    moveListTasksStatement(database, {
      fromListId: listId,
      toListId: input.moveTasksToListId,
      toStatusId: firstStatus.id,
      now,
      actor: options.actorUserId,
    }),
    retireTaskListStatement(database, { id: listId, now }),
    audit(database, options, "tasks.list.retired", listId, {
      movedToListId: input.moveTasksToListId,
    }),
  ]);
}

// ---- statuses and the flow ----

async function requireStatus(
  database: SqlDatabase,
  statusId: TaskListStatusId,
): Promise<{ status: TaskListStatusRow; siblings: readonly TaskListStatusRow[] }> {
  const all = await readTaskListStatuses(database);
  const status = all.find((candidate) => candidate.id === statusId);
  if (status === undefined) {
    throw new TaskValidationError("task-status-unknown", "that is not a status on any list");
  }
  return { status, siblings: all.filter((candidate) => candidate.list_id === status.list_id) };
}

export async function addTaskListStatus(
  database: SqlDatabase,
  listId: TaskListId,
  input: { readonly name: string; readonly colour: string },
  options: Organisation,
): Promise<{ statusId: TaskListStatusId; effect: EffectWrite }> {
  const name = normalizeTaskStatusName(input.name);
  const colour = normalizeTaskStatusColour(input.colour);
  await requireList(database, listId);
  const siblings = await readTaskListStatuses(database, [listId]);
  if (siblings.length >= MAX_TASK_LIST_STATUSES) {
    throw new TaskValidationError(
      "task-status-too-many",
      `a list holds at most ${String(MAX_TASK_LIST_STATUSES)} statuses`,
    );
  }
  if (siblings.some((sibling) => sibling.name === name)) {
    throw new TaskValidationError("task-status-name-taken", "this list already has that status");
  }
  const now = options.clock.now();
  const statusId = newIdentifier("taskListStatus", options.randomSource);
  const position =
    siblings.reduce((highest, sibling) => Math.max(highest, sibling.position), -1) + 1;
  return {
    statusId,
    ...effectOf([
      insertTaskListStatusStatement(database, {
        id: statusId,
        listId,
        name,
        colour,
        position,
        now,
      }),
      audit(database, options, "tasks.status.added", statusId, { listId }),
    ]),
  };
}

// Renaming, recolouring and reordering, in one write. Moving a status to the first position makes it
// where new tasks start; the positions of its siblings are the caller's to keep distinct.
export async function updateTaskListStatus(
  database: SqlDatabase,
  statusId: TaskListStatusId,
  input: { readonly name: string; readonly colour: string; readonly position: number },
  options: Organisation,
): Promise<{ effect: EffectWrite }> {
  const name = normalizeTaskStatusName(input.name);
  const colour = normalizeTaskStatusColour(input.colour);
  const { siblings } = await requireStatus(database, statusId);
  if (siblings.some((sibling) => sibling.id !== statusId && sibling.name === name)) {
    throw new TaskValidationError("task-status-name-taken", "this list already has that status");
  }
  return effectOf([
    updateTaskListStatusStatement(database, {
      id: statusId,
      name,
      colour,
      position: Math.max(0, Math.trunc(input.position)),
    }),
    audit(database, options, "tasks.status.updated", statusId, { colour }),
  ]);
}

// A status leaves only when no task stands on it, and never the list's last one: a list with no
// status has nowhere for a new task to start.
export async function removeTaskListStatus(
  database: SqlDatabase,
  statusId: TaskListStatusId,
  options: Organisation,
): Promise<{ effect: EffectWrite }> {
  const { status, siblings } = await requireStatus(database, statusId);
  if (siblings.length <= 1) {
    throw new TaskValidationError("task-status-last", "a list needs at least one status");
  }
  const inUse = await countTasksOnStatus(database, statusId);
  if (inUse > 0) {
    throw new TaskValidationError(
      "task-status-in-use",
      `${String(inUse)} ${inUse === 1 ? "task is" : "tasks are"} on this status; move them first`,
    );
  }
  return effectOf([
    ...deleteTaskListStatusStatements(database, statusId),
    audit(database, options, "tasks.status.removed", statusId, { listId: status.list_id }),
  ]);
}

// The whole flow out of one status: the statuses a task on it may move to next.
export async function setTaskStatusFlow(
  database: SqlDatabase,
  statusId: TaskListStatusId,
  input: { readonly toStatusIds: readonly TaskListStatusId[] },
  options: Organisation,
): Promise<{ effect: EffectWrite }> {
  const { siblings } = await requireStatus(database, statusId);
  const onList = new Set(siblings.map((sibling) => sibling.id));
  const targets = [...new Set(input.toStatusIds)].filter((target) => target !== statusId);
  for (const target of targets) {
    if (!onList.has(target)) {
      throw new TaskValidationError(
        "task-status-unknown",
        "a status moves only to another status on the same list",
      );
    }
  }
  return effectOf([
    ...replaceStatusFlowStatements(database, statusId, targets),
    audit(database, options, "tasks.status.flowChanged", statusId, { toCount: targets.length }),
  ]);
}

// ---- teams ----

async function assertMembers(
  database: SqlDatabase,
  userIds: readonly UserId[],
): Promise<readonly UserId[]> {
  const unique = [...new Set(userIds)];
  if (unique.length > MAX_TASK_TEAM_MEMBERS) {
    throw new TaskValidationError(
      "task-team-too-many-members",
      `a team holds at most ${String(MAX_TASK_TEAM_MEMBERS)} members`,
    );
  }
  for (const userId of unique) {
    if (!(await memberIsActive(database, userId))) {
      throw new TaskValidationError(
        "task-unknown-assignee",
        "that is not an active member of this firm",
      );
    }
  }
  return unique;
}

// Team membership is checked against the firm, not a matter: a team is not on any matter.
async function memberIsActive(database: SqlDatabase, userId: UserId): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT 1 AS present FROM member WHERE user_id = ? AND status = 'active'`)
    .bind(userId)
    .all<{ present: number }>();
  return results.length > 0;
}

export async function createTaskTeam(
  database: SqlDatabase,
  input: { readonly name: string; readonly memberUserIds: readonly UserId[] },
  options: Organisation,
): Promise<{ teamId: TaskTeamId; effect: EffectWrite }> {
  const name = normalizeTaskTeamName(input.name);
  if ((await readTaskTeams(database)).length >= MAX_TASK_TEAMS) {
    throw new TaskValidationError(
      "task-team-too-many",
      `a firm keeps at most ${String(MAX_TASK_TEAMS)} teams`,
    );
  }
  if (await liveTaskTeamNameTaken(database, name, null)) {
    throw new TaskValidationError("task-team-name-taken", "there is already a team with that name");
  }
  const members = await assertMembers(database, input.memberUserIds);
  const now = options.clock.now();
  const teamId = newIdentifier("taskTeam", options.randomSource);
  return {
    teamId,
    ...effectOf([
      insertTaskTeamStatement(database, { id: teamId, name, actor: options.actorUserId, now }),
      ...replaceTaskTeamMembersStatements(database, { id: teamId, userIds: members, now }),
      audit(database, options, "tasks.team.created", teamId, { memberCount: members.length }),
    ]),
  };
}

export async function updateTaskTeam(
  database: SqlDatabase,
  teamId: TaskTeamId,
  input: { readonly name: string; readonly memberUserIds: readonly UserId[] },
  options: Organisation,
): Promise<{ effect: EffectWrite }> {
  const name = normalizeTaskTeamName(input.name);
  if (!(await readTaskTeams(database)).some((team) => team.id === teamId)) {
    throw new TaskValidationError("task-team-unknown", "that is not one of the firm's teams");
  }
  if (await liveTaskTeamNameTaken(database, name, teamId)) {
    throw new TaskValidationError("task-team-name-taken", "there is already a team with that name");
  }
  const members = await assertMembers(database, input.memberUserIds);
  const now = options.clock.now();
  return effectOf([
    renameTaskTeamStatement(database, { id: teamId, name, now }),
    ...replaceTaskTeamMembersStatements(database, { id: teamId, userIds: members, now }),
    audit(database, options, "tasks.team.updated", teamId, { memberCount: members.length }),
  ]);
}

export async function retireTaskTeam(
  database: SqlDatabase,
  teamId: TaskTeamId,
  options: Organisation,
): Promise<{ effect: EffectWrite }> {
  if (!(await readTaskTeams(database)).some((team) => team.id === teamId)) {
    throw new TaskValidationError("task-team-unknown", "that is not one of the firm's teams");
  }
  const now = options.clock.now();
  return effectOf([
    ...retireTaskTeamStatements(database, { id: teamId, now }),
    audit(database, options, "tasks.team.retired", teamId, {}),
  ]);
}

// ---- a task's assignees and watchers ----

/**
 * Replaces who a task is assigned to: members and teams, in order. Every person newly named (and
 * not the actor) is told, through the same assignment topic a single assignment raised.
 */
export async function setTaskAssignees(
  database: SqlDatabase,
  taskId: MatterTaskId,
  assignees: readonly TaskAssigneeInput[],
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  const people = [
    ...new Set(
      assignees.flatMap((assignee) => (assignee.userId === undefined ? [] : [assignee.userId])),
    ),
  ];
  const teams = [
    ...new Set(
      assignees.flatMap((assignee) => (assignee.teamId === undefined ? [] : [assignee.teamId])),
    ),
  ];
  if (people.length + teams.length > MAX_TASK_ASSIGNEES) {
    throw new TaskValidationError(
      "task-too-many-assignees",
      `a task is assigned to at most ${String(MAX_TASK_ASSIGNEES)} people and teams`,
    );
  }
  await assertAssignableAll(database, people, task.matter_id, options);
  if (teams.length > 0) {
    const live = new Set((await readTaskTeams(database)).map((team) => team.id));
    if (teams.some((team) => !live.has(team))) {
      throw new TaskValidationError("task-team-unknown", "that is not one of the firm's teams");
    }
  }
  const before = new Set(
    (await readTaskAssignees(database, [taskId])).flatMap((row) =>
      row.user_id === null ? [] : [row.user_id],
    ),
  );
  const now = options.clock.now();
  const ordered: (TaskAssigneeInput & { id: MatterTaskAssigneeId })[] = [
    ...people.map((userId) => ({
      userId,
      id: newIdentifier("matterTaskAssignee", options.randomSource),
    })),
    ...teams.map((teamId) => ({
      teamId,
      id: newIdentifier("matterTaskAssignee", options.randomSource),
    })),
  ];
  const told = people.filter((userId) => !before.has(userId) && userId !== options.actorUserId);
  return {
    effect: {
      statements: [
        ...replaceTaskAssigneesStatements(database, {
          taskId,
          assignees: ordered,
          actor: options.actorUserId,
          now,
        }),
        audit(database, options, "tasks.task.assigneesChanged", taskId, {
          matterId: task.matter_id,
          peopleCount: people.length,
          teamCount: teams.length,
        }),
      ],
      outboxMessages: told.map((assigneeUserId) => ({
        topic: assignmentTopicFor(task.matter_id, before.size > 0),
        payload: {
          taskId,
          matterId: task.matter_id,
          assigneeUserId,
          assignedByUserId: options.actorUserId,
          priority: task.priority,
          dueOn: task.due_on,
        },
      })),
    },
  };
}

async function assertAssignableAll(
  database: SqlDatabase,
  userIds: readonly UserId[],
  matterId: MatterId | null,
  options: TaskServiceOptions,
): Promise<void> {
  for (const userId of userIds) {
    const { memberExists, canSeeMatter } = await memberCanBeAssigned(
      database,
      userId,
      matterId,
      options.visibility,
    );
    if (!memberExists) {
      throw new TaskValidationError(
        "task-unknown-assignee",
        "that is not an active member of this firm",
      );
    }
    if (!canSeeMatter) {
      throw new TaskValidationError(
        "task-assignee-cannot-see-matter",
        "that member cannot see this matter, and a task they cannot open is a hole in their list",
      );
    }
  }
}

export async function setTaskWatchers(
  database: SqlDatabase,
  taskId: MatterTaskId,
  userIds: readonly UserId[],
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  const watchers = [...new Set(userIds)];
  if (watchers.length > MAX_TASK_WATCHERS) {
    throw new TaskValidationError(
      "task-too-many-watchers",
      `a task has at most ${String(MAX_TASK_WATCHERS)} watchers`,
    );
  }
  await assertAssignableAll(database, watchers, task.matter_id, options);
  const now = options.clock.now();
  return effectOf([
    ...replaceTaskWatchersStatements(database, {
      taskId,
      userIds: watchers,
      actor: options.actorUserId,
      now,
    }),
    audit(database, options, "tasks.task.watchersChanged", taskId, {
      matterId: task.matter_id,
      watcherCount: watchers.length,
    }),
  ]);
}

// ---- where a task stands, and which list it is on ----

// A move along the list's flow. Completing and reopening are separate and ignore the flow; a task
// that is archived does not move until it is back on the list.
export async function moveTaskToStatus(
  database: SqlDatabase,
  taskId: MatterTaskId,
  statusId: TaskListStatusId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  if (task.archived_at !== null) {
    throw new TaskValidationError(
      "task-already-archived",
      "that task is archived; put it back on the list before moving it",
    );
  }
  const { status } = await requireStatus(database, statusId);
  if (status.list_id !== task.list_id) {
    throw new TaskValidationError(
      "task-status-unknown",
      "that status is on a different list from this task",
    );
  }
  if (task.status_id === statusId) {
    throw new TaskValidationError("task-status-move-not-in-flow", "the task is already there");
  }
  if (task.status_id !== null && !(await transitionAllowed(database, task.status_id, statusId))) {
    throw new TaskValidationError(
      "task-status-move-not-in-flow",
      `this list's flow does not allow a move to ${status.name} from where the task stands`,
    );
  }
  const now = options.clock.now();
  return effectOf([
    setTaskStatusStatement(database, { taskId, statusId, now, actor: options.actorUserId }),
    audit(database, options, "tasks.task.statusChanged", taskId, {
      matterId: task.matter_id,
      fromStatusId: task.status_id,
      toStatusId: statusId,
    }),
  ]);
}

// Moving a task to another list puts it, and every sub-task under it, on that list's first status.
// A sub-task cannot move on its own: it shares its parent's list.
export async function moveTaskToList(
  database: SqlDatabase,
  taskId: MatterTaskId,
  listId: TaskListId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  if (task.parent_task_id !== null) {
    throw new TaskValidationError(
      "task-list-unknown",
      "a sub-task is on its parent's list; move the parent instead",
    );
  }
  await requireList(database, listId);
  const [firstStatus] = await readTaskListStatuses(database, [listId]);
  if (firstStatus === undefined) {
    throw new TaskValidationError("task-status-unknown", "that list has no status to land on");
  }
  const now = options.clock.now();
  return effectOf([
    moveSubtreeStatement(database, {
      rootId: taskId,
      listId,
      statusIdForMoved: firstStatus.id,
      matterId: task.matter_id,
      maxDepth: MAX_SUBTASK_DEPTH,
      now,
      actor: options.actorUserId,
    }),
    audit(database, options, "tasks.task.listChanged", taskId, {
      matterId: task.matter_id,
      fromListId: task.list_id,
      toListId: listId,
    }),
  ]);
}

// ---- a task's checklist and links ----

export async function addChecklistItem(
  database: SqlDatabase,
  taskId: MatterTaskId,
  input: { readonly text: string },
  options: TaskServiceOptions,
): Promise<{ itemId: MatterTaskChecklistItemId; effect: EffectWrite }> {
  const text = normalizeChecklistItemText(input.text);
  await requireVisibleTask(database, taskId, options);
  if (
    (await countRows(database, MATTER_TASK_CHECKLIST_ITEM_TABLE, taskId)) >=
    MAX_TASK_CHECKLIST_ITEMS
  ) {
    throw new TaskValidationError(
      "task-checklist-too-long",
      `a checklist holds at most ${String(MAX_TASK_CHECKLIST_ITEMS)} lines; a longer one is a set of sub-tasks`,
    );
  }
  const itemId = newIdentifier("matterTaskChecklistItem", options.randomSource);
  const now = options.clock.now();
  return {
    itemId,
    ...effectOf([
      insertChecklistItemStatement(database, { id: itemId, taskId, text, now }),
      touchTask(database, taskId, options.actorUserId, now),
      audit(database, options, "tasks.task.checklistChanged", taskId, { change: "added" }),
    ]),
  };
}

async function requireChecklistItem(
  database: SqlDatabase,
  itemId: MatterTaskChecklistItemId,
  options: TaskServiceOptions,
) {
  const item = await readChecklistItemTask(database, itemId);
  if (item === undefined) {
    throw new TaskValidationError("task-checklist-item-unknown", "that checklist line is gone");
  }
  // The line is reachable only through a task the reader can reach.
  await requireVisibleTask(database, item.task_id, options);
  return item;
}

export async function updateChecklistItem(
  database: SqlDatabase,
  itemId: MatterTaskChecklistItemId,
  input: { readonly text?: string; readonly done?: boolean },
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const item = await requireChecklistItem(database, itemId, options);
  const text = input.text === undefined ? item.text : normalizeChecklistItemText(input.text);
  const done = input.done ?? item.done_at !== null;
  const now = options.clock.now();
  return effectOf([
    updateChecklistItemStatement(database, {
      id: itemId,
      text,
      done,
      actor: options.actorUserId,
      now,
    }),
    touchTask(database, item.task_id, options.actorUserId, now),
    audit(database, options, "tasks.task.checklistChanged", item.task_id, {
      change: done ? "ticked" : "edited",
    }),
  ]);
}

export async function removeChecklistItem(
  database: SqlDatabase,
  itemId: MatterTaskChecklistItemId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const item = await requireChecklistItem(database, itemId, options);
  const now = options.clock.now();
  return effectOf([
    deleteChecklistItemStatement(database, itemId),
    touchTask(database, item.task_id, options.actorUserId, now),
    audit(database, options, "tasks.task.checklistChanged", item.task_id, { change: "removed" }),
  ]);
}

export async function addTaskLink(
  database: SqlDatabase,
  taskId: MatterTaskId,
  input: { readonly url: string; readonly label?: string | null },
  options: TaskServiceOptions,
): Promise<{ linkId: MatterTaskLinkId; effect: EffectWrite }> {
  const link = normalizeTaskLink(input.url, input.label);
  await requireVisibleTask(database, taskId, options);
  if ((await countRows(database, MATTER_TASK_LINK_TABLE, taskId)) >= MAX_TASK_LINKS) {
    throw new TaskValidationError(
      "task-too-many-links",
      `a task holds at most ${String(MAX_TASK_LINKS)} links`,
    );
  }
  const linkId = newIdentifier("matterTaskLink", options.randomSource);
  const now = options.clock.now();
  return {
    linkId,
    ...effectOf([
      insertTaskLinkStatement(database, {
        id: linkId,
        taskId,
        url: link.url,
        label: link.label,
        actor: options.actorUserId,
        now,
      }),
      touchTask(database, taskId, options.actorUserId, now),
      // The address itself stays on the row and out of the log, like every other free text here.
      audit(database, options, "tasks.task.linkAdded", taskId, { linkId }),
    ]),
  };
}

export async function removeTaskLink(
  database: SqlDatabase,
  linkId: MatterTaskLinkId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const taskId = await readTaskLinkTask(database, linkId);
  if (taskId === undefined) {
    throw new TaskValidationError("task-link-unknown", "that link is gone");
  }
  await requireVisibleTask(database, taskId, options);
  const now = options.clock.now();
  return effectOf([
    deleteTaskLinkStatement(database, linkId),
    touchTask(database, taskId, options.actorUserId, now),
    audit(database, options, "tasks.task.linkRemoved", taskId, { linkId }),
  ]);
}

// A change to a task's own rows is a change to the task, so it reaches the change feed a mirror reads.
function touchTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
  actor: UserId,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE matter_task SET updated_at = ?1, updated_by = ?2 WHERE id = ?3`)
    .bind(now, actor, taskId);
}
