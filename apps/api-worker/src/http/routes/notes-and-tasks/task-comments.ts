import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { MatterTaskCommentId, MatterTaskId, UserId } from "@magna-carta/identifiers/types";
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  readTaskCommentThread,
} from "@magna-carta/tasks/comment-service";
import { TaskCommentRequest, TaskCommentThread } from "@magna-carta/tasks/contract";
import { TaskValidationError } from "@magna-carta/tasks/validation";
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
  acknowledgeWrite,
  acknowledgedResponses,
  authErrors,
  createWrite,
  createdResponses,
  readMeta,
  taskIdParam,
  writeMeta,
} from "./task-route-support.ts";

// A task's comment thread: flat, oldest first, and only the author rewords or removes a comment.
// Who is told, and who may be named, is decided in packages/tasks/src/comment-service.ts.

const taskCommentIdParam = z.object({
  commentId: identifierPathParam("matterTaskComment", "commentId"),
});

function jsonBody<T extends z.ZodType>(schema: T) {
  return { content: { "application/json": { schema } }, required: true } as const;
}

function inverseOf(action: string, by = action) {
  return { ...writeMeta(action), reversal: { kind: "inverse", by: `tasks.${by}` } as const };
}

const readTaskCommentsRoute = defineOpenAPIRoute(readMeta("readTaskComments"), {
  method: "get",
  path: "/api/v1/tasks/{taskId}/comments",
  description:
    "The task's comment thread, oldest first: each comment, who wrote it, when, whether it has " +
    "been reworded since, and the colleagues it names.",
  request: { params: taskIdParam },
  responses: {
    200: {
      description: "The thread",
      content: { "application/json": { schema: TaskCommentThread } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addTaskCommentRoute = defineOpenAPIRoute(writeMeta("addTaskComment"), {
  method: "post",
  path: "/api/v1/tasks/{taskId}/comments",
  description:
    "Adds a comment to the end of the task's thread. Each colleague named in `mentionedUserIds` " +
    "is told, and must be able to see the task. The people the task is assigned to and the people " +
    "watching it are told too; the author is never told of their own comment.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskIdParam,
    body: jsonBody(TaskCommentRequest),
  },
  responses: createdResponses,
});

const editTaskCommentRoute = defineOpenAPIRoute(inverseOf("editTaskComment"), {
  method: "put",
  path: "/api/v1/task-comments/{commentId}",
  description:
    "Rewords one of the member's own comments, and replaces who it names. The comment keeps its " +
    "place and is marked edited. A colleague newly named is told; nobody else is told again.",
  request: {
    headers: idempotencyKeyHeader,
    params: taskCommentIdParam,
    body: jsonBody(TaskCommentRequest),
  },
  responses: acknowledgedResponses,
});

const deleteTaskCommentRoute = defineOpenAPIRoute(
  inverseOf("deleteTaskComment", "addTaskComment"),
  {
    method: "delete",
    path: "/api/v1/task-comments/{commentId}",
    description:
      "Removes one of the member's own comments from the thread. The firm's audit log keeps that " +
      "it was written and removed, and never what it said.",
    request: { headers: idempotencyKeyHeader, params: taskCommentIdParam },
    responses: acknowledgedResponses,
  },
);

export function registerTaskCommentRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...readTaskCommentsRoute,
      middleware: chokepointMiddleware(chokepoint, readTaskCommentsRoute),
    },
    async (c) => {
      const database = requireChokepointFirmContext(c).firmDatabase;
      const userId = requireChokepointUserId(c);
      const { taskId } = c.req.valid("param");
      try {
        const thread = await readTaskCommentThread(database, taskId as MatterTaskId, {
          visibility: visibleMatterPredicate(),
          actorUserId: userId,
        });
        return c.json(
          {
            data: thread.map((comment) => ({
              id: comment.id,
              taskId: comment.task_id,
              authorUserId: comment.author_user_id,
              body: comment.body,
              createdAt: comment.created_at,
              editedAt: comment.edited_at,
              mentionedUserIds: [...comment.mentioned_user_ids],
            })),
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof TaskValidationError) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );

  app.openapi(
    { ...addTaskCommentRoute, middleware: chokepointMiddleware(chokepoint, addTaskCommentRoute) },
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { body, mentionedUserIds } = c.req.valid("json");
      return createWrite(c, async (database, options) => {
        const { commentId, effect } = await addTaskComment(
          database,
          taskId as MatterTaskId,
          { body, mentionedUserIds: (mentionedUserIds ?? []) as UserId[] },
          options,
        );
        return { id: commentId, effect };
      });
    },
  );

  app.openapi(
    { ...editTaskCommentRoute, middleware: chokepointMiddleware(chokepoint, editTaskCommentRoute) },
    async (c) => {
      const { commentId } = c.req.valid("param");
      const { body, mentionedUserIds } = c.req.valid("json");
      return acknowledgeWrite(c, (database, options) =>
        editTaskComment(
          database,
          commentId as MatterTaskCommentId,
          { body, mentionedUserIds: (mentionedUserIds ?? []) as UserId[] },
          options,
        ),
      );
    },
  );

  app.openapi(
    {
      ...deleteTaskCommentRoute,
      middleware: chokepointMiddleware(chokepoint, deleteTaskCommentRoute),
    },
    async (c) => {
      const { commentId } = c.req.valid("param");
      return acknowledgeWrite(c, (database, options) =>
        deleteTaskComment(database, commentId as MatterTaskCommentId, options),
      );
    },
  );
}
