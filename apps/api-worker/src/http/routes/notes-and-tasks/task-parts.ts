import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  MatterTaskChecklistItemId,
  MatterTaskId,
  MatterTaskLinkId,
  TaskListId,
  TaskListStatusId,
  TaskTeamId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  AddTaskChecklistItemRequest,
  AddTaskLinkRequest,
  MoveTaskToListRequest,
  MoveTaskToStatusRequest,
  TaskAssigneesRequest,
  TaskCompletionRequest,
  TaskRecurrenceRequest,
  TaskSubtaskTrees,
  TaskWatchersRequest,
  UpdateTaskChecklistItemRequest,
} from "@magna-carta/tasks/contract";
import {
  addChecklistItem,
  addTaskLink,
  moveTaskToList,
  moveTaskToStatus,
  removeChecklistItem,
  removeTaskLink,
  setTaskAssignees,
  setTaskWatchers,
  updateChecklistItem,
} from "@magna-carta/tasks/organisation-service";
import { setMatterTaskCompleted } from "@magna-carta/tasks/task-service";
import { setMatterTaskRecurrence } from "@magna-carta/tasks/recurrence-service";
import { readSubtaskTrees } from "@magna-carta/tasks/task-statements";
import { MAX_SUBTASK_DEPTH, MAX_TASK_PAGE_SIZE } from "@magna-carta/tasks/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  ASSIGN,
  acknowledgeWrite,
  acknowledgedResponses,
  authErrors,
  createWrite,
  createdResponses,
  hasPermission,
  projectTasks,
  readMeta,
  seesFirmTime,
  taskIdParam,
  writeMeta,
} from "./task-route-support.ts";

// The parts of a task that are rows or moves of their own: where it stands on its list, which list
// it is on, whether it is finished, who it is assigned to and who watches it, its checklist, its
// links, and the sub-tasks beneath it. Its comment thread is task-comments.ts.
//
// FINISHING IS NOT A STATUS. Completion works from any status and leaves the status where it stood,
// so reopening a task puts it back exactly there; the list's flow governs moves between statuses
// and never governs finishing the work.

const checklistItemIdParam = z.object({
  itemId: identifierPathParam("matterTaskChecklistItem", "itemId"),
});
const taskLinkIdParam = z.object({ linkId: identifierPathParam("matterTaskLink", "linkId") });

function jsonBody<T extends z.ZodType>(schema: T) {
  return { content: { "application/json": { schema } }, required: true } as const;
}

function inverseOf(action: string, by = action) {
  return { ...writeMeta(action), reversal: { kind: "inverse", by: `tasks.${by}` } as const };
}

const readSubtaskTreesRoute = defineOpenAPIRoute(readMeta("readSubtaskTrees"), {
  method: "get",
  path: "/api/v1/tasks/subtask-trees",
  description:
    "Every sub-task under the given tasks, at any depth, in one read. A list screen pages its " +
    "top-level tasks and then asks for their trees here, so a page boundary never splits a parent " +
    "from its sub-tasks. Each row names its parent; the reader assembles the tree.",
  request: {
    query: z.object({
      rootIds: z.string().min(1).openapi({ description: "Comma-separated task ids." }),
      includeArchived: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "The sub-tasks",
      content: { "application/json": { schema: TaskSubtaskTrees } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const moveTaskToStatusRoute = defineOpenAPIRoute(inverseOf("moveTaskToStatus"), {
  method: "put",
  path: "/api/v1/tasks/{taskId}/status",
  description:
    "Moves the task to another of its list's statuses, where the list's flow allows that move. " +
    "Whether the task is finished is untouched.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: jsonBody(MoveTaskToStatusRequest),
  },
  responses: acknowledgedResponses,
});

const moveTaskToListRoute = defineOpenAPIRoute(inverseOf("moveTaskToList"), {
  method: "put",
  path: "/api/v1/tasks/{taskId}/list",
  description:
    "Moves a top-level task, with all of its sub-tasks, to another list, onto that list's first " +
    "status. A sub-task always shares its parent's list, so it is not moved on its own.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: jsonBody(MoveTaskToListRequest),
  },
  responses: acknowledgedResponses,
});

const setTaskCompletionRoute = defineOpenAPIRoute(inverseOf("setTaskCompletion"), {
  method: "put",
  path: "/api/v1/tasks/{taskId}/completion",
  description:
    "Marks the task complete, or reopens it. Works from any status and leaves the status where it " +
    "stood, so reopening puts the task back exactly there. Who finished it and when is recorded on " +
    "completing and cleared on reopening; both acts stay in the firm's audit log.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: jsonBody(TaskCompletionRequest),
  },
  responses: acknowledgedResponses,
});

const setTaskRecurrenceRoute = defineOpenAPIRoute(inverseOf("setTaskRecurrence"), {
  method: "put",
  path: "/api/v1/tasks/{taskId}/recurrence",
  description:
    "Sets how the task repeats, or stops it repeating. Only the current copy of a repeating task " +
    "exists; the next is made when this one is completed, or on the next copy's own start date, " +
    "as `mode` says. A repeat needs a due date, and a sub-task repeats only with its parent.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: jsonBody(TaskRecurrenceRequest),
  },
  responses: acknowledgedResponses,
});

const setTaskAssigneesRoute = defineOpenAPIRoute(
  {
    ...writeMeta("setTaskAssignees", ASSIGN),
    reversal: { kind: "inverse", by: "tasks.setTaskAssignees" },
  },
  {
    method: "put",
    path: "/api/v1/tasks/{taskId}/assignees",
    description:
      "Sets everyone the task is assigned to, people and teams, in order, replacing the set. Each " +
      "person newly named is told. An empty list leaves the task with nobody's name on it.",
    request: {
      headers: idempotencyKeyHeader,
      params: taskIdParam,
      body: jsonBody(TaskAssigneesRequest),
    },
    responses: acknowledgedResponses,
  },
);

const setTaskWatchersRoute = defineOpenAPIRoute(inverseOf("setTaskWatchers"), {
  method: "put",
  path: "/api/v1/tasks/{taskId}/watchers",
  description:
    "Sets who watches the task: people kept informed of the work without doing it. Replaces the " +
    "set. Watching a task oneself needs only the write permission; naming a colleague needs the " +
    "assign permission as well.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: jsonBody(TaskWatchersRequest),
  },
  responses: acknowledgedResponses,
});

const addChecklistItemRoute = defineOpenAPIRoute(writeMeta("addTaskChecklistItem"), {
  method: "post",
  path: "/api/v1/tasks/{taskId}/checklist",
  description: "Adds a line to the end of the task's checklist.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: jsonBody(AddTaskChecklistItemRequest),
  },
  responses: createdResponses,
});

const updateChecklistItemRoute = defineOpenAPIRoute(inverseOf("updateTaskChecklistItem"), {
  method: "patch",
  path: "/api/v1/task-checklist-items/{itemId}",
  description: "Ticks or unticks a checklist line, or rewords it.",
  request: {
    headers: idempotencyKeyHeader,
    params: checklistItemIdParam,
    body: jsonBody(UpdateTaskChecklistItemRequest),
  },
  responses: acknowledgedResponses,
});

const removeChecklistItemRoute = defineOpenAPIRoute(
  inverseOf("removeTaskChecklistItem", "addTaskChecklistItem"),
  {
    method: "delete",
    path: "/api/v1/task-checklist-items/{itemId}",
    description: "Removes a line from the task's checklist.",
    request: { headers: idempotencyKeyHeader, params: checklistItemIdParam },
    responses: acknowledgedResponses,
  },
);

const addTaskLinkRoute = defineOpenAPIRoute(writeMeta("addTaskLink"), {
  method: "post",
  path: "/api/v1/tasks/{taskId}/links",
  description:
    "Adds a web link to the task, with an optional label. Only http and https addresses are kept: " +
    "a colleague opens the link, and any other scheme is a way to run something in their session.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: jsonBody(AddTaskLinkRequest),
  },
  responses: createdResponses,
});

const removeTaskLinkRoute = defineOpenAPIRoute(inverseOf("removeTaskLink", "addTaskLink"), {
  method: "delete",
  path: "/api/v1/task-links/{linkId}",
  description: "Removes a link from the task.",
  request: { headers: idempotencyKeyHeader, params: taskLinkIdParam },
  responses: acknowledgedResponses,
});

export function registerTaskPartsRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...readSubtaskTreesRoute,
      middleware: chokepointMiddleware(chokepoint, readSubtaskTreesRoute),
    },
    async (c) => {
      const database = requireChokepointFirmContext(c).firmDatabase;
      const userId = requireChokepointUserId(c);
      const query = c.req.valid("query");
      // At most a page of roots: this completes a page the list already bounded.
      const rootIds = query.rootIds
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .slice(0, MAX_TASK_PAGE_SIZE) as MatterTaskId[];
      const rows = await readSubtaskTrees(database, rootIds, {
        visibility: visibleMatterPredicate(),
        viewerUserId: userId,
        includeArchived: query.includeArchived === "true",
        maxDepth: MAX_SUBTASK_DEPTH,
      });
      return c.json({ data: await projectTasks(database, rows, userId, seesFirmTime(c)) }, 200);
    },
  );

  app.openapi(
    {
      ...moveTaskToStatusRoute,
      middleware: chokepointMiddleware(chokepoint, moveTaskToStatusRoute),
    },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { statusId } = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        moveTaskToStatus(database, taskId as MatterTaskId, statusId as TaskListStatusId, options),
      );
    },
  );

  app.openapi(
    { ...moveTaskToListRoute, middleware: chokepointMiddleware(chokepoint, moveTaskToListRoute) },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { listId } = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        moveTaskToList(database, taskId as MatterTaskId, listId as TaskListId, options),
      );
    },
  );

  app.openapi(
    {
      ...setTaskCompletionRoute,
      middleware: chokepointMiddleware(chokepoint, setTaskCompletionRoute),
    },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { completed } = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        setMatterTaskCompleted(database, taskId as MatterTaskId, completed, options),
      );
    },
  );

  app.openapi(
    {
      ...setTaskRecurrenceRoute,
      middleware: chokepointMiddleware(chokepoint, setTaskRecurrenceRoute),
    },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { rule, mode } = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        setMatterTaskRecurrence(database, taskId as MatterTaskId, { rule, mode }, options),
      );
    },
  );

  app.openapi(
    {
      ...setTaskAssigneesRoute,
      middleware: chokepointMiddleware(chokepoint, setTaskAssigneesRoute),
    },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const assignees = c.req
        .valid("json")
        .assignees.map((assignee) =>
          "teamId" in assignee
            ? { teamId: assignee.teamId as TaskTeamId }
            : { userId: assignee.userId as UserId },
        );
      return acknowledgeWrite(c, (database, options) =>
        setTaskAssignees(database, taskId as MatterTaskId, assignees, options),
      );
    },
  );

  app.openapi(
    {
      ...setTaskWatchersRoute,
      middleware: chokepointMiddleware(chokepoint, setTaskWatchersRoute),
    },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { userIds } = c.req.valid("json");
      // Putting a colleague on the watch list is naming them on somebody's work.
      const userId = requireChokepointUserId(c);
      if (userIds.some((watcher) => watcher !== userId) && !hasPermission(c, ASSIGN)) {
        return problemJson(c, {
          type: "permission-denied",
          title: "Forbidden",
          status: 403,
          detail: "Adding another member as a watcher needs the assign permission.",
        });
      }
      return acknowledgeWrite(c, (database, options) =>
        setTaskWatchers(database, taskId as MatterTaskId, userIds as UserId[], options),
      );
    },
  );

  app.openapi(
    {
      ...addChecklistItemRoute,
      middleware: chokepointMiddleware(chokepoint, addChecklistItemRoute),
    },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const request = c.req.valid("json");
      return createWrite(c, async (database, options) => {
        const { itemId, effect } = await addChecklistItem(
          database,
          taskId as MatterTaskId,
          request,
          options,
        );
        return { id: itemId, effect };
      });
    },
  );

  app.openapi(
    {
      ...updateChecklistItemRoute,
      middleware: chokepointMiddleware(chokepoint, updateChecklistItemRoute),
    },
    async (c) => {
      const { itemId } = c.req.valid("param");
      const request = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        updateChecklistItem(database, itemId as MatterTaskChecklistItemId, request, options),
      );
    },
  );

  app.openapi(
    {
      ...removeChecklistItemRoute,
      middleware: chokepointMiddleware(chokepoint, removeChecklistItemRoute),
    },
    async (c) => {
      const { itemId } = c.req.valid("param");
      return acknowledgeWrite(c, (database, options) =>
        removeChecklistItem(database, itemId as MatterTaskChecklistItemId, options),
      );
    },
  );

  app.openapi(
    { ...addTaskLinkRoute, middleware: chokepointMiddleware(chokepoint, addTaskLinkRoute) },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const request = c.req.valid("json");
      return createWrite(c, async (database, options) => {
        const { linkId, effect } = await addTaskLink(
          database,
          taskId as MatterTaskId,
          request,
          options,
        );
        return { id: linkId, effect };
      });
    },
  );

  app.openapi(
    { ...removeTaskLinkRoute, middleware: chokepointMiddleware(chokepoint, removeTaskLinkRoute) },
    async (c) => {
      const { linkId } = c.req.valid("param");
      return acknowledgeWrite(c, (database, options) =>
        removeTaskLink(database, linkId as MatterTaskLinkId, options),
      );
    },
  );
}
