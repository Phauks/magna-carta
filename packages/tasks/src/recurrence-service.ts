/*
 * REPEATING TASKS: one current copy, and the next written when it is due to appear.
 *
 * A repeating task is never a year of rows. Only the copy somebody is working on exists; the next is
 * written when this one is completed, or on its own start date, whichever the firm chose for the
 * task. So a list never fills with copies nobody can act on yet, and changing the series means
 * changing one row.
 *
 * THE RULE IS READ FROM THIS COPY ONWARD. `recurrence_occurrence_on` is the day of the series this
 * copy stands for, and the rule's series starts there. A copy hands the next one the same rule with
 * any count one lower, so no copy ever walks back to where the series began, and the walk in
 * @magna-carta/civil-time never runs past its own bound however long the series has been going.
 *
 * NO DATE HERE IS DERIVED FROM A RULE OF LAW. The next due date is the next day the rule a person
 * chose falls on, walked by `occurrencesOf`, and the start date keeps the same number of calendar
 * days before it that this copy's had. Both are @magna-carta/civil-time's functions; nothing in this
 * file counts a day itself.
 */
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import { addCalendarDays, todayInUtc } from "@magna-carta/civil-time/civil-date";
import {
  MAX_INTERVAL,
  formatRecurrence,
  movedLikeOccurrence,
  occurrencesOf,
  parseRecurrence,
} from "@magna-carta/civil-time/recurrence";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterTaskId, TaskTeamId, UserId } from "@magna-carta/identifiers/types";
import { assignmentTopicFor } from "./notifications.ts";
import {
  insertChecklistItemStatement,
  insertTaskLinkStatement,
  readTaskAssignees,
  readTaskChecklistItems,
  readTaskLinks,
  readTaskTeams,
  readTaskWatchers,
  replaceTaskAssigneesStatements,
  replaceTaskWatchersStatements,
} from "./organisation-statements.ts";
import {
  MATTER_TASK_TABLE,
  TASK_COLUMNS,
  insertMatterTaskStatement,
  readMatterTask,
  type MatterTaskRow,
} from "./task-statements.ts";
import type { TaskServiceOptions } from "./task-service.ts";
import { TaskValidationError, normalizeTaskRecurrence } from "./validation.ts";
import { membersOfTeams } from "./watcher-notices.ts";

// How far ahead the next day of a series is looked for. The rarest rule the form offers is one
// every fifty-two years, and a monthly rule on the 31st skips the months without one; this reaches
// past both.
const LOOK_AHEAD_DAYS = 366 * MAX_INTERVAL + 62;

/** The next copy of a repeating task: its dates, the day of the series it is, and its own rule. */
export interface NextTaskCopy {
  readonly dueOn: string;
  readonly startsOn: string | null;
  readonly occurrenceOn: string;
  readonly rule: string;
}

/**
 * The copy that follows this one, or null where the series has ended (or the task does not repeat).
 * Pure: the clock, the database and the actor play no part in what the next copy is.
 */
export function nextCopyOf(
  task: Pick<
    MatterTaskRow,
    "recurrence_rule" | "recurrence_occurrence_on" | "due_on" | "starts_on"
  >,
): NextTaskCopy | null {
  const rule = parseRecurrence(task.recurrence_rule);
  const occurrence = task.recurrence_occurrence_on;
  if (rule === null || occurrence === null) return null;
  const following = occurrencesOf(rule, occurrence, {
    from: addCalendarDays(occurrence, 1),
    to: addCalendarDays(occurrence, LOOK_AHEAD_DAYS),
  })[0];
  if (following === undefined) return null;
  // A count says how many copies remain, this one included, so the next one has one fewer.
  const nextRule =
    rule.end.kind === "after"
      ? formatRecurrence({ ...rule, end: { kind: "after", count: rule.end.count - 1 } })
      : formatRecurrence(rule);
  return {
    dueOn: following,
    // The same number of days before its due date as this copy's start was before this one's.
    startsOn:
      task.starts_on === null
        ? null
        : movedLikeOccurrence(task.starts_on, task.due_on ?? occurrence, following),
    occurrenceOn: following,
    rule: nextRule,
  };
}

/** The day a copy appears on in `scheduled` mode: its start date, or its due date without one. */
export function appearsOn(copy: NextTaskCopy): string {
  return copy.startsOn ?? copy.dueOn;
}

export interface TaskCopyOptions {
  readonly clock: { now(): string };
  // Null when nobody did it: the hourly pass making a scheduled copy. The copy's own `created_by`
  // then names whoever made the copy before it, because a task always has somebody's name on it.
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

/**
 * The statements and notices that write a task's next copy, or null where its series has ended.
 *
 * The copy carries what to do, the detail, the list (at its first status), the priority, the
 * location, everyone assigned and watching, the checklist with every line unticked, and the links.
 * It does not carry sub-tasks, attached documents or time: those are records of THIS round of the
 * work, and copying them would say the next round had already been done.
 *
 * GUARDED. The first statement claims this copy's successor slot and is refused when another write
 * claimed it first, so a completion and the hourly pass meeting on the same task make one copy, not
 * two, and the whole batch is refused rather than half of it landing.
 */
export async function nextCopyEffect(
  database: SqlDatabase,
  task: MatterTaskRow,
  options: TaskCopyOptions,
): Promise<{
  copyId: MatterTaskId;
  statements: EffectStatement[];
  outboxMessages: OutboxMessage[];
} | null> {
  const next = nextCopyOf(task);
  if (next === null || task.recurrence_mode === null) return null;
  const [assignees, watchers, checklist, links, liveTeams] = await Promise.all([
    readTaskAssignees(database, [task.id]),
    readTaskWatchers(database, [task.id]),
    readTaskChecklistItems(database, [task.id]),
    readTaskLinks(database, [task.id]),
    readTaskTeams(database),
  ]);
  const live = new Set(liveTeams.map((team) => team.id));
  const kept = assignees.filter((row) => row.team_id === null || live.has(row.team_id));
  const people = kept.flatMap((row) => (row.user_id === null ? [] : [row.user_id]));
  const teams = kept.flatMap((row) => (row.team_id === null ? [] : [row.team_id as TaskTeamId]));
  const now = options.clock.now();
  const attributed = options.actorUserId ?? task.created_by;
  const copyId = newIdentifier("matterTask", options.randomSource);

  const statements: EffectStatement[] = [
    guarded(
      database
        .prepare(
          `UPDATE ${MATTER_TASK_TABLE} SET recurrence_next_task_id = ?1 ` +
            `WHERE id = ?2 AND recurrence_next_task_id IS NULL`,
        )
        .bind(copyId, task.id),
      "the next copy of this task has already been made",
    ),
    insertMatterTaskStatement(database, {
      id: copyId,
      matterId: task.matter_id,
      title: task.title,
      body: task.body,
      assigneeUserId: people[0] ?? null,
      createdBy: attributed,
      priority: task.priority,
      due: { dueOn: next.dueOn, dueAtTime: task.due_at_time, timeZone: task.time_zone },
      // Links to THIS round's event or deadline are not the next round's.
      blockedByTaskId: null,
      triggerEventId: null,
      deadlineId: null,
      listId: task.list_id,
      statusId: null,
      startsOn: next.startsOn,
      location: task.location,
      now,
    }),
    database
      .prepare(
        `UPDATE ${MATTER_TASK_TABLE} SET recurrence_rule = ?1, recurrence_mode = ?2, ` +
          `recurrence_occurrence_on = ?3 WHERE id = ?4`,
      )
      .bind(next.rule, task.recurrence_mode, next.occurrenceOn, copyId),
    ...(kept.length === 0
      ? []
      : replaceTaskAssigneesStatements(database, {
          taskId: copyId,
          assignees: kept.map((row) =>
            row.user_id === null
              ? {
                  teamId: row.team_id as TaskTeamId,
                  id: newIdentifier("matterTaskAssignee", options.randomSource),
                }
              : {
                  userId: row.user_id,
                  id: newIdentifier("matterTaskAssignee", options.randomSource),
                },
          ),
          actor: attributed,
          now,
        })),
    ...(watchers.length === 0
      ? []
      : replaceTaskWatchersStatements(database, {
          taskId: copyId,
          userIds: watchers.map((row) => row.user_id),
          actor: attributed,
          now,
        })),
    ...checklist.map((item) =>
      insertChecklistItemStatement(database, {
        id: newIdentifier("matterTaskChecklistItem", options.randomSource),
        taskId: copyId,
        text: item.text,
        now,
      }),
    ),
    ...links.map((link) =>
      insertTaskLinkStatement(database, {
        id: newIdentifier("matterTaskLink", options.randomSource),
        taskId: copyId,
        url: link.url,
        label: link.label,
        actor: attributed,
        now,
      }),
    ),
    domainAuditStatement(database, {
      event: "tasks.task.repeated",
      subjectId: copyId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: {
        matterId: task.matter_id,
        previousTaskId: task.id,
        dueOn: next.dueOn,
        mode: task.recurrence_mode,
      },
    }),
  ];

  // The next round is new work on somebody's plate, so the people it is assigned to are told, in
  // person or through a team, except whoever just finished the last round.
  const told = [...new Set([...people, ...(await membersOfTeams(database, teams))])].filter(
    (userId) => userId !== options.actorUserId,
  );
  const outboxMessages: OutboxMessage[] = told.map((userId) => ({
    topic: assignmentTopicFor(task.matter_id, false),
    payload: {
      taskId: copyId,
      matterId: task.matter_id,
      assigneeUserId: userId,
      assignedByUserId: attributed,
      priority: task.priority,
      dueOn: next.dueOn,
    },
  }));
  return { copyId, statements, outboxMessages };
}

export interface SetTaskRecurrenceInput {
  // The rule line, or null to stop the task repeating.
  readonly rule: string | null;
  readonly mode?: string | null;
}

/**
 * Setting, changing or removing how a task repeats. It applies from THIS copy on: a copy already
 * made from it keeps the rule it was made with.
 *
 * A repeat needs a due date, because the series falls on due dates; a sub-task cannot repeat on its
 * own, because its next copy would have no parent round to belong to. Setting a repeat on a task
 * that is already complete, to appear on completion, makes the next copy at once: the completion it
 * would have waited for has already happened.
 */
export async function setMatterTaskRecurrence(
  database: SqlDatabase,
  taskId: MatterTaskId,
  input: SetTaskRecurrenceInput,
  options: TaskServiceOptions,
): Promise<{ effect: { statements: EffectStatement[]; outboxMessages: OutboxMessage[] } }> {
  const task = await readMatterTask(database, taskId, options.visibility, options.actorUserId);
  if (task === undefined) {
    throw new TaskValidationError("task-unknown", "that task is not a task in this firm");
  }
  if (task.archived_at !== null) {
    throw new TaskValidationError(
      "task-already-archived",
      "that task is archived; put it back on the list first",
    );
  }
  const recurrence = normalizeTaskRecurrence(input.rule, input.mode);
  if (recurrence !== null && task.parent_task_id !== null) {
    throw new TaskValidationError(
      "task-recurrence-subtask",
      "a sub-task repeats with its parent; set the repeat on the parent task",
    );
  }
  if (recurrence !== null && task.due_on === null) {
    throw new TaskValidationError(
      "task-recurrence-needs-due-date",
      "a repeating task needs a due date to repeat from",
    );
  }
  // The same rule keeps the day of the series this copy stands for; a new rule starts the series
  // at this copy's due date.
  const occurrenceOn =
    recurrence === null
      ? null
      : recurrence.rule === task.recurrence_rule
        ? (task.recurrence_occurrence_on ?? task.due_on)
        : task.due_on;
  const now = options.clock.now();
  const statements: EffectStatement[] = [
    database
      .prepare(
        `UPDATE ${MATTER_TASK_TABLE} SET recurrence_rule = ?1, recurrence_mode = ?2, ` +
          `recurrence_occurrence_on = ?3, updated_at = ?4, updated_by = ?5 WHERE id = ?6`,
      )
      .bind(
        recurrence?.rule ?? null,
        recurrence?.mode ?? null,
        occurrenceOn,
        now,
        options.actorUserId,
        taskId,
      ),
    domainAuditStatement(database, {
      event: "tasks.task.recurrenceSet",
      subjectId: taskId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: {
        matterId: task.matter_id,
        repeats: recurrence !== null,
        mode: recurrence?.mode ?? null,
      },
    }),
  ];
  const outboxMessages: OutboxMessage[] = [];
  if (
    recurrence !== null &&
    recurrence.mode === "completed" &&
    task.state === "done" &&
    task.recurrence_next_task_id === null
  ) {
    const copy = await nextCopyEffect(
      database,
      {
        ...task,
        recurrence_rule: recurrence.rule,
        recurrence_mode: recurrence.mode,
        recurrence_occurrence_on: occurrenceOn,
      },
      options,
    );
    if (copy !== null) {
      statements.push(...copy.statements);
      outboxMessages.push(...copy.outboxMessages);
    }
  }
  return { effect: { statements, outboxMessages } };
}

// ---- the hourly pass ----

// How many repeating tasks one pass reads for one firm. Each series has one current copy, so this is
// a bound on series rather than on copies; a firm past it is caught up on the next pass.
export const RECURRING_TASK_PASS_LIMIT = 500;

/**
 * The repeating tasks whose next copy appears on its start date and does not exist yet. A SYSTEM
 * read: it is the pass deciding what to write, and no member sees its result.
 */
export async function readScheduledRepeatingTasks(
  database: SqlDatabase,
  limit = RECURRING_TASK_PASS_LIMIT,
): Promise<readonly MatterTaskRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM ${MATTER_TASK_TABLE} ` +
        `WHERE ${MATTER_TASK_TABLE}.recurrence_mode = 'scheduled' ` +
        `AND ${MATTER_TASK_TABLE}.recurrence_next_task_id IS NULL ` +
        `AND ${MATTER_TASK_TABLE}.archived_at IS NULL ` +
        `AND ${MATTER_TASK_TABLE}.parent_task_id IS NULL ` +
        `ORDER BY ${MATTER_TASK_TABLE}.recurrence_occurrence_on ASC, ${MATTER_TASK_TABLE}.id ASC ` +
        `LIMIT ?1`,
    )
    .bind(limit)
    .all<MatterTaskRow>();
  return results;
}

/** Today where the task is read: its own zone, or UTC for a task that has none. */
function todayFor(task: MatterTaskRow, now: string): string {
  return task.time_zone === null
    ? todayInUtc(Date.parse(now))
    : zonedReading(Date.parse(now), task.time_zone).civilDate;
}

/**
 * What one pass does with one firm's scheduled repeating tasks: each whose next copy's day has come
 * gets that copy, and each whose series has ended stops being read. Returns the effects to commit,
 * one per task, so one task refused (a race with a completion) never costs the others.
 */
export async function scheduledCopyEffects(
  database: SqlDatabase,
  tasks: readonly MatterTaskRow[],
  options: { clock: { now(): string }; randomSource?: RandomSource },
): Promise<{ statements: EffectStatement[]; outboxMessages: OutboxMessage[] }[]> {
  const now = options.clock.now();
  const effects: { statements: EffectStatement[]; outboxMessages: OutboxMessage[] }[] = [];
  for (const task of tasks) {
    const next = nextCopyOf(task);
    if (next === null) {
      // The series is over. The rule comes off this, its last copy, so the pass stops reading it;
      // the audit row keeps that it ended.
      effects.push({
        statements: [
          database
            .prepare(
              `UPDATE ${MATTER_TASK_TABLE} SET recurrence_rule = NULL, recurrence_mode = NULL, ` +
                `recurrence_occurrence_on = NULL WHERE id = ?1 AND recurrence_next_task_id IS NULL`,
            )
            .bind(task.id),
          domainAuditStatement(database, {
            event: "tasks.task.recurrenceEnded",
            subjectId: task.id,
            actorUserId: null,
            clock: options.clock,
            randomSource: options.randomSource,
            metadata: { matterId: task.matter_id },
          }),
        ],
        outboxMessages: [],
      });
      continue;
    }
    if (appearsOn(next) > todayFor(task, now)) continue;
    const copy = await nextCopyEffect(database, task, {
      clock: options.clock,
      actorUserId: null,
      randomSource: options.randomSource,
    });
    if (copy !== null) {
      effects.push({ statements: copy.statements, outboxMessages: copy.outboxMessages });
    }
  }
  return effects;
}
