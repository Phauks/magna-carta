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

// The reason an archiving may carry. OPTIONAL, which is the difference from the cancellation it
// replaces: that reason was required, and requiring it is why nobody used the state. Short, for the
// reason it always was — a sentence about why this is not happening, not an essay, which belongs in
// the body.
export const MAX_ARCHIVE_REASON_LENGTH = 1_000;

// The most tasks one page may carry, and the most files one task may point at.
export const MAX_TASK_PAGE_SIZE = 50;
export const MAX_TASK_DOCUMENT_COUNT = 50;

// How far the blocking chain is walked before a write gives up. A cycle is refused at the write, and
// the walk that finds one has to stop somewhere: a chain longer than this is not a sequence anybody
// is managing by hand, and refusing it costs a firm nothing while an unbounded walk on a corrupted
// chain costs a request handler everything.
export const MAX_BLOCKING_CHAIN_DEPTH = 50;

// The civil-date and wall-clock shapes are @magna-carta/civil-time's, not restated here. Import
// them from there: a local copy is a shape that can be loosened on its own.

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

// WHETHER THE WORK IS FINISHED, and nothing else. `cancelled` is retired — it is still legal at the
// database, because removing a value from a CHECK costs a table rebuild that matter_task cannot
// take, and it is never written again. Nothing in the product produces it and the migration emptied
// the last rows that held it.
export const TASK_STATES = Object.freeze(["open", "done", "cancelled"] as const);
export type TaskState = (typeof TASK_STATES)[number];

// The live half of the column above: the only two values a write may produce.
export const WRITABLE_TASK_STATES = Object.freeze(["open", "done"] as const);

// WHERE AN OPEN TASK STANDS. Three rungs, in the order somebody moves a task along them, and the
// fourth rung a reader sees — Done — is the state above rather than a value here.
//
// The split is the platform's and it is stated where it costs something: `done` carries a completion
// actor and instant that the database pairs with `state` by CHECK, and widening that CHECK is the
// table rebuild matter_task cannot take (packages/database/src/per-firm-schema.ts says why, and
// apps/api-worker/test/durable-object-pragma-context.test.ts proves it). So the reader's one
// vocabulary is assembled from two columns, in exactly one place — `rungOf` below — and nowhere
// else in this package or above it decides what rung a task is on.
export const TASK_PROGRESS = Object.freeze(["to_do", "in_progress", "on_hold"] as const);
export type TaskProgress = (typeof TASK_PROGRESS)[number];
export const DEFAULT_TASK_PROGRESS: TaskProgress = "to_do";

// WHEN A REPEATING TASK'S NEXT COPY APPEARS. `completed`: when this one is marked complete, so the
// work never doubles up. `scheduled`: on the next copy's own start date (its due date when it has
// none), whether or not this one is done, because some work is owed on the day however the last
// round went. The firm chooses per task; `completed` is what a new repeat starts on.
export const TASK_RECURRENCE_MODES = Object.freeze(["completed", "scheduled"] as const);
export type TaskRecurrenceMode = (typeof TASK_RECURRENCE_MODES)[number];
export const DEFAULT_TASK_RECURRENCE_MODE: TaskRecurrenceMode = "completed";

// The four rungs as the reader has them, which is what an API takes and returns.
export const TASK_RUNGS = Object.freeze(["to_do", "in_progress", "on_hold", "done"] as const);
export type TaskRung = (typeof TASK_RUNGS)[number];

/** The rung a task is on, from the two columns that hold it between them. */
export function rungOf(task: { state: TaskState; progress: TaskProgress }): TaskRung {
  return task.state === "done" ? "done" : task.progress;
}

/**
 * What moving a task to a rung writes.
 *
 * Moving OFF done does not choose a rung — it restores the one the task was left on, which is what
 * somebody who ticked the wrong row means by putting it back. So `progress` is only written when the
 * rung names one, and completing a task leaves it where it stood.
 */
export function columnsForRung(rung: TaskRung): {
  state: "open" | "done";
  progress: TaskProgress | null;
} {
  return rung === "done" ? { state: "done", progress: null } : { state: "open", progress: rung };
}

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

// ---- the matter plan ----

// A plan's name and the description beside it, as a firm reads them in a settings list.
export const MAX_PLAN_NAME_LENGTH = 120;
export const MAX_PLAN_DESCRIPTION_LENGTH = 2_000;

// The most task templates one plan may carry. A ceiling rather than a rule anybody will meet: a plan
// is a firm's account of how a matter runs, and one with two hundred steps is a document rather than
// a checklist. It also bounds what one acceptance writes in a single batch.
export const MAX_PLAN_TASK_TEMPLATES = 100;

// The most plans one firm may hold, and the most a proposal read returns.
export const MAX_PLAN_TEMPLATE_PAGE_SIZE = 50;

// How far a template's blocking chain is walked before authoring gives up. Same reasoning as the
// task chain: a cycle is refused where the graph is small and static, and the walk stops somewhere.
export const MAX_TEMPLATE_CHAIN_DEPTH = 50;

// The furthest a plan may push a task from its anchor, either direction. Five years is far past any
// honest plan step and well short of the range where plain calendar-day addition starts producing
// dates nobody meant; a template offering "+36500" is a typo, not a schedule.
export const MAX_PLAN_OFFSET_DAYS = 1_825;

// WHAT A PLAN'S DUE DATE HANGS OFF, and the vocabulary is deliberately almost empty.
//
// `matter_opened` is a fact the matter row already carries. `none` proposes no date at all, which is
// the ordinary case for a step whose timing depends on something the firm has not recorded yet.
//
// There is no `service_date`, no `filing_date` and no trigger-event anchor, because each of those is
// the FRONT HALF OF A DOCKETING RULE and adding one invites the back half — the engine
// packages/calendar has spent a subsystem refusing to build, on the reasoning that a computed
// deadline which is wrong gets trusted precisely because it was computed. Growing this list is a
// reviewed decision with the calendar's stated position on the other side of it, and the schema holds
// it as a CHECK so growing it is a migration rather than a commit.
export const PLAN_DUE_ANCHORS = Object.freeze(["matter_opened", "none"] as const);
export type PlanDueAnchor = (typeof PLAN_DUE_ANCHORS)[number];
export const DEFAULT_PLAN_DUE_ANCHOR: PlanDueAnchor = "none";

// ---- lists, statuses, teams, and what a task carries besides its words ----

// The colours a status may wear. A CLOSED vocabulary and a CHECK on the schema: the web side maps
// each one onto design tokens, so a firm picks a colour without picking a value the design system
// never reviewed.
export const TASK_STATUS_COLOURS = Object.freeze([
  "gray",
  "blue",
  "orange",
  "amber",
  "green",
  "purple",
  "red",
] as const);
export type TaskStatusColour = (typeof TASK_STATUS_COLOURS)[number];

// A list's and a team's name, as a reader sees it in a menu: short by design.
export const MAX_TASK_LIST_NAME_LENGTH = 80;
export const MAX_TASK_STATUS_NAME_LENGTH = 40;
export const MAX_TASK_TEAM_NAME_LENGTH = 80;

// How many statuses one list may hold. A flow with more than this is a process map, not a list.
export const MAX_TASK_LIST_STATUSES = 20;
// How many lists and teams a firm may keep live, and how many members one team may hold.
export const MAX_TASK_LISTS = 100;
export const MAX_TASK_TEAMS = 100;
export const MAX_TASK_TEAM_MEMBERS = 200;

// How many assignees and watchers one task may name.
export const MAX_TASK_ASSIGNEES = 20;
export const MAX_TASK_WATCHERS = 50;

// How deep sub-tasks may nest under a top-level task. Deep enough for "the motion, the brief, the
// exhibit list, the one exhibit nobody can find"; a deeper tree is a project plan, and bounding it
// keeps every walk of the tree short.
export const MAX_SUBTASK_DEPTH = 5;

// A checklist and the links on one task, and their lines.
export const MAX_TASK_CHECKLIST_ITEMS = 100;
export const MAX_TASK_CHECKLIST_ITEM_LENGTH = 500;
export const MAX_TASK_LINKS = 50;
export const MAX_TASK_LINK_URL_LENGTH = 2_048;
export const MAX_TASK_LINK_LABEL_LENGTH = 200;

// Where the work happens: a room, an address, a meeting link.
export const MAX_TASK_LOCATION_LENGTH = 500;

// The list every firm starts with, created by the migration that introduced lists. Named here so a
// test or a fixture can address it without guessing.
export const DEFAULT_TASK_LIST_ID = "taskList_firmDefaultList000";
