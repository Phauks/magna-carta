import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import { clearActionItemTaskStatement } from "@magna-carta/meetings/summary-statements";
import type {
  FileId,
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  MatterTaskDocumentId,
  MatterTaskId,
  TaskListId,
  TaskListStatusId,
  TaskTeamId,
  UserId,
} from "@magna-carta/identifiers/types";
import { membersOfTeams, watcherNotice, watcherNoticeFor } from "./watcher-notices.ts";
import {
  blockingChainReaches,
  archiveMatterTaskStatement,
  clearBlockedByStatement,
  moveMatterTaskToRungStatement,
  countMatterTaskDocuments,
  deleteMatterTaskDocumentStatement,
  deleteMatterTaskDocumentsStatement,
  deleteMatterTaskStatement,
  fileIsOnMatter,
  insertMatterTaskDocumentStatement,
  insertMatterTaskStatement,
  memberCanBeAssigned,
  readMatterTask,
  readMatterTaskDocument,
  unarchiveMatterTaskStatement,
  updateMatterTaskStatement,
  isDescendantOf,
  subtreeHeight,
  taskDepth,
  type MatterTaskRow,
} from "./task-statements.ts";
import {
  deleteTaskOrganisationRowsStatements,
  readTaskListStatuses,
  readTaskLists,
  readTaskTeams,
  replaceTaskAssigneesStatements,
  replaceTaskWatchersStatements,
} from "./organisation-statements.ts";
import { assignmentTopicFor } from "./notifications.ts";
import {
  DEFAULT_TASK_PRIORITY,
  MAX_BLOCKING_CHAIN_DEPTH,
  MAX_SUBTASK_DEPTH,
  MAX_TASK_ASSIGNEES,
  MAX_TASK_DOCUMENT_COUNT,
  MAX_TASK_WATCHERS,
  NO_TASK_DUE,
  rungOf,
  type TaskPriority,
  type TaskRung,
} from "./types.ts";

// The rung in the words a refusal uses. Here rather than in the message, so "already done" and
// "already on hold" are one sentence with a word swapped rather than four sentences.
const TASK_RUNG_WORDS: Readonly<Record<TaskRung, string>> = Object.freeze({
  to_do: "to do",
  in_progress: "in progress",
  on_hold: "on hold",
  done: "done",
});
import {
  TaskValidationError,
  normalizeArchiveReason,
  normalizeTaskBody,
  normalizeTaskDue,
  normalizeTaskLocation,
  normalizeTaskPriority,
  normalizeTaskStart,
  normalizeTaskTitle,
} from "./validation.ts";
import { promoteSubtasksStatement } from "./subtask-statements.ts";
import { deleteTaskCommentsForTaskStatements } from "./comment-statements.ts";
import { nextCopyEffect } from "./recurrence-service.ts";
import {
  deleteExternalLinksForTaskStatement,
  insertTaskDeletionStatement,
} from "./sync-statements.ts";

// The task's write paths: create, edit, reassign, move along the rungs, archive, delete, and the two that
// attach and detach a file.
//
// Nothing here reads a clock, holds a database binding, or calls anything external: the clock, the
// actor and the random source arrive as options, which is what lets a fixture mint a byte-identical
// batch.
//
// NO DATE IS EVER DERIVED FROM ANOTHER DATE. There is no business-day arithmetic in this file, no
// holiday calendar, no service-method offset, and no recalculation when a linked event moves. A task
// stores the civil date somebody gave it and resolves it through the calendar's own resolver at read
// time. `trigger_event_id` and `deadline_id` are LINKS — the rule packages/calendar/CLAUDE.md states
// for matter_deadline, inherited verbatim: a link names what started the clock and is never an input
// to a calculation.

export interface TaskServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate the federated timeline composes. Every read on the way to a write goes
  // through it, so an id-addressed write path cannot reach a task a list read could not.
  readonly visibility: VisibleMatterPredicate;
}

export interface TaskDueInput {
  readonly dueOn?: string | null;
  readonly dueAtTime?: string | null;
  readonly timeZone?: string | null;
}

export interface CreateMatterTaskInput extends TaskDueInput {
  // Null is not an omission here: a task with no matter is firm work on no client file, and the
  // caller says so explicitly rather than leaving the field out.
  readonly matterId: MatterId | null;
  readonly title: string;
  readonly body?: string | null;
  readonly assigneeUserId?: UserId | null;
  readonly priority?: string | null;
  readonly blockedByTaskId?: MatterTaskId | null;
  readonly triggerEventId?: MatterEventId | null;
  readonly deadlineId?: MatterDeadlineId | null;
  // Which list, and where on it. Omitted, the firm's default list at its first status. A sub-task
  // takes its parent's list and matter whatever is passed here.
  readonly listId?: TaskListId | null;
  readonly statusId?: TaskListStatusId | null;
  readonly parentTaskId?: MatterTaskId | null;
  readonly startsOn?: string | null;
  readonly location?: string | null;
  // Every assignee, people and teams, in order. When present it replaces `assigneeUserId`; the first
  // person in it becomes the task's `assignee_user_id`.
  readonly assignees?: readonly (
    | { readonly userId: UserId; readonly teamId?: undefined }
    | { readonly teamId: TaskTeamId; readonly userId?: undefined }
  )[];
  readonly watcherUserIds?: readonly UserId[];
}

// Where a new task lands: its list, its status on that list, and — for a sub-task — the matter and
// list it inherits from its parent. Refused by name when a list or status is not the firm's.
async function placementFor(
  database: SqlDatabase,
  input: CreateMatterTaskInput,
  options: TaskServiceOptions,
): Promise<{
  matterId: MatterId | null;
  listId: TaskListId | null;
  statusId: TaskListStatusId | null;
  parentTaskId: MatterTaskId | null;
}> {
  if (input.parentTaskId !== undefined && input.parentTaskId !== null) {
    const parent = await readMatterTask(
      database,
      input.parentTaskId,
      options.visibility,
      options.actorUserId,
    );
    if (parent === undefined) {
      throw new TaskValidationError("task-parent-unknown", "that task is not a task in this firm");
    }
    if ((await taskDepth(database, parent.id, MAX_SUBTASK_DEPTH)) + 1 > MAX_SUBTASK_DEPTH) {
      throw new TaskValidationError(
        "task-parent-too-deep",
        `sub-tasks nest at most ${String(MAX_SUBTASK_DEPTH)} deep`,
      );
    }
    // A sub-task starts on its list's first status unless a status on that same list was named.
    const statuses =
      parent.list_id === null ? [] : await readTaskListStatuses(database, [parent.list_id]);
    const named = statuses.find((status) => status.id === input.statusId);
    return {
      matterId: parent.matter_id,
      listId: parent.list_id,
      statusId: named?.id ?? statuses[0]?.id ?? null,
      parentTaskId: parent.id,
    };
  }
  const listId = input.listId ?? null;
  if (listId !== null && !(await readTaskLists(database)).some((list) => list.id === listId)) {
    throw new TaskValidationError("task-list-unknown", "that is not one of the firm's task lists");
  }
  const statusId = input.statusId ?? null;
  if (statusId !== null) {
    const status = (await readTaskListStatuses(database)).find((row) => row.id === statusId);
    if (status === undefined || (listId !== null && status.list_id !== listId)) {
      throw new TaskValidationError("task-status-unknown", "that status is not on this list");
    }
    return { matterId: input.matterId, listId: status.list_id, statusId, parentTaskId: null };
  }
  return { matterId: input.matterId, listId, statusId: null, parentTaskId: null };
}

// Assigning to somebody, checked before anything is written. Returns nothing and throws on refusal,
// which is the shape every precondition in this file takes.
async function assertAssignable(
  database: SqlDatabase,
  assigneeUserId: UserId,
  matterId: MatterId | null,
  options: TaskServiceOptions,
): Promise<void> {
  const { memberExists, canSeeMatter } = await memberCanBeAssigned(
    database,
    assigneeUserId,
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

// The predecessor, if one was named. Refused when it is unreachable, on another matter, or when
// following its own chain comes back to this task.
async function assertPredecessor(
  database: SqlDatabase,
  predecessorId: MatterTaskId,
  matterId: MatterId | null,
  taskId: MatterTaskId | null,
  options: TaskServiceOptions,
): Promise<void> {
  const predecessor = await readMatterTask(
    database,
    predecessorId,
    options.visibility,
    options.actorUserId,
  );
  if (predecessor === undefined) {
    throw new TaskValidationError(
      "task-unknown-predecessor",
      "that task is not a task in this firm",
    );
  }
  // Same matter, and both-null counts as the same. A task blocked on another matter's task would be
  // an association across files that nothing on either surface could explain, and for a matterless
  // task it would be a private record pointing into a client's.
  if (predecessor.matter_id !== matterId) {
    throw new TaskValidationError(
      "task-predecessor-matter-mismatch",
      "a task waits only on a task on the same matter",
    );
  }
  // On create there is no task id yet, so no cycle is reachable: a task nothing points at cannot be
  // in one. On edit the walk starts at the proposed predecessor and looks for the task being edited.
  if (taskId !== null) {
    if (predecessorId === taskId) {
      throw new TaskValidationError("task-blocking-cycle", "a task cannot wait on itself");
    }
    if (await blockingChainReaches(database, predecessorId, taskId, MAX_BLOCKING_CHAIN_DEPTH)) {
      throw new TaskValidationError(
        "task-blocking-cycle",
        "that would make a loop: this task is already somewhere behind the one you named",
      );
    }
  }
}

export async function createMatterTask(
  database: SqlDatabase,
  input: CreateMatterTaskInput,
  options: TaskServiceOptions,
): Promise<{ taskId: MatterTaskId; effect: EffectWrite }> {
  const title = normalizeTaskTitle(input.title);
  const body = normalizeTaskBody(input.body);
  const due = normalizeTaskDue(input);
  const priority: TaskPriority = normalizeTaskPriority(input.priority) ?? DEFAULT_TASK_PRIORITY;
  const startsOn = normalizeTaskStart(input.startsOn, due.dueOn);
  const location = normalizeTaskLocation(input.location);
  const blockedByTaskId = input.blockedByTaskId ?? null;
  const placement = await placementFor(database, input, options);
  const matterId = placement.matterId;

  // The assignees: the list when given, otherwise the one person the older shape named.
  const assigneeList =
    input.assignees ??
    (input.assigneeUserId === undefined || input.assigneeUserId === null
      ? []
      : [{ userId: input.assigneeUserId }]);
  const people = [
    ...new Set(assigneeList.flatMap((entry) => (entry.userId === undefined ? [] : [entry.userId]))),
  ];
  const teams = [
    ...new Set(assigneeList.flatMap((entry) => (entry.teamId === undefined ? [] : [entry.teamId]))),
  ];
  if (people.length + teams.length > MAX_TASK_ASSIGNEES) {
    throw new TaskValidationError(
      "task-too-many-assignees",
      `a task is assigned to at most ${String(MAX_TASK_ASSIGNEES)} people and teams`,
    );
  }
  await Promise.all(people.map((userId) => assertAssignable(database, userId, matterId, options)));
  if (teams.length > 0) {
    const live = new Set((await readTaskTeams(database)).map((team) => team.id));
    if (teams.some((team) => !live.has(team))) {
      throw new TaskValidationError("task-team-unknown", "that is not one of the firm's teams");
    }
  }
  const watchers = [...new Set(input.watcherUserIds ?? [])];
  if (watchers.length > MAX_TASK_WATCHERS) {
    throw new TaskValidationError(
      "task-too-many-watchers",
      `a task has at most ${String(MAX_TASK_WATCHERS)} watchers`,
    );
  }
  await Promise.all(
    watchers.map((userId) => assertAssignable(database, userId, matterId, options)),
  );
  const assigneeUserId = people[0] ?? null;
  if (blockedByTaskId !== null) {
    await assertPredecessor(database, blockedByTaskId, matterId, null, options);
  }

  const told = [...new Set([...people, ...(await membersOfTeams(database, teams))])].filter(
    (userId) => userId !== options.actorUserId,
  );
  const now = options.clock.now();
  const taskId = newIdentifier("matterTask", options.randomSource);
  return {
    taskId,
    effect: {
      statements: [
        insertMatterTaskStatement(database, {
          id: taskId,
          matterId,
          title,
          body,
          assigneeUserId,
          createdBy: options.actorUserId,
          priority,
          due,
          blockedByTaskId,
          triggerEventId: input.triggerEventId ?? null,
          deadlineId: input.deadlineId ?? null,
          listId: placement.listId,
          statusId: placement.statusId,
          parentTaskId: placement.parentTaskId,
          startsOn,
          location,
          now,
        }),
        ...(people.length + teams.length === 0
          ? []
          : replaceTaskAssigneesStatements(database, {
              taskId,
              assignees: [
                ...people.map((userId) => ({
                  userId,
                  id: newIdentifier("matterTaskAssignee", options.randomSource),
                })),
                ...teams.map((teamId) => ({
                  teamId,
                  id: newIdentifier("matterTaskAssignee", options.randomSource),
                })),
              ],
              actor: options.actorUserId,
              now,
            })),
        ...(watchers.length === 0
          ? []
          : replaceTaskWatchersStatements(database, {
              taskId,
              userIds: watchers,
              actor: options.actorUserId,
              now,
            })),
        domainAuditStatement(database, {
          event: "tasks.task.created",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers, the priority and the due date only. Not the title and not the body: a task
          // title is free text on a matter ("Call Mrs. Herrera re the settlement offer") and the
          // audit log is a compliance record with its own retention and its own readers. A date and
          // a four-value enum disclose nothing on their own.
          metadata: {
            matterId,
            assigneeUserId,
            priority,
            dueOn: due.dueOn,
            parentTaskId: placement.parentTaskId,
          },
        }),
      ],
      // The outbox row IS the emission. The notification registry's rule is that a type SUBSCRIBES
      // and never produces, so there is no notify() call in this path — the durable row committed in
      // the same atomic batch as the task is what a subscriber reads.
      // Every person named, in person or through a team, except the one doing the naming; then
      // the watchers, told they are copied in.
      outboxMessages: [
        ...told.map((userId) => ({
          topic: assignmentTopicFor(matterId, false),
          payload: {
            taskId,
            matterId,
            assigneeUserId: userId,
            assignedByUserId: options.actorUserId,
            priority,
            dueOn: due.dueOn,
          },
        })),
        ...watcherNoticeFor(
          { id: taskId, matter_id: matterId, priority },
          "watching",
          options.actorUserId,
          watchers.filter((userId) => !told.includes(userId)),
        ),
      ],
    },
  };
}

export interface EditMatterTaskInput extends TaskDueInput {
  readonly title: string;
  readonly body?: string | null;
  readonly priority?: string | null;
  readonly blockedByTaskId?: MatterTaskId | null;
  readonly triggerEventId?: MatterEventId | null;
  readonly deadlineId?: MatterDeadlineId | null;
  // Left out, each keeps what the task has; null clears it. A caller that predates these fields
  // never clears them by accident.
  readonly startsOn?: string | null;
  readonly location?: string | null;
  // For a repeating task whose due date moves: `this` moves this copy only, and the next still falls
  // where the rule says; `later` moves the series with it, so later copies follow the new date.
  // Left out, it is `this`.
  readonly recurrenceScope?: "this" | "later";
}

// Editing a task in place. A task's value is that it says what to do NOW, so a correction overwrites
// rather than appending — the same call the calendar made for firm events, in its own words: "a firm
// made to record a compensating row to fix a typo stops recording."
//
// Assignment is deliberately NOT editable here. It is its own path with its own permission and its
// own topic, because putting work in somebody else's name is a different act from fixing a due date.
export async function editMatterTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
  input: EditMatterTaskInput,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const title = normalizeTaskTitle(input.title);
  const body = normalizeTaskBody(input.body);
  const due = normalizeTaskDue(input);
  const task = await requireVisibleTask(database, taskId, options);
  const priority: TaskPriority = normalizeTaskPriority(input.priority) ?? task.priority;
  const startsOn = normalizeTaskStart(
    input.startsOn === undefined ? task.starts_on : input.startsOn,
    due.dueOn,
  );
  const location =
    input.location === undefined ? task.location : normalizeTaskLocation(input.location);
  const blockedByTaskId = input.blockedByTaskId ?? null;
  if (blockedByTaskId !== null && blockedByTaskId !== task.blocked_by_task_id) {
    await assertPredecessor(database, blockedByTaskId, task.matter_id, taskId, options);
  }
  const repeats = task.recurrence_rule !== null;
  if (repeats && due.dueOn === null) {
    throw new TaskValidationError(
      "task-recurrence-needs-due-date",
      "a repeating task needs a due date; stop it repeating before taking the date off",
    );
  }
  const seriesMoves =
    repeats && due.dueOn !== task.due_on && (input.recurrenceScope ?? "this") === "later";
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        ...(seriesMoves
          ? [
              database
                .prepare(`UPDATE matter_task SET recurrence_occurrence_on = ?1 WHERE id = ?2`)
                .bind(due.dueOn, taskId),
            ]
          : []),
        updateMatterTaskStatement(database, {
          id: taskId,
          title,
          body,
          priority,
          due,
          blockedByTaskId,
          triggerEventId: input.triggerEventId ?? null,
          deadlineId: input.deadlineId ?? null,
          startsOn,
          location,
          now,
          actor: options.actorUserId,
        }),
        domainAuditStatement(database, {
          event: "tasks.task.edited",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: task.matter_id,
            priority,
            dueOn: due.dueOn,
            // Whether the date moved, which is the change other people care about, without the
            // previous value — the row no longer holds it and the log is not where it comes back.
            dueDateChanged: due.dueOn !== task.due_on,
          },
        }),
      ],
      // A moved due date is the edit a watcher needs to hear about; a reworded title is not.
      outboxMessages:
        due.dueOn === task.due_on
          ? []
          : await watcherNotice(database, task, "dueDateChanged", options.actorUserId),
    },
  };
}

// Reassignment, including to nobody. Moving a task OUT of somebody's name is the same act as moving
// it into another's and takes the same path, so a task cannot be quietly orphaned by an edit.
export async function reassignMatterTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
  assigneeUserId: UserId | null,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  if (assigneeUserId !== null) {
    await assertAssignable(database, assigneeUserId, task.matter_id, options);
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        // The single-assignee path replaces the whole set with the one person (or nobody), so the
        // assignee rows and the column never disagree.
        ...replaceTaskAssigneesStatements(database, {
          taskId,
          assignees:
            assigneeUserId === null
              ? []
              : [
                  {
                    userId: assigneeUserId,
                    id: newIdentifier("matterTaskAssignee", options.randomSource),
                  },
                ],
          actor: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "tasks.task.reassigned",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: task.matter_id,
            fromAssigneeUserId: task.assignee_user_id,
            toAssigneeUserId: assigneeUserId,
          },
        }),
      ],
      // Nobody is told they were assigned their own task, and nobody is told twice about a
      // reassignment that changed nothing.
      outboxMessages:
        assigneeUserId === null ||
        assigneeUserId === options.actorUserId ||
        assigneeUserId === task.assignee_user_id
          ? []
          : [
              {
                topic: assignmentTopicFor(task.matter_id, true),
                payload: {
                  taskId,
                  matterId: task.matter_id,
                  assigneeUserId,
                  assignedByUserId: options.actorUserId,
                  priority: task.priority,
                  dueOn: task.due_on,
                },
              },
            ],
    },
  };
}

/*
 * MOVING A TASK ALONG ITS RUNGS — one service for all four, because a reader pressing To Do and a
 * reader pressing Done are doing the same thing.
 *
 * The audit event still distinguishes them, because they are not the same fact about the matter: a
 * completion and a reopening are events a firm reads back, and moving between the three open rungs
 * is the ordinary traffic of working. So the move is one write and the log says which kind it was.
 *
 * An ARCHIVED task does not move. It is put away, and picking it back up is unarchiving it — a
 * surface that let somebody advance a task nobody can see would be writing into a list that is not
 * on screen.
 */
export async function moveMatterTaskToRung(
  database: SqlDatabase,
  taskId: MatterTaskId,
  rung: TaskRung,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  if (task.archived_at !== null) {
    throw new TaskValidationError(
      "task-already-archived",
      "that task is archived; put it back on the list before moving it",
    );
  }
  const was = rungOf({ state: task.state, progress: task.progress });
  if (was === rung) {
    throw new TaskValidationError(
      rung === "done" ? "task-not-open" : "task-not-done",
      `that task is already ${TASK_RUNG_WORDS[rung]}`,
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        moveMatterTaskToRungStatement(database, {
          id: taskId,
          rung,
          actor: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          // Completing and reopening keep the names they had: they are the two moves a firm reads
          // back years later, and a feed that renamed them would lose every task closed before this.
          event:
            rung === "done"
              ? "tasks.task.completed"
              : was === "done"
                ? "tasks.task.reopened"
                : "tasks.task.moved",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: task.matter_id,
            assigneeUserId: task.assignee_user_id,
            dueOn: task.due_on,
            fromRung: was,
            toRung: rung,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/*
 * PUTTING A TASK AWAY, AND KEEPING IT. Archiving and deleting are the two ways a task leaves a list
 * and they differ in exactly one thing: this keeps the data, a delete takes it.
 *
 * It replaced cancelling, which said the same thing and demanded a reason before it would say it.
 * The reason here is OPTIONAL — somebody clearing work that is simply not happening is not composing
 * a memo, and requiring a sentence is why the state it replaces went unused.
 *
 * The rung is untouched: a task is archived FROM where it stood, and unarchiving puts it back there.
 */
export async function archiveMatterTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
  reason: string | null,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const normalizedReason = normalizeArchiveReason(reason);
  const task = await requireVisibleTask(database, taskId, options);
  if (task.archived_at !== null) {
    throw new TaskValidationError("task-already-archived", "that task is already archived");
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        archiveMatterTaskStatement(database, {
          id: taskId,
          archivedBy: options.actorUserId,
          reason: normalizedReason,
          now,
        }),
        domainAuditStatement(database, {
          event: "tasks.task.archived",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The reason is on the ROW, where the surface reads it. It is deliberately not copied into
          // the audit metadata: the log carries identifiers and enums, and an archive reason is free
          // text a member typed about a matter.
          metadata: {
            matterId: task.matter_id,
            assigneeUserId: task.assignee_user_id,
            fromRung: rungOf({ state: task.state, progress: task.progress }),
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Back onto the list, on the rung it left from.
export async function unarchiveMatterTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  if (task.archived_at === null) {
    throw new TaskValidationError("task-not-archived", "that task is not archived");
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        unarchiveMatterTaskStatement(database, { id: taskId, now, actor: options.actorUserId }),
        domainAuditStatement(database, {
          event: "tasks.task.unarchived",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: task.matter_id,
            toRung: rungOf({ state: task.state, progress: task.progress }),
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Deleting a task. The row goes; the audit row carrying identifiers is what survives.
//
// This is NOT the same act as archiving and neither replaces the other. An archive puts the task
// away and keeps every word of it. A delete is for a task that should not exist: a typo, a
// duplicate, a line somebody started and abandoned before it meant anything. The owner made
// the same call for notes on 2026-09-01 and the reasoning carries: a record that can only ever
// accumulate is a record people stop keeping.
export async function deleteMatterTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        // Order matters and each statement is here for its own reason. The links go first because
        // they reference the row; they are the association and never the document, so every attached
        // file stays exactly where it lives in the matter's file record. Then any successor stops
        // waiting on a task that is about to stop existing — nothing in SQLite enforces the
        // self-reference, so a pointer left behind would dangle and render as blocked by a task
        // nobody can open.
        deleteMatterTaskDocumentsStatement(database, taskId),
        ...deleteTaskOrganisationRowsStatements(database, taskId),
        // The comment thread goes with the task: it was talk about this work, and a thread with no
        // task to open it from is talk nobody can find.
        ...deleteTaskCommentsForTaskStatements(database, taskId),
        clearBlockedByStatement(database, { taskId, now, actor: options.actorUserId }),
        // Its sub-tasks are not deleted with it: they move up to where it stood, so deleting a
        // parent never quietly takes work somebody else is doing.
        promoteSubtasksStatement(database, {
          taskId,
          newParentId: task.parent_task_id,
          now,
          actor: options.actorUserId,
        }),
        // The tombstone, in the SAME BATCH as the delete and never after it. A row that is gone
        // cannot be enumerated afterwards, so anything mirroring this task learns of the deletion
        // here or never — and a mirror that never learns keeps the work alive somewhere the firm
        // has stopped looking, which is worse than the stale row the delete was meant to remove.
        // It carries identifiers and nothing else: a tombstone preserving the title would defeat
        // the delete it records.
        insertTaskDeletionStatement(database, {
          id: newIdentifier("matterTaskDeletion", options.randomSource),
          taskId,
          matterId: task.matter_id,
          deletedBy: options.actorUserId,
          now,
        }),
        // The external links go with it, for the reason the document links above go: they reference
        // the row. A link left behind would point at a task nobody can open while still holding its
        // remote object's uniqueness slot, which would stop the firm ever linking that object to a
        // real task again.
        deleteExternalLinksForTaskStatement(database, taskId),
        // A meeting summary's action item made into this task names it, and that reference is
        // ENFORCED — left in place it would refuse this delete outright. The item is the meeting's
        // record and stays; it stops naming the task, and reads again as an undertaking nobody has made
        // a task of. Composed from the meetings package so this package keeps no SQL over a table it
        // does not own.
        clearActionItemTaskStatement(database, { taskId, now }),
        deleteMatterTaskStatement(database, taskId),
        domainAuditStatement(database, {
          event: "tasks.task.deleted",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: task.matter_id,
            assigneeUserId: task.assignee_user_id,
            state: task.state,
            createdAt: task.created_at,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Linking one of the matter's files to a task.
//
// A task with no matter points at no documents, and that is a consequence rather than a rule
// anybody invented: every row in `file` carries a NOT NULL matter_id, so there is no firm-wide file
// for a matterless task to point at. Refused with its own code rather than left to fail a join.
export async function attachFileToMatterTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
  fileId: FileId,
  options: TaskServiceOptions,
): Promise<{ linkId: MatterTaskDocumentId; effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  if (task.matter_id === null) {
    throw new TaskValidationError(
      "task-without-matter-has-no-files",
      "this task is not on a matter, and every document in this firm belongs to one",
    );
  }
  if (!(await fileIsOnMatter(database, fileId, task.matter_id))) {
    throw new TaskValidationError(
      "task-file-matter-mismatch",
      "a task points only at documents on its own matter",
    );
  }
  if ((await countMatterTaskDocuments(database, taskId)) >= MAX_TASK_DOCUMENT_COUNT) {
    throw new TaskValidationError(
      "task-too-many-files",
      `a task points at at most ${String(MAX_TASK_DOCUMENT_COUNT)} documents`,
    );
  }
  const now = options.clock.now();
  const linkId = newIdentifier("matterTaskDocument", options.randomSource);
  return {
    linkId,
    effect: {
      statements: [
        // A second identical link collides on the (task_id, file_id) unique index and aborts the
        // batch, which is the right outcome: one document rides one task once.
        insertMatterTaskDocumentStatement(database, {
          id: linkId,
          taskId,
          fileId,
          linkedBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "tasks.task.documentAttached",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: task.matter_id, fileId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Unlinking. The association ends; the document stays in the matter's files, untouched.
export async function detachFileFromMatterTask(
  database: SqlDatabase,
  linkId: MatterTaskDocumentId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const link = await readMatterTaskDocument(
    database,
    linkId,
    options.visibility,
    options.actorUserId,
  );
  if (link === undefined) {
    throw new TaskValidationError(
      "task-unknown-file",
      "that attachment is not on a task in this firm",
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        deleteMatterTaskDocumentStatement(database, linkId),
        domainAuditStatement(database, {
          event: "tasks.task.documentDetached",
          subjectId: link.task_id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { linkId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Every write path's first read, and the one place "that task is not a task in this firm" is
// phrased. The message never distinguishes a task that does not exist from one this member cannot
// reach, because the difference is itself information about the firm's matters.
export async function requireVisibleTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
  options: TaskServiceOptions,
): Promise<MatterTaskRow> {
  const task = await readMatterTask(database, taskId, options.visibility, options.actorUserId);
  if (task === undefined) {
    throw new TaskValidationError("task-unknown", "that task is not a task in this firm");
  }
  return task;
}

/*
 * COMPLETING AND REOPENING, separate from status. Completing works from any status and leaves the
 * status where it stood, so reopening puts the task back exactly there. The list's flow does not
 * apply: finishing the work is not a move along it.
 */
export async function setMatterTaskCompleted(
  database: SqlDatabase,
  taskId: MatterTaskId,
  completed: boolean,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const task = await requireVisibleTask(database, taskId, options);
  if (task.archived_at !== null) {
    throw new TaskValidationError(
      "task-already-archived",
      "that task is archived; put it back on the list first",
    );
  }
  if (completed === (task.state === "done")) {
    throw new TaskValidationError(
      completed ? "task-not-open" : "task-not-done",
      completed ? "that task is already complete" : "that task is not complete",
    );
  }
  const now = options.clock.now();
  const statement = completed
    ? database
        .prepare(
          `UPDATE matter_task SET state = 'done', completed_at = ?1, completed_by = ?2, ` +
            `updated_at = ?1, updated_by = ?2 WHERE id = ?3`,
        )
        .bind(now, options.actorUserId, taskId)
    : database
        .prepare(
          `UPDATE matter_task SET state = 'open', completed_at = NULL, completed_by = NULL, ` +
            `updated_at = ?1, updated_by = ?2 WHERE id = ?3`,
        )
        .bind(now, options.actorUserId, taskId);
  // A task that repeats on completion makes its next copy in the same batch, so the next round is
  // never missing because a completion landed and the copy did not. Reopening does not take the
  // copy back: by then it is somebody's work in its own right.
  const copy =
    completed && task.recurrence_mode === "completed" && task.recurrence_next_task_id === null
      ? await nextCopyEffect(database, task, options)
      : null;
  return {
    effect: {
      statements: [
        statement,
        ...(copy?.statements ?? []),
        domainAuditStatement(database, {
          event: completed ? "tasks.task.completed" : "tasks.task.reopened",
          subjectId: taskId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: task.matter_id,
            assigneeUserId: task.assignee_user_id,
            dueOn: task.due_on,
            statusId: task.status_id,
          },
        }),
      ],
      outboxMessages: [
        ...(await watcherNotice(
          database,
          task,
          completed ? "completed" : "reopened",
          options.actorUserId,
        )),
        ...(copy?.outboxMessages ?? []),
      ],
    },
  };
}

// Whether `parentId` may hold `taskId` as a sub-task without a loop or a tree deeper than allowed.
export async function assertSubtaskPlacement(
  database: SqlDatabase,
  taskId: MatterTaskId,
  parentId: MatterTaskId,
): Promise<void> {
  if (
    taskId === parentId ||
    (await isDescendantOf(database, parentId, taskId, MAX_SUBTASK_DEPTH))
  ) {
    throw new TaskValidationError("task-parent-cycle", "a task cannot sit under its own sub-task");
  }
  const depth =
    (await taskDepth(database, parentId, MAX_SUBTASK_DEPTH)) +
    1 +
    (await subtreeHeight(database, taskId, MAX_SUBTASK_DEPTH));
  if (depth > MAX_SUBTASK_DEPTH) {
    throw new TaskValidationError(
      "task-parent-too-deep",
      `sub-tasks nest at most ${String(MAX_SUBTASK_DEPTH)} deep`,
    );
  }
}

export { NO_TASK_DUE };
