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

export const TASK_STATES = ["open", "done", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

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
  state: TaskState;
  completedAt: string | null;
  completedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  /** The one task this waits on. It GATES NOTHING — a blocked task may still be completed. */
  blockedByTaskId: string | null;
  triggerEventId: string | null;
  deadlineId: string | null;
  documents: TaskDocument[];
  createdAt: string;
  updatedAt: string;
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
export interface TaskContentInput extends TaskDueInput {
  title: string;
  body?: string | null;
  priority?: TaskPriority | null;
  blockedByTaskId?: string | null;
  triggerEventId?: string | null;
  deadlineId?: string | null;
}

export interface TaskListFilters {
  states?: readonly TaskState[];
  priorities?: readonly TaskPriority[];
  assigneeUserId?: string;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  includeClosedMatters?: boolean;
}

function filterQuery(filters: TaskListFilters, cursor?: string): string {
  const query = new URLSearchParams();
  if (cursor !== undefined) query.set("cursor", cursor);
  if (filters.states !== undefined && filters.states.length > 0) {
    query.set("state", filters.states.join(","));
  }
  if (filters.priorities !== undefined && filters.priorities.length > 0) {
    query.set("priority", filters.priorities.join(","));
  }
  if (filters.assigneeUserId !== undefined) query.set("assigneeUserId", filters.assigneeUserId);
  if (filters.dueFrom !== undefined) query.set("dueFrom", filters.dueFrom);
  if (filters.dueTo !== undefined) query.set("dueTo", filters.dueTo);
  const search = filters.search?.trim();
  if (search !== undefined && search.length > 0) query.set("search", search);
  if (filters.includeClosedMatters === true) query.set("includeClosedMatters", "true");
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

export function createTask(
  fetchImpl: typeof fetch,
  task: TaskContentInput & { matterId: string | null; assigneeUserId?: string | null },
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

export function completeTask(
  fetchImpl: typeof fetch,
  taskId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}/completion`, {
    method: "POST",
    idempotencyKey,
  });
}

/** Puts a completed or cancelled task back on the list. */
export function reopenTask(
  fetchImpl: typeof fetch,
  taskId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}/completion`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** Records that the firm decided not to do the work, and why. Different from deleting. */
export function cancelTask(
  fetchImpl: typeof fetch,
  taskId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/tasks/${encodeURIComponent(taskId)}/cancellation`, {
    method: "POST",
    body: { reason },
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

/**
 * The zone a task's due date is read in, defaulted to the reader's own. The server requires a zone
 * whenever there is a date, and the browser knows the only honest default there is.
 */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * IS THIS TASK PAST DUE — the comparison, made here because here is where somebody is reading it.
 *
 * Only an open task can be. A done task was done, and a cancelled one is not owed; calling either
 * overdue would be the platform asserting something about the firm's conduct that is not true.
 *
 * A task with a date and no time is due at the END of that civil day in its own zone: rendering it
 * as midnight would report a whole working day of tasks as already missed. The zone comparison uses
 * the same locale projection the server's resolver does, so the two agree about "Friday".
 */
export function isOverdue(task: MatterTask, now: Date = new Date()): boolean {
  if (task.state !== "open" || task.dueOn === null || task.timeZone === null) return false;
  const readingNow = civilReading(now, task.timeZone);
  if (readingNow > task.dueOn) return true;
  if (readingNow < task.dueOn) return false;
  // Same civil day. Without a time the task has the rest of the day; with one, compare the clock.
  if (task.dueAtTime === null) return false;
  return clockReading(now, task.timeZone) > task.dueAtTime;
}

function civilReading(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function clockReading(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

/** The reader-facing name of each priority. */
export const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = Object.freeze({
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
});

/** The reader-facing name of each state. */
export const STATE_LABELS: Readonly<Record<TaskState, string>> = Object.freeze({
  open: "Open",
  done: "Done",
  cancelled: "Cancelled",
});
