import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type {
  TaskListId,
  TaskListStatusId,
  TaskTeamId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  AddTaskListStatusRequest,
  RetireTaskListRequest,
  TaskListCollection,
  TaskListNameRequest,
  TaskStatusFlowRequest,
  TaskTeamCollection,
  TaskTeamRequest,
  UpdateTaskListStatusRequest,
} from "@magna-carta/tasks/contract";
import {
  addTaskListStatus,
  createTaskList,
  createTaskTeam,
  makeTaskListDefault,
  removeTaskListStatus,
  renameTaskList,
  retireTaskList,
  retireTaskTeam,
  setTaskStatusFlow,
  updateTaskListStatus,
  updateTaskTeam,
} from "@magna-carta/tasks/organisation-service";
import {
  readTaskListStatuses,
  readTaskListTransitions,
  readTaskLists,
  readTaskTeamMembers,
  readTaskTeams,
} from "@magna-carta/tasks/organisation-statements";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  MANAGE_TASK_ORGANISATION,
  acknowledgeWrite,
  acknowledgedResponses,
  authErrors,
  createWrite,
  createdResponses,
  readMeta,
  writeMeta,
} from "./task-route-support.ts";

// How a firm organises its task work: its lists, each list's statuses and the flow between them,
// and its teams.
//
// LISTS are the firm's own: a partners' list, an assignments list, one per kind of case. Each list
// carries its own statuses, in the firm's words and colours, and a FLOW saying which status may
// follow which. Finishing a task is not a status — it is the completion route beside the task's
// other parts — so a list's statuses describe where the work stands, never whether it is over.
//
// TEAMS are named groups of members a task can be assigned to in one step. A team assigned is its
// members at the time anyone looks, so somebody joining the team picks up its work.
//
// Shaping either changes every member's screen at once, so it rides the same permission as
// authoring the firm's matter plans. Reading them needs only the task read permission: every member
// needs the lists and teams to use them.

const listIdParam = z.object({ listId: identifierPathParam("taskList", "listId") });
const statusIdParam = z.object({ statusId: identifierPathParam("taskListStatus", "statusId") });
const teamIdParam = z.object({ teamId: identifierPathParam("taskTeam", "teamId") });

const readResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  429: authErrors[429],
} as const;

function manage(action: string) {
  return writeMeta(action, MANAGE_TASK_ORGANISATION);
}

function jsonBody<T extends z.ZodType>(schema: T) {
  return { content: { "application/json": { schema } }, required: true } as const;
}

const listTaskListsRoute = defineOpenAPIRoute(readMeta("listTaskLists"), {
  method: "get",
  path: "/api/v1/task-lists",
  description:
    "The firm's task lists, in the order the firm arranged them, each with its statuses and the " +
    "statuses each one may move to.",
  responses: {
    200: {
      description: "Every live list",
      content: { "application/json": { schema: TaskListCollection } },
    },
    ...readResponses,
  },
});

const createTaskListRoute = defineOpenAPIRoute(manage("createTaskList"), {
  method: "post",
  path: "/api/v1/task-lists",
  description:
    "Adds a list. It starts with two statuses, To Do and In Progress, each able to move to the " +
    "other; the firm renames, recolours and adds from there.",
  request: { headers: idempotencyKeyHeader, body: jsonBody(TaskListNameRequest) },
  responses: createdResponses,
});

const renameTaskListRoute = defineOpenAPIRoute(
  { ...manage("renameTaskList"), reversal: { kind: "inverse", by: "tasks.renameTaskList" } },
  {
    method: "patch",
    path: "/api/v1/task-lists/{listId}",
    description: "Renames a list. Two live lists never share a name, whatever their capitals.",
    request: {
      headers: idempotencyKeyHeader,
      params: listIdParam,
      body: jsonBody(TaskListNameRequest),
    },
    responses: acknowledgedResponses,
  },
);

const makeTaskListDefaultRoute = defineOpenAPIRoute(manage("makeTaskListDefault"), {
  method: "put",
  path: "/api/v1/task-lists/{listId}/default",
  description:
    "Makes this the list a task lands on when nobody names one. The previous default stays as an " +
    "ordinary list.",
  request: { headers: idempotencyKeyHeader, params: listIdParam },
  responses: acknowledgedResponses,
});

const retireTaskListRoute = defineOpenAPIRoute(manage("retireTaskList"), {
  method: "post",
  path: "/api/v1/task-lists/{listId}/retire",
  description:
    "Retires a list, moving every task on it to another list first, each onto that list's first " +
    "status, so no task is lost with the list. The default list cannot be retired; make another " +
    "the default first.",
  request: {
    headers: idempotencyKeyHeader,
    params: listIdParam,
    body: jsonBody(RetireTaskListRequest),
  },
  responses: acknowledgedResponses,
});

const addTaskListStatusRoute = defineOpenAPIRoute(manage("addTaskListStatus"), {
  method: "post",
  path: "/api/v1/task-lists/{listId}/statuses",
  description:
    "Adds a status to the end of a list's statuses. It joins with no moves in or out; set those " +
    "with the flow route.",
  request: {
    headers: idempotencyKeyHeader,
    params: listIdParam,
    body: jsonBody(AddTaskListStatusRequest),
  },
  responses: createdResponses,
});

const updateTaskListStatusRoute = defineOpenAPIRoute(
  {
    ...manage("updateTaskListStatus"),
    reversal: { kind: "inverse", by: "tasks.updateTaskListStatus" },
  },
  {
    method: "patch",
    path: "/api/v1/task-list-statuses/{statusId}",
    description: "Renames, recolours or reorders a status.",
    request: {
      headers: idempotencyKeyHeader,
      params: statusIdParam,
      body: jsonBody(UpdateTaskListStatusRequest),
    },
    responses: acknowledgedResponses,
  },
);

const removeTaskListStatusRoute = defineOpenAPIRoute(
  {
    ...manage("removeTaskListStatus"),
    reversal: {
      kind: "none",
      reason:
        "A removed status is gone with its place in the flow. Adding one back makes a new status, and its moves have to be set again.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/task-list-statuses/{statusId}",
    description:
      "Removes a status no task is on. A list keeps at least one status, so its last cannot go.",
    request: { headers: idempotencyKeyHeader, params: statusIdParam },
    responses: acknowledgedResponses,
  },
);

const setTaskStatusFlowRoute = defineOpenAPIRoute(
  { ...manage("setTaskStatusFlow"), reversal: { kind: "inverse", by: "tasks.setTaskStatusFlow" } },
  {
    method: "put",
    path: "/api/v1/task-list-statuses/{statusId}/flow",
    description:
      "Says which statuses a task on this one may move to next, replacing what was there. Each must " +
      "be on the same list.",
    request: {
      headers: idempotencyKeyHeader,
      params: statusIdParam,
      body: jsonBody(TaskStatusFlowRequest),
    },
    responses: acknowledgedResponses,
  },
);

const listTaskTeamsRoute = defineOpenAPIRoute(readMeta("listTaskTeams"), {
  method: "get",
  path: "/api/v1/task-teams",
  description: "The firm's teams, by name, each with its members.",
  responses: {
    200: {
      description: "Every live team",
      content: { "application/json": { schema: TaskTeamCollection } },
    },
    ...readResponses,
  },
});

const createTaskTeamRoute = defineOpenAPIRoute(manage("createTaskTeam"), {
  method: "post",
  path: "/api/v1/task-teams",
  description: "Adds a team: a name and the members on it.",
  request: { headers: idempotencyKeyHeader, body: jsonBody(TaskTeamRequest) },
  responses: createdResponses,
});

const updateTaskTeamRoute = defineOpenAPIRoute(
  { ...manage("updateTaskTeam"), reversal: { kind: "inverse", by: "tasks.updateTaskTeam" } },
  {
    method: "patch",
    path: "/api/v1/task-teams/{teamId}",
    description:
      "Renames a team and sets who is on it. Work assigned to the team follows its members as they " +
      "are now, so a member added here picks up the team's work.",
    request: {
      headers: idempotencyKeyHeader,
      params: teamIdParam,
      body: jsonBody(TaskTeamRequest),
    },
    responses: acknowledgedResponses,
  },
);

const retireTaskTeamRoute = defineOpenAPIRoute(
  {
    ...manage("retireTaskTeam"),
    reversal: {
      kind: "none",
      reason:
        "Retiring a team takes it off every task it was assigned to. Making a new team does not put it back on them.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/task-teams/{teamId}",
    description:
      "Retires a team and takes it off every task it was assigned to. The people on it keep anything " +
      "assigned to them by name.",
    request: { headers: idempotencyKeyHeader, params: teamIdParam },
    responses: acknowledgedResponses,
  },
);

export function registerTaskListsAndTeamsRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...listTaskListsRoute, middleware: chokepointMiddleware(chokepoint, listTaskListsRoute) },
    async (c) => {
      const database = requireChokepointFirmContext(c).firmDatabase;
      const statuses = await readTaskListStatuses(database);
      const transitions = await readTaskListTransitions(database);
      const data = (await readTaskLists(database)).map((list) => ({
        id: list.id,
        name: list.name,
        isDefault: list.is_default === 1,
        openCount: list.open_count,
        statuses: statuses
          .filter((status) => status.list_id === list.id)
          .map((status) => ({
            id: status.id,
            name: status.name,
            colour: status.colour,
            position: status.position,
            nextStatusIds: transitions
              .filter((transition) => transition.from_status_id === status.id)
              .map((transition) => transition.to_status_id),
          })),
      }));
      return c.json({ data }, 200);
    },
  );

  app.openapi(
    { ...createTaskListRoute, middleware: chokepointMiddleware(chokepoint, createTaskListRoute) },
    async (c) => {
      const request = c.req.valid("json");
      return createWrite(c, async (database, options) => {
        const { listId, effect } = await createTaskList(database, request, options);
        return { id: listId, effect };
      });
    },
  );

  app.openapi(
    { ...renameTaskListRoute, middleware: chokepointMiddleware(chokepoint, renameTaskListRoute) },
    async (c) => {
      const { listId } = c.req.valid("param");
      const request = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        renameTaskList(database, listId as TaskListId, request, options),
      );
    },
  );

  app.openapi(
    {
      ...makeTaskListDefaultRoute,
      middleware: chokepointMiddleware(chokepoint, makeTaskListDefaultRoute),
    },
    async (c) => {
      const { listId } = c.req.valid("param");
      return acknowledgeWrite(c, (database, options) =>
        makeTaskListDefault(database, listId as TaskListId, options),
      );
    },
  );

  app.openapi(
    { ...retireTaskListRoute, middleware: chokepointMiddleware(chokepoint, retireTaskListRoute) },
    async (c) => {
      const { listId } = c.req.valid("param");
      const { moveTasksToListId } = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        retireTaskList(
          database,
          listId as TaskListId,
          { moveTasksToListId: moveTasksToListId as TaskListId },
          options,
        ),
      );
    },
  );

  app.openapi(
    {
      ...addTaskListStatusRoute,
      middleware: chokepointMiddleware(chokepoint, addTaskListStatusRoute),
    },
    async (c) => {
      const { listId } = c.req.valid("param");
      const request = c.req.valid("json");
      return createWrite(c, async (database, options) => {
        const { statusId, effect } = await addTaskListStatus(
          database,
          listId as TaskListId,
          request,
          options,
        );
        return { id: statusId, effect };
      });
    },
  );

  app.openapi(
    {
      ...updateTaskListStatusRoute,
      middleware: chokepointMiddleware(chokepoint, updateTaskListStatusRoute),
    },
    async (c) => {
      const { statusId } = c.req.valid("param");
      const request = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        updateTaskListStatus(database, statusId as TaskListStatusId, request, options),
      );
    },
  );

  app.openapi(
    {
      ...removeTaskListStatusRoute,
      middleware: chokepointMiddleware(chokepoint, removeTaskListStatusRoute),
    },
    async (c) => {
      const { statusId } = c.req.valid("param");
      return acknowledgeWrite(c, (database, options) =>
        removeTaskListStatus(database, statusId as TaskListStatusId, options),
      );
    },
  );

  app.openapi(
    {
      ...setTaskStatusFlowRoute,
      middleware: chokepointMiddleware(chokepoint, setTaskStatusFlowRoute),
    },
    async (c) => {
      const { statusId } = c.req.valid("param");
      const { toStatusIds } = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        setTaskStatusFlow(
          database,
          statusId as TaskListStatusId,
          { toStatusIds: toStatusIds as TaskListStatusId[] },
          options,
        ),
      );
    },
  );

  app.openapi(
    { ...listTaskTeamsRoute, middleware: chokepointMiddleware(chokepoint, listTaskTeamsRoute) },
    async (c) => {
      const database = requireChokepointFirmContext(c).firmDatabase;
      const members = await readTaskTeamMembers(database);
      const data = (await readTaskTeams(database)).map((team) => ({
        id: team.id,
        name: team.name,
        memberUserIds: members
          .filter((member) => member.team_id === team.id)
          .map((member) => member.user_id),
      }));
      return c.json({ data }, 200);
    },
  );

  app.openapi(
    { ...createTaskTeamRoute, middleware: chokepointMiddleware(chokepoint, createTaskTeamRoute) },
    async (c) => {
      const { name, memberUserIds } = c.req.valid("json");
      return createWrite(c, async (database, options) => {
        const { teamId, effect } = await createTaskTeam(
          database,
          { name, memberUserIds: memberUserIds as UserId[] },
          options,
        );
        return { id: teamId, effect };
      });
    },
  );

  app.openapi(
    { ...updateTaskTeamRoute, middleware: chokepointMiddleware(chokepoint, updateTaskTeamRoute) },
    async (c) => {
      const { teamId } = c.req.valid("param");
      const { name, memberUserIds } = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        updateTaskTeam(
          database,
          teamId as TaskTeamId,
          { name, memberUserIds: memberUserIds as UserId[] },
          options,
        ),
      );
    },
  );

  app.openapi(
    { ...retireTaskTeamRoute, middleware: chokepointMiddleware(chokepoint, retireTaskTeamRoute) },
    async (c) => {
      const { teamId } = c.req.valid("param");
      return acknowledgeWrite(c, (database, options) =>
        retireTaskTeam(database, teamId as TaskTeamId, options),
      );
    },
  );
}
