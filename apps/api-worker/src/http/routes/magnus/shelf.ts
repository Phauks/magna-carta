import { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MagnusFolderId, UserId } from "@magna-carta/identifiers/types";
import {
  Folder,
  FolderList,
  FolderNameRequest,
  ShelfRequest,
  ShelfResponse,
} from "@magna-carta/magnus/contract";
import {
  MEMBER_FOLDERS_MAX,
  countFolders,
  createFolder,
  deleteFolder,
  listFolders,
  readFolder,
  readShelf,
  renameFolder,
  shelveConversation,
  type FolderRow,
} from "@magna-carta/magnus/shelf";
import type { Context } from "hono";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { resolveMagnusConsent } from "../../../magnus/consent.ts";
import {
  commonErrors,
  consentRefusal,
  mutationMeta,
  notFound,
  readMeta,
  requireReadableConversation,
  type MagnusApp,
} from "./route-shared.ts";

// A member's shelf for their conversations: the folders they make, and where they keep each
// conversation they can read, and whether they have pinned it.
//
// The shelf is the READER's. It decides nothing about who may read a conversation (the matter it is
// kept on does that), no other member sees it, and a folder's name is never audited: it is text the
// member typed about their own work, the same class as a conversation's title. So every folder route
// works on the caller's own folders only, and another member's folder is reported as absent.

const folderIdParam = z.object({
  folderId: identifierPathParam("magnusFolder", "folderId"),
});
const conversationIdParam = z.object({
  conversationId: identifierPathParam("magnusConversation", "conversationId"),
});

const listFoldersRoute = defineOpenAPIRoute(readMeta("listFolders"), {
  method: "get",
  path: "/api/v1/magnus/folders",
  description:
    "The caller's own folders, by name. General is not among them: it is where a conversation in " +
    "no folder sits, so it needs no folder of its own.",
  responses: {
    200: {
      description: "The caller's folders",
      content: { "application/json": { schema: FolderList } },
    },
    ...commonErrors,
  },
});

const createFolderRoute = defineOpenAPIRoute(mutationMeta("createFolder", true), {
  method: "post",
  path: "/api/v1/magnus/folders",
  description:
    "Makes a folder on the caller's own shelf. A folder arranges the caller's list and decides " +
    "nothing about who may read the conversations in it. The audit row records that a folder was " +
    "made, never its name.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: FolderNameRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The folder was made",
      content: { "application/json": { schema: Folder } },
    },
    ...commonErrors,
  },
});

const renameFolderRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("renameFolder", true),
    reversal: { kind: "inverse", by: "magnus.renameFolder" },
  },
  {
    method: "patch",
    path: "/api/v1/magnus/folders/{folderId}",
    description: "Renames one of the caller's own folders.",
    request: {
      params: folderIdParam,
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: FolderNameRequest } }, required: true },
    },
    responses: {
      200: {
        description: "The folder after the rename",
        content: { "application/json": { schema: Folder } },
      },
      ...commonErrors,
    },
  },
);

const deleteFolderRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("deleteFolder", true),
    reversal: {
      kind: "none",
      reason:
        "The conversations in the folder go back to General and nothing else is removed, but a folder made again is a new folder and each conversation has to be moved into it again.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/magnus/folders/{folderId}",
    description:
      "Removes one of the caller's own folders. The conversations in it go back to General: removing " +
      "a folder never removes a conversation.",
    request: { params: folderIdParam, headers: idempotencyKeyHeader },
    responses: {
      200: {
        description: "The folder was removed",
        content: { "application/json": { schema: z.object({ id: z.string() }) } },
      },
      ...commonErrors,
    },
  },
);

const shelveConversationRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("shelveConversation", true),
    reversal: { kind: "inverse", by: "magnus.shelveConversation" },
  },
  {
    method: "put",
    path: "/api/v1/magnus/conversations/{conversationId}/shelf",
    description:
      "Says where the caller keeps one conversation: in one of their own folders, or in General " +
      "(a null folder), and whether it is pinned. Both halves are set at once. The caller must be " +
      "able to read the conversation; where they keep it is theirs alone and changes nothing for " +
      "anyone else who can read it.",
    request: {
      params: conversationIdParam,
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: ShelfRequest } }, required: true },
    },
    responses: {
      200: {
        description: "Where the caller now keeps the conversation",
        content: { "application/json": { schema: ShelfResponse } },
      },
      ...commonErrors,
    },
  },
);

function folderBody(folder: FolderRow) {
  return {
    id: folder.id,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}

function folderNotFound(c: Context): ProblemResponse<404> {
  return problemJson(c, { type: "not-found", status: 404, title: "Folder not found" });
}

// One of the caller's own folders, or nothing: another member's folder is reported as absent.
async function ownFolder(
  c: Context,
  folderId: MagnusFolderId,
  userId: UserId,
): Promise<FolderRow | null> {
  const firm = requireChokepointFirmContext(c);
  const folder = await readFolder(firm.firmDatabase, folderId);
  return folder !== undefined && folder.memberId === userId ? folder : null;
}

export function registerMagnusShelfRoutes(app: MagnusApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...listFoldersRoute, middleware: chokepointMiddleware(chokepoint, listFoldersRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const folders = await listFolders(firm.firmDatabase, userId);
      return c.json({ data: folders.slice(0, MEMBER_FOLDERS_MAX).map(folderBody) }, 200);
    },
  );

  app.openapi(
    { ...createFolderRoute, middleware: chokepointMiddleware(chokepoint, createFolderRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { name } = c.req.valid("json");
      if ((await countFolders(firm.firmDatabase, userId)) >= MEMBER_FOLDERS_MAX) {
        return problemJson(c, {
          type: "validation",
          status: 422,
          title: "Too many folders",
          detail: `A member may keep up to ${MEMBER_FOLDERS_MAX} folders. Remove one to make another.`,
        });
      }
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const created = createFolder(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { memberId: userId, name },
          );
          return {
            write: created.effect,
            responseCode: 201,
            responseBody: canonicalJsonStringify({ id: created.folderId }),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      const { id } = JSON.parse(result.responseBody ?? "{}") as { id: MagnusFolderId };
      const folder = await readFolder(firm.firmDatabase, id);
      if (folder === undefined) return folderNotFound(c);
      return c.json(folderBody(folder), 201);
    },
  );

  app.openapi(
    { ...renameFolderRoute, middleware: chokepointMiddleware(chokepoint, renameFolderRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { folderId } = c.req.valid("param");
      const { name } = c.req.valid("json");
      if ((await ownFolder(c, folderId, userId)) === null) return folderNotFound(c);
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: renameFolder(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { folderId, memberId: userId, name },
          ),
          responseCode: 200,
          responseBody: canonicalJsonStringify({ id: folderId }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      const folder = await readFolder(firm.firmDatabase, folderId);
      if (folder === undefined) return folderNotFound(c);
      return c.json(folderBody(folder), 200);
    },
  );

  app.openapi(
    { ...deleteFolderRoute, middleware: chokepointMiddleware(chokepoint, deleteFolderRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { folderId } = c.req.valid("param");
      if ((await ownFolder(c, folderId, userId)) === null) return folderNotFound(c);
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: deleteFolder(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { folderId, memberId: userId },
          ),
          responseCode: 200,
          responseBody: canonicalJsonStringify({ id: folderId }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      return c.json({ id: folderId }, 200);
    },
  );

  app.openapi(
    {
      ...shelveConversationRoute,
      middleware: chokepointMiddleware(chokepoint, shelveConversationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { conversationId } = c.req.valid("param");
      const { folderId, pinned } = c.req.valid("json");
      if ((await requireReadableConversation(c, conversationId, userId)) === null) {
        return notFound(c);
      }
      if (folderId !== null && (await ownFolder(c, folderId, userId)) === null) {
        return folderNotFound(c);
      }
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: shelveConversation(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { conversationId, memberId: userId, folderId, pinned },
          ),
          responseCode: 200,
          responseBody: canonicalJsonStringify({ conversationId }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      const shelf = await readShelf(firm.firmDatabase, conversationId, userId);
      return c.json({ conversationId, folderId: shelf.folderId, pinnedAt: shelf.pinnedAt }, 200);
    },
  );
}
