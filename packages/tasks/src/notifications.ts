// The emission points a task notification subscribes to.
//
// Nothing here schedules, resolves a recipient, or delivers anything. Notifications owns that
// decision and resolves recipients where it lives; the registry's own rule is that a type SUBSCRIBES
// and never produces, because the durable outbox row committed in the same atomic batch as the write
// IS the emission and a second row beside it would be a weaker copy of a guarantee that already
// holds.
//
// Tasks split cleanly into two shapes and only one of them is wirable today.

// ---- topic-shaped: a write happened, so there is a batch to ride ----

// A task was created with somebody else's name on it. Never raised when a member assigns themselves:
// telling somebody they gave themselves a task is noise that teaches people to ignore the bell.
export const TASK_ASSIGNED_TOPIC = "tasks.task.assigned";

// A task moved into somebody else's name. Never raised for a move to nobody (there is nobody to
// tell), to the actor themselves, or to the member who already held it.
export const TASK_REASSIGNED_TOPIC = "tasks.task.reassigned";

// THE SAME TWO ACTS ON A TASK THAT IS ON NO MATTER, and they are separate topics rather than the
// same one with a null field. This is the `calendar.firmEvent.*` split exactly, for the calendar's
// own reason: a notification's visibility is a join on its matter, so "behind the matter wall" and
// "not behind it" are two different kinds of row and the registry refuses to let one type be both.
// A type that claims a matter anchor must be able to resolve one, and a type that claims none must
// not resolve one — a firm-scoped row that quietly acquired a matter would fall behind a filter it
// must not be behind.
//
// The producer knows which it is holding, so the choice is made at the write where the answer is
// certain, rather than inferred downstream from a field that happened to be null.
export const FIRM_TASK_ASSIGNED_TOPIC = "tasks.firmTask.assigned";
export const FIRM_TASK_REASSIGNED_TOPIC = "tasks.firmTask.reassigned";

// What the two topics carry. IDENTIFIERS AND ENUMS ONLY — never the title and never the body. A
// message that crosses a queue and lands in a notification row outlives the access check that
// justified writing it, and a task title on a matter is routinely the client and the instruction
// ("Call Mrs. Herrera re the settlement offer"). The notification card is assembled at read time
// from the kind and a visibility-filtered matter join, which is how the rest of this platform does
// it and the reason no title needs to travel.
//
// `matterId` is nullable here for the same reason it is nullable on the row: a task on no matter is
// firm work, and the notification for one anchors to the firm rather than to a case.
export interface TaskAssignmentTopicPayload {
  readonly taskId: string;
  readonly matterId: string | null;
  readonly assigneeUserId: string;
  readonly assignedByUserId: string;
  readonly priority: string;
  readonly dueOn: string | null;
}

// ---- the people watching a task ----

// A watcher is copied in, the way a CC line is: they are told when the work moves without the work
// being theirs. One topic per side of the matter split, for the reason the assignment topics split.
// Raised only when somebody other than the actor is watching, and never to the actor.
export const WATCHED_TASK_CHANGED_TOPIC = "tasks.task.watchedChange";
export const FIRM_WATCHED_TASK_CHANGED_TOPIC = "tasks.firmTask.watchedChange";

// What moved, as a closed vocabulary the card turns into words. `watching` is the copy itself: the
// member was added to the watchers and is told so, which is what tells them to expect the rest.
export const WATCHED_TASK_CHANGES = Object.freeze([
  "watching",
  "completed",
  "reopened",
  "statusChanged",
  "assigneesChanged",
  "dueDateChanged",
] as const);
export type WatchedTaskChange = (typeof WATCHED_TASK_CHANGES)[number];

// Identifiers and enums only, on the assignment payload's reasoning. The watchers are named in the
// payload, as a meeting's invitees are, so the people told are the people watching at the write
// rather than whoever is watching when the queue drains.
export interface WatchedTaskChangePayload {
  readonly taskId: string;
  readonly matterId: string | null;
  readonly watcherUserIds: readonly string[];
  readonly changedByUserId: string;
  readonly change: WatchedTaskChange;
  readonly priority: string;
}

export function watchedChangeTopicFor(matterId: string | null): TaskOutboxTopic {
  return matterId === null ? FIRM_WATCHED_TASK_CHANGED_TOPIC : WATCHED_TASK_CHANGED_TOPIC;
}

// ---- comparison-shaped: no write to hang off, so declared and wired to nothing ----

// A task is due today, in its own zone. Not a topic and never will be: no write in this package or
// anywhere else makes a task become due, so there is no batch to ride. It is a comparison a sweep
// performs, and the name exists so the sweep and this package agree on one spelling.
export const TASK_DUE_SOON_EMISSION_POINT = "tasks.task.dueSoon";

// A task is past due — the same read-time comparison packages/calendar/src/overdue.ts makes, never a
// stored flag, because there is none and the schema has no place to put one.
export const TASK_OVERDUE_EMISSION_POINT = "tasks.task.overdue";

// Declared now because the write paths are being built now: adding a raise to a write under
// construction is one line, where finding every write path afterwards is archaeology. When the
// comparison sub-slice that sweeps deadlines lands, it sweeps tasks through the SAME mechanism
// against the SAME definition of overdue — the read-time comparison beside the deadlines, not a
// second one. Two definitions of "what is due" would eventually disagree, and the one people act on
// would be whichever they saw last.
export const TASK_NOTIFICATION_EMISSION_POINTS = Object.freeze([
  TASK_ASSIGNED_TOPIC,
  TASK_REASSIGNED_TOPIC,
  FIRM_TASK_ASSIGNED_TOPIC,
  FIRM_TASK_REASSIGNED_TOPIC,
  WATCHED_TASK_CHANGED_TOPIC,
  FIRM_WATCHED_TASK_CHANGED_TOPIC,
  TASK_DUE_SOON_EMISSION_POINT,
  TASK_OVERDUE_EMISSION_POINT,
] as const);

// The subset that is a real outbox topic today. Held separately from the declaration above so
// "which of these actually produces a row" is a compile-time answer rather than a grep.
export const TASK_OUTBOX_TOPICS = Object.freeze([
  TASK_ASSIGNED_TOPIC,
  TASK_REASSIGNED_TOPIC,
  FIRM_TASK_ASSIGNED_TOPIC,
  FIRM_TASK_REASSIGNED_TOPIC,
  WATCHED_TASK_CHANGED_TOPIC,
  FIRM_WATCHED_TASK_CHANGED_TOPIC,
] as const);

// Which topic an assignment raises, decided by the one fact that decides it. Exported so the write
// paths and any test agree by construction rather than by both remembering the rule.
export function assignmentTopicFor(
  matterId: string | null,
  reassignment: boolean,
): TaskOutboxTopic {
  if (matterId === null) {
    return reassignment ? FIRM_TASK_REASSIGNED_TOPIC : FIRM_TASK_ASSIGNED_TOPIC;
  }
  return reassignment ? TASK_REASSIGNED_TOPIC : TASK_ASSIGNED_TOPIC;
}

export type TaskOutboxTopic = (typeof TASK_OUTBOX_TOPICS)[number];

export type TaskNotificationEmissionPoint = (typeof TASK_NOTIFICATION_EMISSION_POINTS)[number];
