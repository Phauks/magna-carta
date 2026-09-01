import {
  CIVIL_DATE_PATTERN,
  MAX_CANCELLATION_REASON_LENGTH,
  MAX_TASK_BODY_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  TASK_PRIORITIES,
  WALL_CLOCK_TIME_PATTERN,
  type TaskDue,
  type TaskPriority,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type TaskValidationCode =
  | "task-empty-title"
  | "task-title-too-long"
  | "task-body-too-long"
  | "task-unknown-priority"
  // The due-date shape refusals. Each names the one thing that is wrong rather than a generic
  // "invalid date", because each is fixed by the caller supplying a different field.
  | "task-invalid-date"
  | "task-invalid-time"
  | "task-time-without-date"
  | "task-date-without-zone"
  | "task-zone-without-date"
  | "task-unknown-time-zone"
  // A task this reader cannot reach, or one that is not on the matter the caller named. Kept
  // distinct because they are fixed differently, and neither ever reveals which by its message.
  | "task-unknown"
  | "task-matter-mismatch"
  // Assignment. Refused at the write rather than created and hidden: a task list with holes in it
  // that nobody can explain is worse than a refusal somebody can act on.
  | "task-unknown-assignee"
  | "task-assignee-cannot-see-matter"
  // State moves that do not apply to the state the task is in.
  | "task-not-open"
  | "task-not-done"
  | "task-already-cancelled"
  | "task-cancellation-reason-required"
  | "task-cancellation-reason-too-long"
  // Sequencing.
  | "task-unknown-predecessor"
  | "task-predecessor-matter-mismatch"
  | "task-blocking-cycle"
  // A file that is not a live file on this task's matter, or a task with no matter to have files on.
  | "task-unknown-file"
  | "task-file-matter-mismatch"
  | "task-without-matter-has-no-files"
  | "task-too-many-files";

export class TaskValidationError extends Error {
  constructor(
    readonly code: TaskValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskValidationError";
  }
}

function refuse(code: TaskValidationCode, message: string): never {
  throw new TaskValidationError(code, message);
}

// The title as it will be stored. Trimmed at the edges and never in the middle.
export function normalizeTaskTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length === 0) refuse("task-empty-title", "a task needs to say what to do");
  if (normalized.length > MAX_TASK_TITLE_LENGTH) {
    refuse(
      "task-title-too-long",
      `a task title is at most ${String(MAX_TASK_TITLE_LENGTH)} characters; this one is ${String(normalized.length)}. Longer instructions belong in the body`,
    );
  }
  return normalized;
}

// The body, which is optional. An empty body and an absent one are the same thing and both store
// NULL: a task carrying an empty string would render an empty section on every surface that checks
// for presence rather than content.
export function normalizeTaskBody(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  const normalized = body.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_TASK_BODY_LENGTH) {
    refuse(
      "task-body-too-long",
      `a task body is at most ${String(MAX_TASK_BODY_LENGTH)} characters; this one is ${String(normalized.length)}`,
    );
  }
  return normalized;
}

export function normalizeCancellationReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length === 0) {
    refuse(
      "task-cancellation-reason-required",
      "cancelling a task records why, because the decision is the record",
    );
  }
  if (normalized.length > MAX_CANCELLATION_REASON_LENGTH) {
    refuse(
      "task-cancellation-reason-too-long",
      `a cancellation reason is at most ${String(MAX_CANCELLATION_REASON_LENGTH)} characters; a longer explanation belongs in the task body`,
    );
  }
  return normalized;
}

export function normalizeTaskPriority(priority: string | null | undefined): TaskPriority | null {
  if (priority === null || priority === undefined) return null;
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    refuse(
      "task-unknown-priority",
      `${priority} is not a priority; the four are ${TASK_PRIORITIES.join(", ")}`,
    );
  }
  return priority as TaskPriority;
}

// Whether a runtime can resolve a zone. Validated at the WRITE and never at the read, for the reason
// the calendar states: a row whose zone nothing can resolve is a record nobody can display and
// nobody can correct without a migration.
function isResolvableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The due date as it will be stored, with the three-way coherence checked once here rather than at
// each call site.
//
// NOTHING IS INFERRED. This never invents a midnight, never fills a zone the caller did not give,
// and never defaults a date to today. It also performs no arithmetic of any kind: there is no
// business-day rule here, no holiday calendar, no service-method offset, and no derivation of one
// date from another. That is the calendar package's stated invariant and this package inherits it —
// a computed date that is wrong gets trusted precisely because it was computed.
export function normalizeTaskDue(input: {
  readonly dueOn?: string | null;
  readonly dueAtTime?: string | null;
  readonly timeZone?: string | null;
}): TaskDue {
  const dueOn = input.dueOn ?? null;
  const dueAtTime = input.dueAtTime ?? null;
  const timeZone = input.timeZone ?? null;

  if (dueOn !== null) {
    if (!CIVIL_DATE_PATTERN.test(dueOn)) {
      refuse("task-invalid-date", "a due date must be a civil date of the form YYYY-MM-DD");
    }
    // The pattern alone accepts 2026-02-30. A round trip through the calendar catches a rollover.
    const [year, month, day] = dueOn.split("-").map(Number) as [number, number, number];
    const roundTrip = new Date(Date.UTC(year, month - 1, day));
    if (
      roundTrip.getUTCFullYear() !== year ||
      roundTrip.getUTCMonth() !== month - 1 ||
      roundTrip.getUTCDate() !== day
    ) {
      refuse("task-invalid-date", `${dueOn} is not a date on the calendar`);
    }
    if (timeZone === null) {
      refuse(
        "task-date-without-zone",
        'a task due "Friday" is due at two different moments in Reno and Boston; give the zone the date is read in',
      );
    }
  }

  if (dueAtTime !== null) {
    if (!WALL_CLOCK_TIME_PATTERN.test(dueAtTime)) {
      refuse("task-invalid-time", "a due time must be a wall-clock time of the form HH:MM");
    }
    if (dueOn === null) {
      refuse(
        "task-time-without-date",
        "an hour with no day is not a moment anybody can place; give the due date as well",
      );
    }
  }

  if (timeZone !== null) {
    if (dueOn === null) {
      refuse(
        "task-zone-without-date",
        "a time zone on a task with no due date says nothing; give the date or drop the zone",
      );
    }
    if (!isResolvableTimeZone(timeZone)) {
      refuse("task-unknown-time-zone", `${timeZone} is not a time zone this platform can resolve`);
    }
  }

  return { dueOn, dueAtTime, timeZone };
}
