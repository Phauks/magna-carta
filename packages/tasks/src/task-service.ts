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
  UserId,
} from "@magna-carta/identifiers/types";
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
  reassignMatterTaskStatement,
  unarchiveMatterTaskStatement,
  updateMatterTaskStatement,
  type MatterTaskRow,
} from "./task-statements.ts";
import { assignmentTopicFor } from "./notifications.ts";
import {
  DEFAULT_TASK_PRIORITY,
  MAX_BLOCKING_CHAIN_DEPTH,
  MAX_TASK_DOCUMENT_COUNT,
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
  normalizeTaskPriority,
  normalizeTaskTitle,
} from "./validation.ts";
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
  const assigneeUserId = input.assigneeUserId ?? null;
  const blockedByTaskId = input.blockedByTaskId ?? null;

  if (assigneeUserId !== null) {
    await assertAssignable(database, assigneeUserId, input.matterId, options);
  }
  if (blockedByTaskId !== null) {
    await assertPredecessor(database, blockedByTaskId, input.matterId, null, options);
  }

  const now = options.clock.now();
  const taskId = newIdentifier("matterTask", options.randomSource);
  return {
    taskId,
    effect: {
      statements: [
        insertMatterTaskStatement(database, {
          id: taskId,
          matterId: input.matterId,
          title,
          body,
          assigneeUserId,
          createdBy: options.actorUserId,
          priority,
          due,
          blockedByTaskId,
          triggerEventId: input.triggerEventId ?? null,
          deadlineId: input.deadlineId ?? null,
          now,
        }),
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
            matterId: input.matterId,
            assigneeUserId,
            priority,
            dueOn: due.dueOn,
          },
        }),
      ],
      // The outbox row IS the emission. The notification registry's rule is that a type SUBSCRIBES
      // and never produces, so there is no notify() call in this path — the durable row committed in
      // the same atomic batch as the task is what a subscriber reads.
      outboxMessages:
        assigneeUserId === null || assigneeUserId === options.actorUserId
          ? []
          : [
              {
                topic: assignmentTopicFor(input.matterId, false),
                payload: {
                  taskId,
                  matterId: input.matterId,
                  assigneeUserId,
                  assignedByUserId: options.actorUserId,
                  priority,
                  dueOn: due.dueOn,
                },
              },
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
  const task = await requireTask(database, taskId, options);
  const priority: TaskPriority = normalizeTaskPriority(input.priority) ?? task.priority;
  const blockedByTaskId = input.blockedByTaskId ?? null;
  if (blockedByTaskId !== null && blockedByTaskId !== task.blocked_by_task_id) {
    await assertPredecessor(database, blockedByTaskId, task.matter_id, taskId, options);
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateMatterTaskStatement(database, {
          id: taskId,
          title,
          body,
          priority,
          due,
          blockedByTaskId,
          triggerEventId: input.triggerEventId ?? null,
          deadlineId: input.deadlineId ?? null,
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
      outboxMessages: [],
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
  const task = await requireTask(database, taskId, options);
  if (assigneeUserId !== null) {
    await assertAssignable(database, assigneeUserId, task.matter_id, options);
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        reassignMatterTaskStatement(database, {
          id: taskId,
          assigneeUserId,
          now,
          actor: options.actorUserId,
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
  const task = await requireTask(database, taskId, options);
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
  const task = await requireTask(database, taskId, options);
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
  const task = await requireTask(database, taskId, options);
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
  const task = await requireTask(database, taskId, options);
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
        clearBlockedByStatement(database, { taskId, now, actor: options.actorUserId }),
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
  const task = await requireTask(database, taskId, options);
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
async function requireTask(
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

export { NO_TASK_DUE };
