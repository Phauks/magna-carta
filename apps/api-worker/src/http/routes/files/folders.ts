import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  createFolder,
  deleteFolder,
  moveFolder,
  renameFolder,
} from "@magna-carta/file-manager/folder-service";
import { listFoldersByMatter } from "@magna-carta/file-manager/queries";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import type { Context } from "hono";
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
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../../idempotency-conflict-problems.ts";

// The folder organization surface: create, rename/move (patch), and delete (only when empty). Folders
// are a per-matter tree; the file-manager folder-service owns the cycle, sibling-name, and emptiness
// rules. Each mutation rides one atomic batch (record + rows + audit) through the idempotent write
// path, mirroring the upload surface. Bytes never enter here — a folder is pure metadata.

const FILES_ORGANIZE = "files:organize" as const;

const CreateFolderRequest = z
  .object({
    matterId: identifierField("matter"),
    parentFolderId: identifierField("folder").nullable().optional(),
    name: z.string().min(1),
  })
  .openapi("CreateFolderRequest");

const CreateFolderResponse = z.object({ folderId: z.string() }).openapi("CreateFolderResponse");

const PatchFolderRequest = z
  .object({
    name: z.string().min(1).optional(),
    // Present (incl. explicit null = the matter root) = a move; absent = no move.
    parentFolderId: identifierField("folder").nullable().optional(),
  })
  .openapi("PatchFolderRequest");

const FolderActionAck = z.object({ folderId: z.string() }).openapi("FolderActionAck");

// One node of a matter's folder tree in adjacency-list form: its id, its parent (null at the matter
// root), and its name. The client assembles the tree from the parent links.
const FolderSummary = z
  .object({
    id: z.string(),
    parentFolderId: z.string().nullable(),
    name: z.string(),
  })
  .openapi("FolderSummary");

const FolderListResponse = z.object({ data: z.array(FolderSummary) }).openapi("FolderListResponse");

const folderParam = z.object({ id: identifierPathParam("folder", "id") });

const authErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks files:organize",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the member is deactivated, or the folder/matter is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const idempotencyErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is still in progress, or the folder cannot be changed " +
      "(name taken, would form a cycle, or is not empty)",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

function organizeMeta(action: string): RouteMeta {
  return {
    operationId: `folders.${action}`,
    surface: "app",
    authenticated: true,
    permission: FILES_ORGANIZE,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const createFolderMeta = organizeMeta("create");
const patchFolderMeta = organizeMeta("update");
const deleteFolderMeta = organizeMeta("delete");

// The folder tree is a read: open to any authenticated firm member (permission null — the same
// matter-reachability posture as files.list; the firm-scoped query against the session firm's isolated
// database is the wall). resource "matter" because folders are matter-rooted.
const listFoldersMeta: RouteMeta = {
  operationId: "folders.list",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const listFoldersRoute = defineOpenAPIRoute(listFoldersMeta, {
  method: "get",
  path: "/api/v1/folders",
  description:
    "Lists a matter's folder tree in adjacency-list form (each node carries its parent link and " +
    "name). Folders carry no clean/pending status — every folder in the matter is returned.",
  request: { query: z.object({ matterId: identifierField("matter") }) },
  responses: {
    200: {
      description: "The matter's folders",
      content: { "application/json": { schema: FolderListResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createFolderRoute = defineOpenAPIRoute(createFolderMeta, {
  method: "post",
  path: "/api/v1/folders",
  description:
    "Creates a folder under a matter (optionally nested under a parent folder). A folder is pure " +
    "metadata — file bytes are keyed independently, so this moves nothing in storage.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateFolderRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The folder was created",
      content: { "application/json": { schema: CreateFolderResponse } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const patchFolderRoute = defineOpenAPIRoute(patchFolderMeta, {
  method: "patch",
  path: "/api/v1/folders/{id}",
  description:
    "Renames a folder and/or moves it under a new parent (or to the matter root). Refuses a move " +
    "that would form a cycle, or a name already taken among its new siblings.",
  request: {
    headers: idempotencyKeyHeader,
    params: folderParam,
    body: { content: { "application/json": { schema: PatchFolderRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The folder was updated",
      content: { "application/json": { schema: FolderActionAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const deleteFolderRoute = defineOpenAPIRoute(
  { ...deleteFolderMeta, reversal: { kind: "inverse", by: "folders.create" } },
  {
    method: "delete",
    path: "/api/v1/folders/{id}",
    description: "Deletes a folder. Refuses a folder that still contains any subfolder or file.",
    request: { headers: idempotencyKeyHeader, params: folderParam },
    responses: {
      200: {
        description: "The folder was deleted",
        content: { "application/json": { schema: FolderActionAck } },
      },
      400: idempotencyErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: idempotencyErrors[409],
      422: idempotencyErrors[422],
      429: authErrors[429],
    },
  },
);

type FoldersApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// Maps a file-manager refusal to its problem. Codes drive the mapping. The annotated return keeps the
// precise status union for the typed handler (an inferred union widens to bare Response).
function folderErrorResponse(
  c: Context,
  error: FileManagerValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "unknown-folder") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such resource in this firm.",
    });
  }
  // A blank or whitespace-only name: the request is well-formed but the value is not usable, which is
  // an unprocessable payload rather than a clash with another folder's state.
  if (error.code === "invalid-name") {
    return problemJson(c, {
      type: "validation",
      title: "Folder name is not usable",
      status: 422,
      detail: error.message,
    });
  }
  // folder-not-empty, folder-cycle, folder-name-taken, folder-cross-matter — a state clash.
  return problemJson(c, {
    type: "conflict",
    title: "Folder cannot be changed",
    status: 409,
    detail: error.message,
  });
}

export function registerFoldersRoutes(app: FoldersApp, chokepoint: Chokepoint): void {
  // GET /api/v1/folders — list the matter's folder tree
  app.openapi(
    { ...listFoldersRoute, middleware: chokepointMiddleware(chokepoint, listFoldersRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("query");
      const folders = await listFoldersByMatter(firm.firmDatabase, matterId);
      return c.json(
        {
          data: folders.map((folder) => ({
            id: folder.id,
            parentFolderId: folder.parentFolderId,
            name: folder.name,
          })),
        } as z.infer<typeof FolderListResponse>,
        200,
      );
    },
  );

  // POST /api/v1/folders — create
  app.openapi(
    {
      ...createFolderRoute,
      middleware: chokepointMiddleware(chokepoint, createFolderRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const now = () => new Date().toISOString();
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const created = await createFolder(
              firm.firmDatabase,
              {
                matterId: request.matterId,
                parentFolderId: request.parentFolderId ?? null,
                name: request.name,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: created.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ folderId: created.folderId }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        const body = JSON.parse(storedResponseBody(result)) as z.infer<typeof CreateFolderResponse>;
        return c.json(body, 201);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return folderErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // PATCH /api/v1/folders/{id} — rename and/or move
  app.openapi(
    {
      ...patchFolderRoute,
      middleware: chokepointMiddleware(chokepoint, patchFolderRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const now = () => new Date().toISOString();
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const statements: EffectStatement[] = [];
            const outboxMessages: OutboxMessage[] = [];
            if (patch.name !== undefined) {
              const renamed = await renameFolder(firm.firmDatabase, id, patch.name, {
                clock: { now },
                actorUserId: userId,
              });
              statements.push(...renamed.effect.statements);
              outboxMessages.push(...renamed.effect.outboxMessages);
            }
            if (patch.parentFolderId !== undefined) {
              const moved = await moveFolder(firm.firmDatabase, id, patch.parentFolderId, {
                clock: { now },
                actorUserId: userId,
              });
              statements.push(...moved.effect.statements);
              outboxMessages.push(...moved.effect.outboxMessages);
            }
            return {
              write: { statements, outboxMessages },
              responseCode: 200,
              responseBody: canonicalJsonStringify({ folderId: id }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        const body = JSON.parse(storedResponseBody(result)) as z.infer<typeof FolderActionAck>;
        return c.json(body, 200);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return folderErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // DELETE /api/v1/folders/{id} — delete (empty only)
  app.openapi(
    {
      ...deleteFolderRoute,
      middleware: chokepointMiddleware(chokepoint, deleteFolderRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const now = () => new Date().toISOString();
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const deleted = await deleteFolder(firm.firmDatabase, id, {
              clock: { now },
              actorUserId: userId,
            });
            return {
              write: deleted.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ folderId: id }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        const body = JSON.parse(storedResponseBody(result)) as z.infer<typeof FolderActionAck>;
        return c.json(body, 200);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return folderErrorResponse(c, caught);
        throw caught;
      }
    },
  );
}
