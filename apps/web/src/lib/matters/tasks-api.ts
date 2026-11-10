/*
 * The Tasks surface's response shapes and calls. Mirrors the `tasks.*` operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * One record serves two screens. A task may sit on a matter or on none — renewing the malpractice
 * policy is real firm work on no client file — so the matter's Tasks section and the member's own
 * work list read the same shape through two routes, and neither knows the other exists.
 *
 * OVERDUE IS NOT A FIELD, here or on the wire. It is a comparison against now, made where the task
 * is read, because a stored flag is stale in exactly the window where it matters. `isOverdue` below
 * is that comparison and nothing is persisted from it.
 */
import { viewerTimeZone as readerTimeZone, zonedReading } from "@magna-carta/civil-time/time-zone";
import type { PaletteColorName } from "@magna-carta/design-system/palette";
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

/** One of the matter's documents, pointed at by a task. */
export interface TaskDocument {
  /** The ASSOCIATION's own identity, which is what detaching names. Not the document's. */
  id: string;
  fileId: string;
  /** As the File Manager names it, extension included. */
  fileName: string;
  contentType: string | null;
  linkedAt: string;
  linkedBy: string | null;
}

export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/*
 * WHERE A TASK STANDS: four rungs, in the order somebody moves a task along them.
 *
 * The server holds them in two columns for a reason that is the platform's rather than the model's,
 * and nothing on this side ever sees that — the wire carries one `rung` and this is it.
 */
export const TASK_RUNGS = ["to_do", "in_progress", "on_hold", "done"] as const;
export type TaskRung = (typeof TASK_RUNGS)[number];

/** The three rungs that mean the work is still owed. */
export const OPEN_RUNGS = ["to_do", "in_progress", "on_hold"] as const;

export interface MatterTask {
  id: string;
  /** Null on a task that belongs to no client file. */
  matterId: string | null;
  title: string;
  body: string | null;
  /** Null on a task nobody has picked up, which is a real state rather than a defect. */
  assigneeUserId: string | null;
  createdBy: string;
  priority: TaskPriority;
  /** A civil date. Null on a task nobody has scheduled, which is the ordinary case. */
  dueOn: string | null;
  dueAtTime: string | null;
  /** Required whenever there is a date: "Friday" falls at two moments in Reno and Boston. */
  timeZone: string | null;
  rung: TaskRung;
  completedAt: string | null;
  completedBy: string | null;
  /**
   * PUT AWAY, KEPT. Archiving and deleting are the two ways a task leaves a list, and they differ in
   * one thing: this keeps the data. Orthogonal to the rung — a task is archived from wherever it
   * stood, and putting it back returns it there.
   */
  archivedAt: string | null;
  archivedBy: string | null;
  /** Optional, and usually absent. Not everything put away has a sentence said about it. */
  archiveReason: string | null;
  /** The one task this waits on. It GATES NOTHING — a blocked task may still be completed. */
  blockedByTaskId: string | null;
  triggerEventId: string | null;
  deadlineId: string | null;
  documents: TaskDocument[];
  /**
   * Which of the firm's lists the task is on, and where it stands on that list's own statuses. The
   * status says where the work stands; whether it is FINISHED is `completedAt`, kept apart so that
   * finishing a task leaves its status where it stood.
   */
  listId: string | null;
  statusId: string | null;
  /** The task this one is a sub-task of. A sub-task shares its parent's list and matter. */
  parentTaskId: string | null;
  startsOn: string | null;
  /** Where the work happens: a room, an address, or a meeting link. */
  location: string | null;
  /**
   * How the task repeats, where it does. Only the current copy exists; the next is made when this
   * one is completed, or on the next copy's own start date, as `mode` says. `nextTaskId` is the copy
   * made from this one, once there is one.
   */
  recurrence: TaskRecurrence | null;
  /** Everyone the work is assigned to, people and teams, in the order they were named. */
  assignees: TaskAssignee[];
  /** People kept informed of the work without doing it. */
  watcherUserIds: string[];
  checklist: TaskChecklistItem[];
  links: TaskLink[];
  /**
   * How long this task has actually taken, from the time entries that name it.
   *
   * MINUTES, NEVER MONEY — what a task cost is a billing question with a different audience. The
   * scope travels with the numbers because they mean two different things: `firm` is what the task
   * cost the firm, `own` is what this member put into it, and a member without `time:viewFirm` only
   * ever gets the second. Rendering the totals without saying which would state something the
   * screen cannot support.
   */
  timeLogged: TaskTimeLogged;
  /**
   * Where else this task is written down. Empty on nearly every task: Magna Carta integrates with
   * nothing on its own, so a link exists only because an addon put it there.
   */
  externalLinks: TaskExternalLink[];
  createdAt: string;
  updatedAt: string;
  /**
   * Who touched it last. Null on a task nothing has edited since it was written. It is here for the
   * mirrors: a system syncing both ways reads it to tell its own writes from a person's.
   */
  updatedBy: string | null;
}

/** One assignee: a person or a team, never both. */
export interface TaskAssignee {
  id: string;
  userId: string | null;
  teamId: string | null;
}

export interface TaskChecklistItem {
  id: string;
  text: string;
  doneAt: string | null;
  doneBy: string | null;
}

export interface TaskLink {
  id: string;
  url: string;
  label: string | null;
}

/** The seven colours a status can carry, as the server names them. */
export const TASK_STATUS_COLOURS = [
  "gray",
  "blue",
  "orange",
  "amber",
  "green",
  "purple",
  "red",
] as const;
export type TaskStatusColour = (typeof TASK_STATUS_COLOURS)[number];

export interface TaskListStatus {
  id: string;
  name: string;
  colour: TaskStatusColour;
  position: number;
  /** The statuses a task on this one may move to. */
  nextStatusIds: string[];
}

export interface TaskListSummary {
  id: string;
  name: string;
  isDefault: boolean;
  openCount: number;
  statuses: TaskListStatus[];
}

export interface TaskTeam {
  id: string;
  name: string;
  memberUserIds: string[];
}

export interface TaskExternalLink {
  id: string;
  /** The outside system, lower-cased at the write — "clickup", "asana". Never a fixed list. */
  system: string;
  externalId: string;
  /** Where a person goes to see it over there. Null where the system has no addressable page. */
  externalUrl: string | null;
  remoteRevision: string | null;
  lastSyncedAt: string | null;
}

/**
 * A system's name as a person should read it.
 *
 * Stored lower-cased so the uniqueness rules hold however it was spelled, which makes it the
 * platform's job to put a capital back. Deliberately a plain title-case rather than a lookup table
 * of known vendors: the whole point of the seam is that a system nobody anticipated can appear, and
 * a table would render exactly those as the raw handle.
 */
export function externalSystemLabel(system: string): string {
  return system.length === 0 ? system : system.charAt(0).toUpperCase() + system.slice(1);
}

export interface TaskTimeLogged {
  billableMinutes: number;
  nonBillableMinutes: number;
  entryCount: number;
  scope: "firm" | "own";
}

/**
 * The time on a task as one line, or null where there is none to show.
 *
 * Most tasks carry no time at all, and a row that printed "0m" on every one of them would be
 * noise standing in for a fact nobody recorded. So the absence renders as nothing.
 */
export function describeTimeLogged(timeLogged: TaskTimeLogged): string | null {
  const total = timeLogged.billableMinutes + timeLogged.nonBillableMinutes;
  if (total === 0) return null;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const clock = hours === 0 ? `${String(minutes)}m` : `${String(hours)}h ${String(minutes)}m`;
  return timeLogged.scope === "own" ? `${clock} by you` : clock;
}

/** What a caller may say about when a task is due. All three travel together or not at all. */
export interface TaskDueInput {
  dueOn?: string | null;
  dueAtTime?: string | null;
  timeZone?: string | null;
}

/**
 * The task's content, as an edit REPLACES it. Every field a caller wants kept has to travel: an
 * omitted link is a cleared link rather than an unchanged one, which is what makes an edit form that
 * does not offer the link fields responsible for carrying them through.
 */
/** When a repeating task's next copy appears. */
export type TaskRecurrenceMode = "completed" | "scheduled";

export interface TaskRecurrence {
  /** The rule in RFC 5545's grammar, as `@magna-carta/civil-time/recurrence` writes it. */
  rule: string;
  mode: TaskRecurrenceMode;
  /** The day of the series this copy stands for. */
  occurrenceOn: string;
  nextTaskId: string | null;
}

export interface TaskContentInput extends TaskDueInput {
  title: string;
  /**
   * For a repeating task whose due date moves: `this` moves this copy only, `later` moves the
   * series with it. Left out, it is `this`.
   */
  recurrenceScope?: "this" | "later";
  /** Left out, the task keeps what it has; null clears it. */
  startsOn?: string | null;
  location?: string | null;
  body?: string | null;
  priority?: TaskPriority | null;
  blockedByTaskId?: string | null;
  triggerEventId?: string | null;
  deadlineId?: string | null;
}

export interface TaskListFilters {
  rungs?: readonly TaskRung[];
  includeArchived?: boolean;
  priorities?: readonly TaskPriority[];
  assigneeUserId?: string;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  includeClosedMatters?: boolean;
  /** Which of the firm's lists. Absent, every list. */
  listIds?: readonly string[];
  /** Only tasks that are nobody's sub-task; their sub-tasks are read with `readSubtaskTrees`. */
  topLevel?: boolean;
  /** Me Mode: the reader's own work, assigned to them (directly or through a team), watched, or either. */
  mine?: MeMode;
  /** Only completed tasks, or only open ones. Absent, both. */
  completed?: boolean;
}

export type MeMode = "assigned" | "watching" | "both";

function filterQuery(filters: TaskListFilters, cursor?: string): string {
  const query = new URLSearchParams();
  if (cursor !== undefined) query.set("cursor", cursor);
  if (filters.rungs !== undefined && filters.rungs.length > 0) {
    query.set("rung", filters.rungs.join(","));
  }
  if (filters.includeArchived === true) query.set("includeArchived", "true");
  if (filters.priorities !== undefined && filters.priorities.length > 0) {
    query.set("priority", filters.priorities.join(","));
  }
  if (filters.assigneeUserId !== undefined) query.set("assigneeUserId", filters.assigneeUserId);
  if (filters.dueFrom !== undefined) query.set("dueFrom", filters.dueFrom);
  if (filters.dueTo !== undefined) query.set("dueTo", filters.dueTo);
  const search = filters.search?.trim();
  if (search !== undefined && search.length > 0) query.set("search", search);
  if (filters.includeClosedMatters === true) query.set("includeClosedMatters", "true");
  if (filters.listIds !== undefined && filters.listIds.length > 0) {
    query.set("listId", filters.listIds.join(","));
  }
  if (filters.topLevel === true) query.set("topLevel", "true");
  if (filters.mine !== undefined) query.set("mine", filters.mine);
  if (filters.completed !== undefined) query.set("completed", String(filters.completed));
  return query.size === 0 ? "" : `?${query.toString()}`;
}

/**
 * The matter's tasks, ordered by what is due next with the undated last, then by urgency. The same
 * ordering as the member's own list, so a task does not move between the two screens.
 */
export function listMatterTasks(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
  filters: TaskListFilters = {},
): Promise<ApiOutcome<Page<MatterTask>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/tasks${filterQuery(filters, cursor)}`,
  );
}

/**
 * Every task this member can reach — across the matters they can see, plus their own work on no
 * matter. Tasks on closed matters are left out unless asked for.
 */
export function listMyTasks(
  fetchImpl: typeof fetch,
  cursor?: string,
  filters: TaskListFilters = {},
): Promise<ApiOutcome<Page<MatterTask>>> {
  return requestJson(fetchImpl, `/api/v1/tasks${filterQuery(filters, cursor)}`);
}

export interface NewTaskInput extends TaskContentInput {
  matterId: string | null;
  assigneeUserId?: string | null;
  /** Left out, the firm's default list at its first status. A sub-task takes its parent's list. */
  listId?: string | null;
  statusId?: string | null;
  parentTaskId?: string | null;
  assignees?: readonly AssigneeInput[];
  watcherUserIds?: readonly string[];
}

export type AssigneeInput = { userId: string } | { teamId: string };

export function createTask(
  fetchImpl: typeof fetch,
  task: NewTaskInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/tasks", {
    method: "POST",
    body: task,
    idempotencyKey,
  });
}

/** Replaces the task's content. Who it is assigned to is not changed here. */
export function editTask(
  fetchImpl: typeof fetch,
  taskId: string,
  task: TaskContentInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: task,
    idempotencyKey,
  });
}

/** Puts the task in a member's name, or takes it out of everybody's with null. */
export function reassignTask(
  fetchImpl: typeof fetch,
  taskId: string,
  assigneeUserId: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}/assignee`, {
    method: "PUT",
    body: { assigneeUserId },
    idempotencyKey,
  });
}

/**
 * Moves the task to a rung. One call for all four, because pressing To Do and pressing Done are the
 * same act to the person doing them.
 *
 * Moving to `done` records who finished it and when; moving off `done` clears that and restores the
 * rung the task was left on rather than sending it back to the start.
 */
export function moveTaskToRung(
  fetchImpl: typeof fetch,
  taskId: string,
  rung: TaskRung,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}/rung`, {
    method: "PUT",
    body: { rung },
    idempotencyKey,
  });
}

/** Puts the task away and keeps it. The reason is optional. Different from deleting. */
export function archiveTask(
  fetchImpl: typeof fetch,
  taskId: string,
  reason: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}/archive`, {
    method: "POST",
    body: { reason },
    idempotencyKey,
  });
}

/** Puts the task back on the list, on the rung it left from. */
export function unarchiveTask(
  fetchImpl: typeof fetch,
  taskId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}/archive`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** Removes a task that should not exist. Anything waiting on it stops waiting. */
export function deleteTask(
  fetchImpl: typeof fetch,
  taskId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** Points the task at one of its matter's documents. The document is not copied or moved. */
export function attachTaskDocument(
  fetchImpl: typeof fetch,
  taskId: string,
  fileId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}/documents`, {
    method: "POST",
    body: { fileId },
    idempotencyKey,
  });
}

/** Ends the association. The document stays in the matter's files. */
export function detachTaskDocument(
  fetchImpl: typeof fetch,
  attachmentId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/task-documents/${encodeURIComponent(attachmentId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** A fresh idempotency key per submitted write, so a retry of THAT write is the same write. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

/*
 * The zone a task's due date is read in, defaulted to the reader's own. The server requires a zone
 * whenever there is a date, and the browser knows the only honest default there is.
 */
export { viewerTimeZone } from "$lib/dates";

/**
 * IS THIS TASK PAST DUE — the comparison, made here because here is where somebody is reading it.
 *
 * Only work that is still owed can be. A done task was done, and an archived one is not owed;
 * calling either overdue would be the platform asserting something about the firm's conduct that is
 * not true.
 *
 * A task with a date and no time is due at the END of that civil day in its own zone: rendering it
 * as midnight would report a whole working day of tasks as already missed. The zone comparison uses
 * the same projection the server's resolver uses (zonedReading), so the two agree about "Friday".
 */
export function isOverdue(task: MatterTask, now: Date = new Date()): boolean {
  if (task.completedAt !== null || task.archivedAt !== null) return false;
  if (task.dueOn === null || task.timeZone === null) return false;
  const reading = zonedReading(now.getTime(), task.timeZone);
  if (reading.civilDate > task.dueOn) return true;
  if (reading.civilDate < task.dueOn) return false;
  // Same civil day. Without a time the task has the rest of the day; with one, compare the clock.
  if (task.dueAtTime === null) return false;
  return reading.wallClockTime > task.dueAtTime;
}

/** The reader-facing name of each priority. */
export const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = Object.freeze({
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
});

/** The reader-facing name of each rung, and the words on the controls that move a task to one. */
export const RUNG_LABELS: Readonly<Record<TaskRung, string>> = Object.freeze({
  to_do: "To Do",
  in_progress: "In Progress",
  on_hold: "On Hold",
  done: "Done",
});

/** Every sub-task under the given tasks, at any depth. Each names its parent. */
export function readSubtaskTrees(
  fetchImpl: typeof fetch,
  rootIds: readonly string[],
  includeArchived = false,
): Promise<ApiOutcome<{ data: MatterTask[] }>> {
  const query = new URLSearchParams({ rootIds: rootIds.join(",") });
  if (includeArchived) query.set("includeArchived", "true");
  return requestJson(fetchImpl, `/api/v1/tasks/subtask-trees?${query.toString()}`);
}

/*
 * A TASK'S OWN PARTS. Each is its own small write, which is what lets the list and the window edit
 * one thing in place without carrying the rest of the task through a form.
 */

function taskPath(taskId: string, part: string): string {
  return `/api/v1/tasks/${encodeURIComponent(taskId)}/${part}`;
}

type Acknowledged = Promise<ApiOutcome<{ ok: true }>>;
type Created = Promise<ApiOutcome<{ id: string }>>;

/** Moves the task to another of its list's statuses, where the flow allows it. */
export function moveTaskToStatus(
  fetchImpl: typeof fetch,
  taskId: string,
  statusId: string,
): Acknowledged {
  return requestJson(fetchImpl, taskPath(taskId, "status"), {
    method: "PUT",
    body: { statusId },
    idempotencyKey: newWriteKey(),
  });
}

/** Moves a top-level task, with its sub-tasks, to another list. */
export function moveTaskToList(
  fetchImpl: typeof fetch,
  taskId: string,
  listId: string,
): Acknowledged {
  return requestJson(fetchImpl, taskPath(taskId, "list"), {
    method: "PUT",
    body: { listId },
    idempotencyKey: newWriteKey(),
  });
}

/** Marks the task complete, or reopens it. The status stays where it stood either way. */
export function setTaskCompletion(
  fetchImpl: typeof fetch,
  taskId: string,
  completed: boolean,
): Acknowledged {
  return requestJson(fetchImpl, taskPath(taskId, "completion"), {
    method: "PUT",
    body: { completed },
    idempotencyKey: newWriteKey(),
  });
}

/** Sets how a task repeats, or stops it repeating (`rule` null). */
export function setTaskRecurrence(
  fetchImpl: typeof fetch,
  taskId: string,
  rule: string | null,
  mode: TaskRecurrenceMode,
): Acknowledged {
  return requestJson(fetchImpl, taskPath(taskId, "recurrence"), {
    method: "PUT",
    body: { rule, mode },
    idempotencyKey: newWriteKey(),
  });
}

export function setTaskAssignees(
  fetchImpl: typeof fetch,
  taskId: string,
  assignees: readonly AssigneeInput[],
): Acknowledged {
  return requestJson(fetchImpl, taskPath(taskId, "assignees"), {
    method: "PUT",
    body: { assignees },
    idempotencyKey: newWriteKey(),
  });
}

export function setTaskWatchers(
  fetchImpl: typeof fetch,
  taskId: string,
  userIds: readonly string[],
): Acknowledged {
  return requestJson(fetchImpl, taskPath(taskId, "watchers"), {
    method: "PUT",
    body: { userIds },
    idempotencyKey: newWriteKey(),
  });
}

export function addChecklistItem(fetchImpl: typeof fetch, taskId: string, text: string): Created {
  return requestJson(fetchImpl, taskPath(taskId, "checklist"), {
    method: "POST",
    body: { text },
    idempotencyKey: newWriteKey(),
  });
}

export function updateChecklistItem(
  fetchImpl: typeof fetch,
  itemId: string,
  change: { text?: string; done?: boolean },
): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-checklist-items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: change,
    idempotencyKey: newWriteKey(),
  });
}

export function removeChecklistItem(fetchImpl: typeof fetch, itemId: string): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-checklist-items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    idempotencyKey: newWriteKey(),
  });
}

export function addTaskLink(
  fetchImpl: typeof fetch,
  taskId: string,
  link: { url: string; label: string | null },
): Created {
  return requestJson(fetchImpl, taskPath(taskId, "links"), {
    method: "POST",
    body: link,
    idempotencyKey: newWriteKey(),
  });
}

export function removeTaskLink(fetchImpl: typeof fetch, linkId: string): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-links/${encodeURIComponent(linkId)}`, {
    method: "DELETE",
    idempotencyKey: newWriteKey(),
  });
}

/*
 * HOW THE FIRM ORGANISES ITS TASK WORK: its lists, each list's statuses and flow, and its teams.
 */

export function listTaskLists(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: TaskListSummary[] }>> {
  return requestJson(fetchImpl, "/api/v1/task-lists");
}

export function listTaskTeams(fetchImpl: typeof fetch): Promise<ApiOutcome<{ data: TaskTeam[] }>> {
  return requestJson(fetchImpl, "/api/v1/task-teams");
}

export function createTaskList(fetchImpl: typeof fetch, name: string): Created {
  return requestJson(fetchImpl, "/api/v1/task-lists", {
    method: "POST",
    body: { name },
    idempotencyKey: newWriteKey(),
  });
}

export function renameTaskList(
  fetchImpl: typeof fetch,
  listId: string,
  name: string,
): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-lists/${encodeURIComponent(listId)}`, {
    method: "PATCH",
    body: { name },
    idempotencyKey: newWriteKey(),
  });
}

export function makeTaskListDefault(fetchImpl: typeof fetch, listId: string): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-lists/${encodeURIComponent(listId)}/default`, {
    method: "PUT",
    idempotencyKey: newWriteKey(),
  });
}

/** Retires a list, moving its tasks to another list first. */
export function retireTaskList(
  fetchImpl: typeof fetch,
  listId: string,
  moveTasksToListId: string,
): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-lists/${encodeURIComponent(listId)}/retire`, {
    method: "POST",
    body: { moveTasksToListId },
    idempotencyKey: newWriteKey(),
  });
}

export function addTaskListStatus(
  fetchImpl: typeof fetch,
  listId: string,
  status: { name: string; colour: TaskStatusColour },
): Created {
  return requestJson(fetchImpl, `/api/v1/task-lists/${encodeURIComponent(listId)}/statuses`, {
    method: "POST",
    body: status,
    idempotencyKey: newWriteKey(),
  });
}

export function updateTaskListStatus(
  fetchImpl: typeof fetch,
  statusId: string,
  status: { name: string; colour: TaskStatusColour; position: number },
): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-list-statuses/${encodeURIComponent(statusId)}`, {
    method: "PATCH",
    body: status,
    idempotencyKey: newWriteKey(),
  });
}

export function removeTaskListStatus(fetchImpl: typeof fetch, statusId: string): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-list-statuses/${encodeURIComponent(statusId)}`, {
    method: "DELETE",
    idempotencyKey: newWriteKey(),
  });
}

/** Which statuses a task on this one may move to next, replacing what was there. */
export function setTaskStatusFlow(
  fetchImpl: typeof fetch,
  statusId: string,
  toStatusIds: readonly string[],
): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-list-statuses/${encodeURIComponent(statusId)}/flow`, {
    method: "PUT",
    body: { toStatusIds },
    idempotencyKey: newWriteKey(),
  });
}

export function createTaskTeam(
  fetchImpl: typeof fetch,
  team: { name: string; memberUserIds: readonly string[] },
): Created {
  return requestJson(fetchImpl, "/api/v1/task-teams", {
    method: "POST",
    body: team,
    idempotencyKey: newWriteKey(),
  });
}

export function updateTaskTeam(
  fetchImpl: typeof fetch,
  teamId: string,
  team: { name: string; memberUserIds: readonly string[] },
): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-teams/${encodeURIComponent(teamId)}`, {
    method: "PATCH",
    body: team,
    idempotencyKey: newWriteKey(),
  });
}

export function retireTaskTeam(fetchImpl: typeof fetch, teamId: string): Acknowledged {
  return requestJson(fetchImpl, `/api/v1/task-teams/${encodeURIComponent(teamId)}`, {
    method: "DELETE",
    idempotencyKey: newWriteKey(),
  });
}

/** The palette colour each status colour paints with. */
export const STATUS_PALETTE: Readonly<Record<TaskStatusColour, PaletteColorName>> = Object.freeze({
  gray: "grey",
  blue: "blue",
  orange: "orange",
  amber: "yellow",
  green: "green",
  purple: "purple",
  red: "red",
});

/** The status colour a palette swatch stands for, for the settings picker. */
export function statusColourOf(palette: PaletteColorName): TaskStatusColour {
  const found = TASK_STATUS_COLOURS.find((colour) => STATUS_PALETTE[colour] === palette);
  return found ?? "gray";
}

/**
 * Changes one or two of a task's own fields in place, from the list or the window.
 *
 * The content edit REPLACES what it names, and an omitted link or detail is a cleared one, so every
 * field the task should keep travels from the task as it stands and only the change differs. The
 * start date and the location are the exception the server already makes: left out, they are kept.
 */
export function editTaskFields(
  fetchImpl: typeof fetch,
  task: MatterTask,
  change: Partial<TaskContentInput>,
): Promise<ApiOutcome<{ ok: true }>> {
  const content: TaskContentInput = {
    title: task.title,
    body: task.body,
    priority: task.priority,
    blockedByTaskId: task.blockedByTaskId,
    triggerEventId: task.triggerEventId,
    deadlineId: task.deadlineId,
    dueOn: task.dueOn,
    dueAtTime: task.dueAtTime,
    timeZone: task.timeZone,
    ...change,
  };
  // A due date needs a zone to fall at a moment; a new date written here falls in the reader's.
  if (content.dueOn !== null && content.dueOn !== undefined && content.timeZone == null) {
    content.timeZone = readerTimeZone();
  }
  if (content.dueOn === null) {
    content.dueAtTime = null;
    content.timeZone = null;
  }
  return editTask(fetchImpl, task.id, content, newWriteKey());
}
