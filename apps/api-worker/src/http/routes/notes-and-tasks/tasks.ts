import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { decodeCursor, encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  FileId,
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  MatterTaskDocumentId,
  MatterTaskExternalLinkId,
  MatterTaskId,
  TaskListId,
  TaskListStatusId,
  TaskTeamId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  attachFileToMatterTask,
  archiveMatterTask,
  moveMatterTaskToRung,
  createMatterTask,
  deleteMatterTask,
  detachFileFromMatterTask,
  editMatterTask,
  reassignMatterTask,
  unarchiveMatterTask,
} from "@magna-carta/tasks/task-service";
import {
  decodeTaskCursor,
  encodeTaskSortKey,
  readMatterTask,
  selectMatterTasksStatement,
  selectMyTasksStatement,
  type MatterTaskRow,
} from "@magna-carta/tasks/task-statements";
import {
  linkTaskToExternalSystem,
  recordExternalSync,
  unlinkTaskFromExternalSystem,
} from "@magna-carta/tasks/sync-service";
import {
  MAX_TASK_CHANGE_PAGE_SIZE,
  readTaskChanges,
  readTaskIdForExternalId,
} from "@magna-carta/tasks/sync-statements";
import {
  MAX_ARCHIVE_REASON_LENGTH,
  MAX_TASK_PAGE_SIZE,
  TASK_PRIORITIES,
  TASK_RUNGS,
} from "@magna-carta/tasks/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { CreateTaskRequest, EditTaskRequest, TaskDetail } from "@magna-carta/tasks/contract";
import {
  ASSIGN,
  AcknowledgedResponse,
  CreatedResponse,
  authErrors,
  commitTaskEffect,
  hasPermission,
  projectTasks,
  readMeta,
  seesFirmTime,
  serviceOptions,
  taskIdParam,
  writeMeta,
} from "./task-route-support.ts";

// The task's HTTP surface over @magna-carta/tasks.
//
// A task is one piece of work with somebody's name on it. It may sit on a matter or on none — firm
// work like renewing the malpractice policy belongs to no client file — and the two are one record
// with one set of routes, because "what is on my plate" spans both and nobody wants two lists.
//
// WHO MAY SEE WHAT is decided in the domain, by one predicate every read composes: a task on a
// matter is visible to whoever can see that matter, and a task on none is visible to the whole
// firm, because a firm runs its own work in the open. No route re-states that rule.
//
// Assignment is its own route with its own permission. Putting work in a colleague's name is a
// different act from fixing a due date, and a firm may reserve it without reserving the rest.

const CIVIL_DATE = CIVIL_DATE_PATTERN;

// ---- request/response contracts ----

const ReassignTaskRequest = z
  .object({ assigneeUserId: identifierField("user").nullable() })
  .openapi("ReassignMatterTaskRequest");

const MoveTaskRequest = z.object({ rung: z.enum(TASK_RUNGS) }).openapi("MoveMatterTaskRequest");

// The reason is OPTIONAL, which is the difference from the cancellation this replaces. That one was
// required, and requiring it is why nobody used it: somebody clearing work that is simply not
// happening is not composing a memo.
const ArchiveTaskRequest = z
  .object({ reason: z.string().max(MAX_ARCHIVE_REASON_LENGTH).nullish() })
  .openapi("ArchiveMatterTaskRequest");

const AttachDocumentRequest = z
  .object({ fileId: identifierField("file") })
  .openapi("AttachMatterTaskDocumentRequest");

const TaskPage = paginated(TaskDetail).openapi("MatterTaskPage");

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const attachmentIdParam = z.object({
  attachmentId: identifierPathParam("matterTaskDocument", "attachmentId"),
});

// The filters both lists take. Repeated values arrive as a comma-separated list rather than repeated
// query parameters, so a cursor and its filters round-trip as one stable string.
const listTasksQuery = cursorQuery.extend({
  rung: z.string().optional().openapi({
    description: "Comma-separated rungs to include: to_do, in_progress, on_hold, done.",
  }),
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      description:
        "Include tasks that have been archived. Off by default: putting one away is what takes " +
        "it off a list, and a list that still showed it would be one nobody could clear.",
    }),
  priority: z
    .string()
    .optional()
    .openapi({ description: "Comma-separated priorities to include: low, normal, high, urgent." }),
  assigneeUserId: z.string().optional(),
  dueFrom: z.string().regex(CIVIL_DATE).optional(),
  dueTo: z.string().regex(CIVIL_DATE).optional(),
  search: z.string().min(1).max(200).optional(),
  listId: z.string().optional().openapi({
    description: "Comma-separated task list ids to include. Absent, every list.",
  }),
  topLevel: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      description:
        "Only tasks that are nobody's sub-task. A list screen pages these and reads each one's " +
        "sub-tasks from the subtask-trees route, so a page boundary never splits a parent from " +
        "its sub-tasks.",
    }),
  mine: z
    .enum(["assigned", "watching", "both"])
    .optional()
    .openapi({
      description:
        "Narrow to the reader's own work: tasks assigned to them, directly or through a team " +
        "they are on; tasks they watch; or either.",
    }),
  completed: z
    .enum(["true", "false"])
    .optional()
    .openapi({ description: "Only completed tasks, or only open ones. Absent, both." }),
});

const myTasksQuery = listTasksQuery.extend({
  includeClosedMatters: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      description:
        "Include tasks on matters the firm has closed. Off by default: closing a matter changes " +
        "no task, so its open tasks are filtered from this list rather than archived, and " +
        "reopening the matter brings them back with no backfill.",
    }),
});

// ---- routes ----

const listMatterTasksRoute = defineOpenAPIRoute(readMeta("listMatterTasks"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/tasks",
  description:
    "The matter's tasks. Ordered by due date with the undated last, then by priority, so the list " +
    "reads as what is due next. Each carries the documents it points at. Whether a task is overdue " +
    "is a comparison against now, made where it is read; no field here states it.",
  request: { params: matterIdParam, query: listTasksQuery },
  responses: {
    200: {
      description: "One page of tasks",
      content: { "application/json": { schema: TaskPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listMyTasksRoute = defineOpenAPIRoute(readMeta("listMyTasks"), {
  method: "get",
  path: "/api/v1/tasks",
  description:
    "Every task this member can reach, across the matters they can see and their own work on no " +
    "matter. Filter by assignee to get one person's list. Tasks on closed matters are left out " +
    "unless asked for: closing a matter changes no task, so this is a filter and reopening the " +
    "matter brings them back.",
  request: { query: myTasksQuery },
  responses: {
    200: {
      description: "One page of tasks",
      content: { "application/json": { schema: TaskPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const externalLinkIdParam = z.object({
  linkId: identifierPathParam("matterTaskExternalLink", "linkId"),
});

const LinkTaskRequest = z
  .object({
    system: z
      .string()
      .min(1)
      .max(64)
      .openapi({
        description:
          "The outside system, in whatever the addon calls itself — never an enum here, because " +
          "adding one is the point. Matched case-insensitively: 'ClickUp' and 'clickup' are one system.",
      }),
    externalId: z
      .string()
      .min(1)
      .max(512)
      .openapi({
        description:
          "The remote's own handle for the object. Opaque: this platform never parses it, never " +
          "orders by it, and never assumes a shape.",
      }),
    externalUrl: z.string().max(2048).nullable().optional(),
    remoteRevision: z
      .string()
      .max(512)
      .nullable()
      .optional()
      .openapi({
        description:
          "What the remote looked like when the two sides last agreed — a vendor revision token, an " +
          "ETag, a timestamp they minted. Stored and handed back, never compared for order.",
      }),
    lastSyncedAt: z.string().nullable().optional(),
  })
  .openapi("LinkMatterTaskRequest");

const RecordSyncRequest = z
  .object({
    externalUrl: z.string().max(2048).nullable().optional(),
    remoteRevision: z.string().max(512).nullable().optional(),
    syncedAt: z.string().nullable().optional(),
  })
  .openapi("RecordMatterTaskSyncRequest");

const ExternalLinkCreated = z.object({ id: z.string() }).openapi("CreatedMatterTaskExternalLink");

const TaskChangePage = z
  .object({
    changed: z.array(TaskDetail),
    deleted: z.array(
      z
        .object({
          taskId: z.string(),
          matterId: z.string().nullable(),
          deletedAt: z.string(),
          deletedBy: z.string().nullable(),
        })
        .openapi("MatterTaskDeletion"),
    ),
    // Absent when both streams are exhausted, which is how a caller knows it has caught up rather
    // than counting rows itself.
    nextCursor: z.string().nullable(),
  })
  .openapi("MatterTaskChangePage");

const ExternalLookupResult = z
  .object({ taskId: z.string().nullable() })
  .openapi("MatterTaskExternalLookup");

const readTaskChangesRoute = defineOpenAPIRoute(readMeta("readTaskChanges"), {
  method: "get",
  path: "/api/v1/tasks/changes",
  description:
    "What moved since the cursor: tasks that changed and tasks that were deleted, oldest first. " +
    "The deletions come from a tombstone written in the same batch as the delete, because a row " +
    "that is gone cannot be enumerated afterwards. Visibility applies to the changed tasks exactly " +
    "as it does to any other task read, so this is not a back door. Each caller keeps its own " +
    "cursor; the token is opaque and a malformed one replays from the beginning rather than failing.",
  request: {
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(MAX_TASK_CHANGE_PAGE_SIZE).optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of changes",
      content: { "application/json": { schema: TaskChangePage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const lookupExternalTaskRoute = defineOpenAPIRoute(readMeta("lookupExternalTask"), {
  method: "get",
  path: "/api/v1/tasks/external-lookup",
  description:
    "Which task, if any, corresponds to an object in an outside system. The lookup an addon makes " +
    "before it creates anything, so a replayed sync does not produce a second task. A null taskId " +
    "means either no correspondence exists or the caller cannot see the task it names — the two " +
    "are deliberately indistinguishable.",
  request: {
    query: z.object({ system: z.string().min(1).max(64), externalId: z.string().min(1).max(512) }),
  },
  responses: {
    200: {
      description: "The corresponding task, or null",
      content: { "application/json": { schema: ExternalLookupResult } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const linkTaskRoute = defineOpenAPIRoute(writeMeta("linkExternalTask"), {
  method: "post",
  path: "/api/v1/tasks/{taskId}/external-links",
  description:
    "Record that this task IS an object in an outside system. One remote object maps to at most " +
    "one task, and one task holds at most one identity per system; both are unique indexes rather " +
    "than service checks, because a race between two syncs is the case a check loses.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: { content: { "application/json": { schema: LinkTaskRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The link",
      content: { "application/json": { schema: ExternalLinkCreated } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const recordSyncRoute = defineOpenAPIRoute(writeMeta("recordExternalSync"), {
  method: "patch",
  path: "/api/v1/task-external-links/{linkId}",
  description:
    "What an addon writes after a round trip: where it lives now, what the remote looked like " +
    "when the two sides agreed, and when. The identity itself is immutable — changing what a task " +
    "mirrors is unlink then link, so both acts land in the audit trail.",
  request: {
    headers: idempotencyKeyHeader,
    params: externalLinkIdParam,
    body: { content: { "application/json": { schema: RecordSyncRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Recorded",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const unlinkTaskRoute = defineOpenAPIRoute(
  {
    ...writeMeta("unlinkExternalTask"),
    reversal: { kind: "inverse", by: "tasks.linkExternalTask" },
  },
  {
    method: "delete",
    path: "/api/v1/task-external-links/{linkId}",
    description:
      "Stop mirroring. The task is untouched: unlinking is a statement about the correspondence and " +
      "never about the work, so nothing here completes, archives or deletes anything.",
    request: { headers: idempotencyKeyHeader, params: externalLinkIdParam },
    responses: {
      200: {
        description: "Unlinked",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const createTaskRoute = defineOpenAPIRoute(writeMeta("createTask"), {
  method: "post",
  path: "/api/v1/tasks",
  description:
    "Creates a task. Give a matter to put it on a case, or null for the firm's own work — renewing " +
    "a policy, interviewing a candidate — which is visible to you and whoever you assign it to. " +
    "Assigning it to somebody else at creation requires the assign permission as well.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateTaskRequest } }, required: true },
  },
  responses: {
    201: { description: "The task", content: { "application/json": { schema: CreatedResponse } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const editTaskRoute = defineOpenAPIRoute(writeMeta("editTask"), {
  method: "patch",
  path: "/api/v1/tasks/{taskId}",
  description:
    "Changes a task's title, body, priority, due date and links. The task is edited in place and " +
    "the previous values are not kept — a task says what to do now. Who it is assigned to is not " +
    "changed here; that is its own operation.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: { content: { "application/json": { schema: EditTaskRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The task was changed",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const reassignTaskRoute = defineOpenAPIRoute(writeMeta("reassignTask", ASSIGN), {
  method: "put",
  path: "/api/v1/tasks/{taskId}/assignee",
  description:
    "Puts the task in a member's name, or takes it out of everybody's with null. The member must " +
    "be able to see the task's matter: a task somebody cannot open is a hole in their list. Moving " +
    "a task does not move its due date, even across offices in different time zones.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: { content: { "application/json": { schema: ReassignTaskRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The task was reassigned",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const moveTaskRoute = defineOpenAPIRoute(writeMeta("moveTask"), {
  method: "put",
  path: "/api/v1/tasks/{taskId}/rung",
  description:
    "Moves the task to a rung: to_do, in_progress, on_hold or done. One operation for all four, " +
    "because pressing To Do and pressing Done are the same act to the person doing them. Moving to " +
    "done records who finished it and when; moving off done clears that and restores the rung the " +
    "task was left on, rather than sending it back to the start. That it was closed and reopened " +
    "stays in the firm's audit log. A task that waits on another may be moved out of order: the " +
    "sequence is guidance, not a gate. An archived task is not moved until it is put back.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: { content: { "application/json": { schema: MoveTaskRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The task was moved",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const archiveTaskRoute = defineOpenAPIRoute(writeMeta("archiveTask"), {
  method: "post",
  path: "/api/v1/tasks/{taskId}/archive",
  description:
    "Puts the task away and keeps it. Archiving and deleting are the two ways a task leaves a " +
    "list and they differ in one thing: this keeps the data, a delete takes it. The rung is " +
    "untouched, so putting it back returns it to where it stood. A reason is optional.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: { content: { "application/json": { schema: ArchiveTaskRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The task was archived",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const unarchiveTaskRoute = defineOpenAPIRoute(
  { ...writeMeta("unarchiveTask"), reversal: { kind: "inverse", by: "tasks.archiveTask" } },
  {
    method: "delete",
    path: "/api/v1/tasks/{taskId}/archive",
    description:
      "Puts the task back on the list, on the rung it left from. The archive reason is cleared " +
      "with the archiving; that it was archived stays in the firm's audit log.",
    request: { headers: idempotencyKeyHeader, params: taskIdParam },
    responses: {
      200: {
        description: "The task was put back",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const deleteTaskRoute = defineOpenAPIRoute(
  {
    ...writeMeta("deleteTask"),
    reversal: {
      kind: "none",
      reason:
        "A deleted task leaves a tombstone carrying identifiers and nothing else, which is what a mirror learns the deletion from. The work itself is gone and nothing puts it back.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/tasks/{taskId}",
    description:
      "Deletes a task outright, for one that should not exist: a typo, a duplicate, a line somebody " +
      "abandoned. Anything waiting on it stops waiting. Documents it pointed at are untouched and " +
      "stay in the matter's files. Where the work is simply not happening, archive the task instead: " +
      "archiving keeps it and everything it carries, and deleting does not.",
    request: { headers: idempotencyKeyHeader, params: taskIdParam },
    responses: {
      200: {
        description: "The task was deleted",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const attachDocumentRoute = defineOpenAPIRoute(writeMeta("attachTaskDocument"), {
  method: "post",
  path: "/api/v1/tasks/{taskId}/documents",
  description:
    "Points the task at one of its matter's documents. The document is not moved or copied — it " +
    "stays in the matter's files with its versions and holds intact. A task on no matter cannot " +
    "point at a document, because every document in the firm belongs to a matter.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: { content: { "application/json": { schema: AttachDocumentRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The link",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const detachDocumentRoute = defineOpenAPIRoute(
  {
    ...writeMeta("detachTaskDocument"),
    reversal: { kind: "inverse", by: "tasks.attachTaskDocument" },
  },
  {
    method: "delete",
    path: "/api/v1/task-documents/{attachmentId}",
    description:
      "Ends the association between a task and a document. The document is untouched and stays in " +
      "the matter's files.",
    request: { headers: idempotencyKeyHeader, params: attachmentIdParam },
    responses: {
      200: {
        description: "The link was removed",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

// ---- shared handler plumbing ----
// A comma-separated query value narrowed to a closed vocabulary. Anything the vocabulary does not
// contain is dropped rather than refused: a filter is a narrowing, and a caller that names a state
// this platform does not have gets the states it does rather than a 422 about a query string.
function closedList<T extends string>(
  raw: string | undefined,
  vocabulary: readonly T[],
): readonly T[] | undefined {
  if (raw === undefined) return undefined;
  const chosen = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is T => (vocabulary as readonly string[]).includes(value));
  return chosen.length === 0 ? undefined : chosen;
}

function filtersFrom(query: z.infer<typeof listTasksQuery>, viewerUserId: UserId) {
  const listIds = query.listId
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0) as TaskListId[] | undefined;
  return {
    listIds: listIds === undefined || listIds.length === 0 ? undefined : listIds,
    topLevelOnly: query.topLevel === "true",
    assignedToUserId: query.mine === "assigned" || query.mine === "both" ? viewerUserId : undefined,
    watchedByUserId: query.mine === "watching" || query.mine === "both" ? viewerUserId : undefined,
    completed: query.completed === undefined ? undefined : query.completed === "true",
    rungs: closedList(query.rung, TASK_RUNGS),
    includeArchived: query.includeArchived === "true",
    priorities: closedList(query.priority, TASK_PRIORITIES),
    assigneeUserId: query.assigneeUserId as UserId | undefined,
    dueFrom: query.dueFrom,
    dueTo: query.dueTo,
    search: query.search,
  };
}

type TaskListRow = MatterTaskRow & { priority_rank: number };

async function pageFrom(
  database: SqlDatabase,
  viewerUserId: UserId,
  seesFirmTime: boolean,
  results: TaskListRow[],
): Promise<{ data: z.infer<typeof TaskDetail>[]; nextCursor: string | null }> {
  const hasMore = results.length > MAX_TASK_PAGE_SIZE;
  const rows = hasMore ? results.slice(0, MAX_TASK_PAGE_SIZE) : results;
  const last = rows.at(-1);
  return {
    data: await projectTasks(database, rows, viewerUserId, seesFirmTime),
    // Keyed on the same composite the list is ordered by, so the walk cannot skip or repeat.
    nextCursor:
      hasMore && last !== undefined ? encodeCursor(encodeTaskSortKey(last), last.id) : null,
  };
}

function cursorFrom(cursor: string | undefined) {
  const decoded = decodeCursor(cursor);
  return decoded === undefined ? undefined : decodeTaskCursor(decoded.createdAt, decoded.id);
}

export function registerTasksRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/matters/{matterId}/tasks
  app.openapi(
    { ...listMatterTasksRoute, middleware: chokepointMiddleware(chokepoint, listMatterTasksRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { matterId } = c.req.valid("param");
      const query = c.req.valid("query");
      const { results } = await selectMatterTasksStatement(
        firm.firmDatabase,
        matterId as MatterId,
        {
          cursor: cursorFrom(query.cursor),
          limit: MAX_TASK_PAGE_SIZE + 1,
          visibility: visibleMatterPredicate(),
          viewerUserId: userId,
          filters: filtersFrom(query, userId),
        },
      ).all<TaskListRow>();
      return c.json(await pageFrom(firm.firmDatabase, userId, seesFirmTime(c), results), 200);
    },
  );

  // GET /api/v1/tasks
  app.openapi(
    { ...listMyTasksRoute, middleware: chokepointMiddleware(chokepoint, listMyTasksRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const query = c.req.valid("query");
      const { results } = await selectMyTasksStatement(firm.firmDatabase, {
        cursor: cursorFrom(query.cursor),
        limit: MAX_TASK_PAGE_SIZE + 1,
        visibility: visibleMatterPredicate(),
        viewerUserId: userId,
        filters: filtersFrom(query, userId),
        includeClosedMatters: query.includeClosedMatters === "true",
      }).all<TaskListRow>();
      return c.json(await pageFrom(firm.firmDatabase, userId, seesFirmTime(c), results), 200);
    },
  );

  // GET /api/v1/tasks/changes — registered ahead of the {taskId} routes so the literal segment
  // wins the match, the discipline the time-entry surface already follows for quick-add-preview.
  app.openapi(
    { ...readTaskChangesRoute, middleware: chokepointMiddleware(chokepoint, readTaskChangesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const query = c.req.valid("query");
      const page = await readTaskChanges(firm.firmDatabase, {
        cursor: query.cursor,
        limit: query.limit ?? MAX_TASK_CHANGE_PAGE_SIZE,
        visibility: visibleMatterPredicate(),
        viewerUserId: userId,
      });
      // The changed tasks are projected exactly as a list projects them — same shape, same links,
      // same time — because a sync reading a different shape from the screen would be a second
      // definition of what a task is.
      return c.json(
        {
          changed: await projectTasks(firm.firmDatabase, page.changed, userId, seesFirmTime(c)),
          deleted: page.deleted.map((row) => ({
            taskId: row.task_id,
            matterId: row.matter_id,
            deletedAt: row.deleted_at,
            deletedBy: row.deleted_by,
          })),
          nextCursor: page.nextCursor ?? null,
        },
        200,
      );
    },
  );

  // GET /api/v1/tasks/external-lookup
  app.openapi(
    {
      ...lookupExternalTaskRoute,
      middleware: chokepointMiddleware(chokepoint, lookupExternalTaskRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { system, externalId } = c.req.valid("query");
      const link = await readTaskIdForExternalId(
        firm.firmDatabase,
        system.trim().toLowerCase(),
        externalId.trim(),
      );
      if (link === undefined) return c.json({ taskId: null }, 200);
      // Visibility applies to the ANSWER, not just the task: a caller that cannot see the task is
      // told the same "no" it would get for a correspondence that does not exist, so the lookup
      // cannot be used to probe for tasks on matters the caller has no reach into.
      const task = await readMatterTask(
        firm.firmDatabase,
        link.task_id,
        visibleMatterPredicate(),
        userId,
      );
      return c.json({ taskId: task === undefined ? null : link.task_id }, 200);
    },
  );

  // POST /api/v1/tasks/{taskId}/external-links
  app.openapi(
    { ...linkTaskRoute, middleware: chokepointMiddleware(chokepoint, linkTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { taskId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const linked = await linkTaskToExternalSystem(
          firm.firmDatabase,
          { taskId: taskId as MatterTaskId, ...request },
          serviceOptions(userId),
        );
        return { id: linked.linkId, effect: linked.effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // PATCH /api/v1/task-external-links/{linkId}
  app.openapi(
    { ...recordSyncRoute, middleware: chokepointMiddleware(chokepoint, recordSyncRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { linkId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const recorded = await recordExternalSync(
          firm.firmDatabase,
          linkId as MatterTaskExternalLinkId,
          request,
          serviceOptions(userId),
        );
        return { id: linkId, effect: recorded.effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/task-external-links/{linkId}
  app.openapi(
    { ...unlinkTaskRoute, middleware: chokepointMiddleware(chokepoint, unlinkTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { linkId } = c.req.valid("param");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const unlinked = await unlinkTaskFromExternalSystem(
          firm.firmDatabase,
          linkId as MatterTaskExternalLinkId,
          serviceOptions(userId),
        );
        return { id: linkId, effect: unlinked.effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/tasks
  app.openapi(
    { ...createTaskRoute, middleware: chokepointMiddleware(chokepoint, createTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      // Assigning work to somebody else needs the assign permission, and this route carries the
      // write one. Checked here rather than by splitting the route, because "create a task" and
      // "create a task for Sarah" are one act with one shape and two authorizations.
      const assigneeUserId = (request.assigneeUserId ?? null) as UserId | null;
      const assignees = request.assignees?.map((assignee) =>
        "teamId" in assignee
          ? { teamId: assignee.teamId as TaskTeamId }
          : { userId: assignee.userId as UserId },
      );
      // Naming a team, or any person but oneself, is putting work in somebody else's name.
      const namesSomebodyElse =
        (assigneeUserId !== null && assigneeUserId !== userId) ||
        (assignees ?? []).some((assignee) => assignee.userId !== userId);
      if (namesSomebodyElse && !hasPermission(c, ASSIGN)) {
        return problemJson(c, {
          type: "permission-denied",
          title: "Forbidden",
          status: 403,
          detail: "Putting a task in another member's name needs the assign permission.",
        });
      }
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const created = await createMatterTask(
          firm.firmDatabase,
          {
            ...request,
            matterId: request.matterId as MatterId | null,
            assigneeUserId,
            blockedByTaskId: (request.blockedByTaskId ?? null) as MatterTaskId | null,
            triggerEventId: (request.triggerEventId ?? null) as MatterEventId | null,
            deadlineId: (request.deadlineId ?? null) as MatterDeadlineId | null,
            listId: (request.listId ?? null) as TaskListId | null,
            statusId: (request.statusId ?? null) as TaskListStatusId | null,
            parentTaskId: (request.parentTaskId ?? null) as MatterTaskId | null,
            assignees,
            watcherUserIds: request.watcherUserIds as UserId[] | undefined,
          },
          serviceOptions(userId),
        );
        return { id: created.taskId, effect: created.effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // PATCH /api/v1/tasks/{taskId}
  app.openapi(
    { ...editTaskRoute, middleware: chokepointMiddleware(chokepoint, editTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { taskId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await editMatterTask(
          firm.firmDatabase,
          taskId as MatterTaskId,
          {
            ...request,
            blockedByTaskId: (request.blockedByTaskId ?? null) as MatterTaskId | null,
            triggerEventId: (request.triggerEventId ?? null) as MatterEventId | null,
            deadlineId: (request.deadlineId ?? null) as MatterDeadlineId | null,
          },
          serviceOptions(userId),
        );
        return { id: taskId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // PUT /api/v1/tasks/{taskId}/assignee
  app.openapi(
    { ...reassignTaskRoute, middleware: chokepointMiddleware(chokepoint, reassignTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { taskId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await reassignMatterTask(
          firm.firmDatabase,
          taskId as MatterTaskId,
          (request.assigneeUserId ?? null) as UserId | null,
          serviceOptions(userId),
        );
        return { id: taskId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // PUT /api/v1/tasks/{taskId}/rung
  app.openapi(
    { ...moveTaskRoute, middleware: chokepointMiddleware(chokepoint, moveTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { taskId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await moveMatterTaskToRung(
          firm.firmDatabase,
          taskId as MatterTaskId,
          request.rung,
          serviceOptions(userId),
        );
        return { id: taskId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/tasks/{taskId}/archive
  app.openapi(
    { ...archiveTaskRoute, middleware: chokepointMiddleware(chokepoint, archiveTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { taskId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await archiveMatterTask(
          firm.firmDatabase,
          taskId as MatterTaskId,
          request.reason ?? null,
          serviceOptions(userId),
        );
        return { id: taskId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/tasks/{taskId}/archive
  app.openapi(
    { ...unarchiveTaskRoute, middleware: chokepointMiddleware(chokepoint, unarchiveTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { taskId } = c.req.valid("param");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await unarchiveMatterTask(
          firm.firmDatabase,
          taskId as MatterTaskId,
          serviceOptions(userId),
        );
        return { id: taskId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/tasks/{taskId}
  app.openapi(
    { ...deleteTaskRoute, middleware: chokepointMiddleware(chokepoint, deleteTaskRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { taskId } = c.req.valid("param");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await deleteMatterTask(
          firm.firmDatabase,
          taskId as MatterTaskId,
          serviceOptions(userId),
        );
        return { id: taskId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/tasks/{taskId}/documents
  app.openapi(
    { ...attachDocumentRoute, middleware: chokepointMiddleware(chokepoint, attachDocumentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { taskId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const attached = await attachFileToMatterTask(
          firm.firmDatabase,
          taskId as MatterTaskId,
          request.fileId as FileId,
          serviceOptions(userId),
        );
        return { id: attached.linkId, effect: attached.effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // DELETE /api/v1/task-documents/{attachmentId}
  app.openapi(
    { ...detachDocumentRoute, middleware: chokepointMiddleware(chokepoint, detachDocumentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { attachmentId } = c.req.valid("param");
      const outcome = await commitTaskEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await detachFileFromMatterTask(
          firm.firmDatabase,
          attachmentId as MatterTaskDocumentId,
          serviceOptions(userId),
        );
        return { id: attachmentId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );
}
