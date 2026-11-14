import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  CreateExhibitSetFromFolderRequest,
  CreatedExhibitSet,
  ExhibitSetFolderFollowed,
} from "@magna-carta/exhibits/contract";
import {
  createExhibitSetFromFolder,
  followExhibitSetFolder,
} from "@magna-carta/exhibits/folder-service";
import type { ExhibitSetId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import { z } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  errors,
  idempotentWrite,
  jsonBody,
  matterIdParam,
  setParams,
  writeMeta,
} from "./exhibit-route-support.ts";

// A set made from a folder, and the draft following it. A member gathers a filing's documents in a
// folder; making exhibits from it takes the folder's files in name order, and while the set is a
// draft a follow brings it up to date: files put in the folder join at the end, files taken out
// leave, and the order the member arranged is kept. The screen asks for a follow whenever it opens
// a following draft, so the set a member sees is the folder as it is now.

const createFromFolderRoute = defineOpenAPIRoute(writeMeta("createExhibitSetFromFolder"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets/from-folder",
  description:
    "Makes an exhibit set from a folder: each file directly in the folder with a clean version " +
    "becomes an exhibit, in name order, and the set follows the folder while it is a draft. A " +
    "file that already is an exhibit on the matter keeps its exhibit. The set takes the folder's " +
    "name unless one is given.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: jsonBody(CreateExhibitSetFromFolderRequest),
  },
  responses: {
    201: {
      description: "The new set",
      content: { "application/json": { schema: CreatedExhibitSet } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const followFolderRoute = defineOpenAPIRoute(writeMeta("followExhibitSetFolder"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/follow-folder",
  description:
    "Brings a draft that follows a folder up to date with it. Files now in the folder join at the " +
    "end in name order once they have a clean version; exhibits whose file has left the folder " +
    "leave the set, and the rest close up in their current order. Refused on an issued set and on " +
    "a set built by hand.",
  request: { headers: idempotencyKeyHeader, params: setParams, body: jsonBody(z.object({})) },
  responses: {
    200: {
      description: "What joined and what left",
      content: { "application/json": { schema: ExhibitSetFolderFollowed } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export function registerExhibitSetFolderRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...createFromFolderRoute,
      middleware: chokepointMiddleware(chokepoint, createFromFolderRoute),
    },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      return idempotentWrite(c, 201, async (database, options) => {
        const made = await createExhibitSetFromFolder(
          database,
          {
            matterId: matterId as MatterId,
            folderId: body.folderId as FolderId,
            name: body.name,
            scheme: body.scheme,
          },
          options,
        );
        return { body: { id: made.setId }, effect: made.effect };
      });
    },
  );

  app.openapi(
    { ...followFolderRoute, middleware: chokepointMiddleware(chokepoint, followFolderRoute) },
    async (c) => {
      const { matterId, setId } = c.req.valid("param");
      return idempotentWrite(c, 200, async (database, options) => {
        const followed = await followExhibitSetFolder(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          options,
        );
        return {
          body: {
            addedMemberIds: followed.addedMemberIds,
            removedMemberIds: followed.removedMemberIds,
          },
          effect: followed.effect,
        };
      });
    },
  );
}
