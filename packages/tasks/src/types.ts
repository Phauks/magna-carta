// The task's vocabularies, ceilings and caps. Every closed vocabulary here is also a SQLite CHECK on
// the per-firm schema, so a value that reaches a write without appearing here fails at the database
// and not only at the type checker.

// A title's ceiling. A task title is a line somebody reads in a list, so it is short by design; a
// title that wants to be a paragraph is a body.
export const MAX_TASK_TITLE_LENGTH = 200;

// The body's ceiling. Generous — the body is where the instruction actually lives ("call Mrs.
// Herrera, the settlement offer is on the third page, do not agree to anything") — but bounded,
// because an unbounded text column on a hot list read is how one task makes a page unservable. A
// body over this is refused with a named code, never silently truncated.
export const MAX_TASK_BODY_LENGTH = 20_000;

// The reason a cancellation carries. Required and short: "we decided not to" is the whole content of
// the record, and a cancellation reason that is an essay belongs in the body.
export const MAX_CANCELLATION_REASON_LENGTH = 1_000;

// The most tasks one page may carry, and the most files one task may point at.
export const MAX_TASK_PAGE_SIZE = 50;
export const MAX_TASK_DOCUMENT_COUNT = 50;

// How far the blocking chain is walked before a write gives up. A cycle is refused at the write, and
// the walk that finds one has to stop somewhere: a chain longer than this is not a sequence anybody
// is managing by hand, and refusing it costs a firm nothing while an unbounded walk on a corrupted
// chain costs a request handler everything.
export const MAX_BLOCKING_CHAIN_DEPTH = 50;

export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
export const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

// Four values with an inherent order, so a list sorts by urgency without a join and a notification's
// facts can carry a value its reader knows. There is deliberately no `none`: `normal` IS the absence
// of a signal, and two ways to say that is how a filter ends up with a control nobody understands.
export const TASK_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"] as const);
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const DEFAULT_TASK_PRIORITY: TaskPriority = "normal";

// The rank each priority sorts at, highest first. Held here rather than in a SQL CASE expression
// repeated at each read: two orderings that disagree would put one task in two places depending on
// which list you were looking at.
export const TASK_PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = Object.freeze({
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
});

// Three values, and the third is not optional. Without `cancelled`, a task that should not have been
// created has only `done` — a lie about work — or deletion to reach for, and the firm loses the
// difference between "we did this" and "we decided not to".
//
// Deletion exists too, and the two are not redundant. A delete is for a task that should not exist:
// a typo, a duplicate, a line somebody started and abandoned before it meant anything. A
// cancellation is a decision about work, and it carries an actor, an instant and a reason because
// the decision is the record.
export const TASK_STATES = Object.freeze(["open", "done", "cancelled"] as const);
export type TaskState = (typeof TASK_STATES)[number];

// What a task says about when it is due. All three are optional TOGETHER — a task with no due date
// is ordinary, not a gap.
//
// The shape rules, held by the schema as well as by validation: a time needs a date, because an hour
// with no day is not a moment anybody can place; and a date needs a zone, because a task due
// "Friday" for somebody in Reno and somebody in Boston is due at two different moments and the row
// has to say which. This is the deadline's own column shape, and it is reached through the same
// resolver in packages/calendar/src/time-zone.ts rather than a second one.
export interface TaskDue {
  readonly dueOn: string | null;
  readonly dueAtTime: string | null;
  readonly timeZone: string | null;
}

export const NO_TASK_DUE: TaskDue = Object.freeze({
  dueOn: null,
  dueAtTime: null,
  timeZone: null,
});
