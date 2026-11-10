import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { WALL_CLOCK_TIME_PATTERN } from "@magna-carta/civil-time/wall-clock";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { decodeCursor, encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  FileId,
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  MatterTaskDocumentId,
  MatterTaskExternalLinkId,
  MatterTaskId,
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
  readMatterTaskDocuments,
  selectMatterTasksStatement,
  selectMyTasksStatement,
  type MatterTaskDocumentRow,
  type MatterTaskRow,
} from "@magna-carta/tasks/task-statements";
import { readTaskTimeSummaries, NO_TIME_LOGGED } from "@magna-carta/timekeeping/task-time";
import {
  linkTaskToExternalSystem,
  recordExternalSync,
  unlinkTaskFromExternalSystem,
} from "@magna-carta/tasks/sync-service";
import {
  MAX_TASK_CHANGE_PAGE_SIZE,
  readExternalLinksForTasks,
  readTaskChanges,
  readTaskIdForExternalId,
  type MatterTaskExternalLinkRow,
} from "@magna-carta/tasks/sync-statements";
import {
  MAX_ARCHIVE_REASON_LENGTH,
  MAX_TASK_BODY_LENGTH,
  MAX_TASK_PAGE_SIZE,
  MAX_TASK_TITLE_LENGTH,
  TASK_PRIORITIES,
  TASK_RUNGS,
  rungOf,
} from "@magna-carta/tasks/types";
import { TaskValidationError } from "@magna-carta/tasks/validation";
import type { Context } from "hono";
import type { Permission } from "@magna-carta/access-control/registry";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointPermissions,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { taskErrorResponse } from "../shared/task-error-response.ts";

// The task's HTTP surface over @magna-carta/tasks.
//
// A task is one piece of work with somebody's name on it. It may sit on a matter or on none — firm
// work like renewing the malpractice policy belongs to no client file — and the two are one record
// with one set of routes, because "what is on my plate" spans both and nobody wants two lists.
//
// WHO MAY SEE WHAT is decided in the domain, by one predicate every read composes: a task on a
// matter is visible to whoever can see that matter, and a task on none is private to its assignee
// and whoever created it. No route re-states that rule.
//
// Assignment is its own route with its own permission. Putting work in a colleague's name is a
// different act from fixing a due date, and a firm may reserve it without reserving the rest.

const READ = "tasks:read" as const;
// Not this route file's own permission — the task routes are gated on the three above. This one is
// read in the time handler to decide WHOSE time the summary counts, which is the same line My Day
// draws: with it, the task's whole time; without it, the reader's own and nobody else's.
const VIEW_FIRM_TIME = "time:viewFirm" as const;
const WRITE = "tasks:write" as const;
const ASSIGN = "tasks:assign" as const;

const CIVIL_DATE = CIVIL_DATE_PATTERN;
const WALL_CLOCK_TIME = WALL_CLOCK_TIME_PATTERN;

// ---- request/response contracts ----

// When a task is due, as a caller supplies it. All three are optional together — a task with no due
// date is ordinary — and the shape rules are enforced in the domain rather than here: a time needs a
// date, and a date needs the zone it is read in, because a task due "Friday" falls at two different
// moments in Reno and Boston.
const dueFields = {
  dueOn: z.string().regex(CIVIL_DATE).nullable().optional(),
  dueAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
  timeZone: z.string().min(1).max(120).nullable().optional(),
};

const taskContentFields = {
  title: z.string().min(1).max(MAX_TASK_TITLE_LENGTH),
  body: z.string().max(MAX_TASK_BODY_LENGTH).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  blockedByTaskId: identifierField("matterTask").nullable().optional(),
  triggerEventId: identifierField("matterEvent").nullable().optional(),
  deadlineId: identifierField("matterDeadline").nullable().optional(),
  ...dueFields,
};

const CreateTaskRequest = z
  .object({
    // Explicitly nullable rather than omitted: a task on no matter is a decision the caller makes,
    // not a field they forgot.
    matterId: identifierField("matter").nullable(),
    assigneeUserId: identifierField("user").nullable().optional(),
    ...taskContentFields,
  })
  .openapi("CreateMatterTaskRequest");

const EditTaskRequest = z.object(taskContentFields).openapi("EditMatterTaskRequest");

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

const TaskDocument = z
  .object({
    id: z.string(),
    fileId: z.string(),
    fileName: z.string(),
    contentType: z.string().nullable(),
    linkedAt: z.string(),
    linkedBy: z.string().nullable(),
  })
  .openapi("MatterTaskDocument");

const TaskDetail = z
  .object({
    id: z.string(),
    // Null on a task that belongs to no client file.
    matterId: z.string().nullable(),
    title: z.string(),
    body: z.string().nullable(),
    // Null on a task nobody has picked up, which is a real state rather than a defect.
    assigneeUserId: z.string().nullable(),
    createdBy: z.string(),
    priority: z.enum(TASK_PRIORITIES),
    dueOn: z.string().nullable(),
    dueAtTime: z.string().nullable(),
    timeZone: z.string().nullable(),
    // WHERE THE TASK STANDS, as the one vocabulary a reader has. The two columns behind it are the
    // platform's problem and never a consumer's: nothing outside the server needs to know that
    // three rungs live in one column and the fourth in another.
    rung: z.enum(TASK_RUNGS),
    completedAt: z.string().nullable(),
    completedBy: z.string().nullable(),
    // PUT AWAY, KEPT. Orthogonal to the rung — a task is archived FROM wherever it stood, and
    // unarchiving puts it back there. The reason is optional and usually absent.
    archivedAt: z.string().nullable(),
    archivedBy: z.string().nullable(),
    archiveReason: z.string().nullable(),
    // The one task this one waits on, where there is one. It GATES NOTHING: a blocked task may still
    // be completed, because a firm's real sequence has exceptions constantly.
    blockedByTaskId: z.string().nullable(),
    triggerEventId: z.string().nullable(),
    deadlineId: z.string().nullable(),
    documents: z.array(TaskDocument),
    // How long this task has actually taken, from the time entries that name it. Minutes only —
    // what a task COST is a billing question with a different audience and a different permission.
    // The scope rides WITH the numbers rather than once per page on purpose: the same two totals
    // mean "what this task cost the firm" under `firm` and "what I have put into it" under `own`,
    // and a consumer must not be able to render one without the other.
    // Who touched it last, and null on a row nothing has edited since it was written. A mirror
    // reads this to tell its OWN writes from a person's; without it a two-way sync pushes back
    // everything it just pulled and the two sides oscillate.
    updatedBy: z.string().nullable(),
    // Where else this task is written down. Empty on nearly every task: the platform integrates
    // with nothing and ships no adapter, so a row here exists only because an addon put it there.
    externalLinks: z.array(
      z
        .object({
          id: z.string(),
          system: z.string(),
          externalId: z.string(),
          externalUrl: z.string().nullable(),
          remoteRevision: z.string().nullable(),
          lastSyncedAt: z.string().nullable(),
        })
        .openapi("MatterTaskExternalLink"),
    ),
    timeLogged: z
      .object({
        billableMinutes: z.number().int(),
        nonBillableMinutes: z.number().int(),
        entryCount: z.number().int(),
        scope: z.enum(["firm", "own"]),
      })
      .openapi("MatterTaskTimeLogged"),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MatterTaskDetail");

const TaskPage = paginated(TaskDetail).openapi("MatterTaskPage");
const CreatedResponse = z.object({ id: z.string() }).openapi("CreatedMatterTask");
const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("MatterTaskAcknowledged");

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const taskIdParam = z.object({ taskId: identifierPathParam("matterTask", "taskId") });
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

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the task is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is not a shape this operation accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// ---- error mapping ----

// ---- route metas ----

// Every task route binds resource: "firm" rather than "matter", including the matter-scoped list.
// A task's matter is nullable, so a matter cannot be the tenancy root of a record that need not have
// one — the firm is. What the matter-scoped list narrows by is a filter, and the visible-matter
// predicate still decides what it may return.
function readMeta(action: string): RouteMeta {
  return {
    operationId: `tasks.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string, permission: typeof WRITE | typeof ASSIGN = WRITE): RouteMeta {
  return {
    operationId: `tasks.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    // Required. A retried create must not put a second copy of the same task on somebody's list,
    // and a duplicate task is worse than a duplicate read: two identical obligations, one of which
    // somebody will complete and the other of which will sit there looking undone.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

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

function serviceOptions(userId: UserId) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId,
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

function taskDetail(
  row: MatterTaskRow,
  documents: readonly MatterTaskDocumentRow[],
  externalLinks: readonly MatterTaskExternalLinkRow[],
  timeLogged: z.infer<typeof TaskDetail>["timeLogged"],
): z.infer<typeof TaskDetail> {
  return {
    id: row.id,
    matterId: row.matter_id,
    title: row.title,
    body: row.body,
    assigneeUserId: row.assignee_user_id,
    createdBy: row.created_by,
    priority: row.priority,
    dueOn: row.due_on,
    dueAtTime: row.due_at_time,
    timeZone: row.time_zone,
    rung: rungOf({ state: row.state, progress: row.progress }),
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    archiveReason: row.archive_reason,
    blockedByTaskId: row.blocked_by_task_id,
    triggerEventId: row.trigger_event_id,
    deadlineId: row.deadline_id,
    documents: documents
      .filter((document) => document.task_id === row.id)
      .map((document) => ({
        id: document.id,
        fileId: document.file_id,
        fileName: document.file_name,
        contentType: document.content_type,
        linkedAt: document.linked_at,
        linkedBy: document.linked_by,
      })),
    externalLinks: externalLinks
      .filter((link) => link.task_id === row.id)
      .map((link) => ({
        id: link.id,
        system: link.system,
        externalId: link.external_id,
        externalUrl: link.external_url,
        remoteRevision: link.remote_revision,
        lastSyncedAt: link.last_synced_at,
      })),
    timeLogged,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// Whether this reader may see other timekeepers' time. Not one of this file's own permissions — the
// task routes ride the three above — and it gates nothing: it decides WHOSE time the page counts,
// so a member without it gets their own entries rather than an error or a blank.
function seesFirmTime(c: Context): boolean {
  return requireChokepointPermissions(c).has(VIEW_FIRM_TIME as unknown as Permission);
}

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

function filtersFrom(query: z.infer<typeof listTasksQuery>) {
  return {
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
  const taskIds = rows.map((row) => row.id);
  // The page's attachments in ONE bounded read keyed by the tasks on it, never one read per task.
  const documents = await readMatterTaskDocuments(
    database,
    taskIds,
    visibleMatterPredicate(),
    viewerUserId,
  );
  // The page's time on the same terms, and for the same reason. Whose time it counts is the
  // reader's `time:viewFirm` answer, which is the line My Day already draws: with it, what the task
  // cost the firm; without it, what this member put into it and nobody else's.
  const timeByTask = await readTaskTimeSummaries(database, {
    taskIds,
    onlyTimekeeperUserId: seesFirmTime ? null : viewerUserId,
  });
  // And the page's external identities on the same terms. Empty for every firm that has connected
  // nothing, which is every firm the platform ships to — an IN over an indexed column against no
  // rows costs nothing, and the alternative is a surface that cannot say a task is mirrored.
  const externalLinks = await readExternalLinksForTasks(database, taskIds);
  const scope = seesFirmTime ? ("firm" as const) : ("own" as const);
  return {
    data: rows.map((row) =>
      taskDetail(row, documents, externalLinks, {
        ...(timeByTask.get(row.id) ?? NO_TIME_LOGGED),
        scope,
      }),
    ),
    // Keyed on the same composite the list is ordered by, so the walk cannot skip or repeat.
    nextCursor:
      hasMore && last !== undefined ? encodeCursor(encodeTaskSortKey(last), last.id) : null,
  };
}

function cursorFrom(cursor: string | undefined) {
  const decoded = decodeCursor(cursor);
  return decoded === undefined ? undefined : decodeTaskCursor(decoded.createdAt, decoded.id);
}

type TaskEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

async function commitTaskEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ id: string; effect: EffectWrite }>,
): Promise<TaskEffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { id, effect } = await call();
        return {
          write: effect,
          responseCode,
          // The stored body IS the wire body: the idempotency gate replays it verbatim.
          responseBody: canonicalJsonStringify({ id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof TaskValidationError) {
      return { ok: false, problem: taskErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const stored = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, id: stored.id, replayed: result.kind === "replayed" };
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
          filters: filtersFrom(query),
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
        filters: filtersFrom(query),
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
      const documents = await readMatterTaskDocuments(
        firm.firmDatabase,
        page.changed.map((row) => row.id),
        visibleMatterPredicate(),
        userId,
      );
      const externalLinks = await readExternalLinksForTasks(
        firm.firmDatabase,
        page.changed.map((row) => row.id),
      );
      const firmTime = seesFirmTime(c);
      const timeByTask = await readTaskTimeSummaries(firm.firmDatabase, {
        taskIds: page.changed.map((row) => row.id),
        onlyTimekeeperUserId: firmTime ? null : userId,
      });
      const scope = firmTime ? ("firm" as const) : ("own" as const);
      return c.json(
        {
          changed: page.changed.map((row) =>
            taskDetail(row, documents, externalLinks, {
              ...(timeByTask.get(row.id) ?? NO_TIME_LOGGED),
              scope,
            }),
          ),
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
      if (
        assigneeUserId !== null &&
        assigneeUserId !== userId &&
        !requireChokepointPermissions(c).has(ASSIGN as unknown as Permission)
      ) {
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
