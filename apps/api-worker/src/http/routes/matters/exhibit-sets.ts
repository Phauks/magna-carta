import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  AddExhibitSetMembersRequest,
  AddedExhibitSetMembers,
  CreateExhibitSetRequest,
  CreatedExhibitSet,
  EditExhibitSetRequest,
  ExhibitLabelMoves,
  ExhibitSetDetail,
  ExhibitSetList,
  ReorderExhibitSetRequest,
} from "@magna-carta/exhibits/contract";
import { addMembers, removeMember, reorderMembers } from "@magna-carta/exhibits/member-service";
import { listExhibitSets, readExhibitSet } from "@magna-carta/exhibits/queries";
import {
  archiveExhibitSet,
  createExhibitSet,
  editExhibitSet,
} from "@magna-carta/exhibits/set-service";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type {
  ExhibitSetId,
  ExhibitSetMemberId,
  MatterExhibitId,
  MatterId,
} from "@magna-carta/identifiers/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  errors,
  idempotentWrite,
  jsonBody,
  matterIdParam,
  memberParams,
  readErrors,
  readMeta,
  setDetailBody,
  setParams,
  writeMeta,
} from "./exhibit-route-support.ts";

// A matter's exhibit sets while they are being built: create, rename, renumber, add, remove and
// reorder. A draft's labels are computed from the order on every read, so nothing here writes one.
// What happens once a set goes out is in exhibit-set-issue.ts.

const listSetsRoute = defineOpenAPIRoute(readMeta("listExhibitSets"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/exhibit-sets",
  description:
    "Every exhibit set on the matter, newest first, with its numbering, whether it has been issued " +
    "and how, how many exhibits it holds, and which set replaced it if one did.",
  request: { params: matterIdParam },
  responses: {
    200: {
      description: "The matter's exhibit sets",
      content: { "application/json": { schema: ExhibitSetList } },
    },
    401: readErrors[401],
    403: readErrors[403],
    404: readErrors[404],
    429: readErrors[429],
  },
});

const createSetRoute = defineOpenAPIRoute(writeMeta("createExhibitSet"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets",
  description:
    "Starts an empty exhibit set for one filing. With no numbering given it takes the default: " +
    "Exhibit A, B, C, and AA, BB, CC after Z.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: jsonBody(CreateExhibitSetRequest),
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

const readSetRoute = defineOpenAPIRoute(readMeta("readExhibitSet"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}",
  description:
    "One set and its exhibits in order, each with its label. A draft's labels are computed from the " +
    "order now; an issued set's are the labels, titles and file versions it went out with.",
  request: { params: setParams },
  responses: {
    200: { description: "The set", content: { "application/json": { schema: ExhibitSetDetail } } },
    401: readErrors[401],
    403: readErrors[403],
    404: readErrors[404],
    429: readErrors[429],
  },
});

const editSetRoute = defineOpenAPIRoute(writeMeta("editExhibitSet"), {
  method: "patch",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}",
  description:
    "Renames or renumbers a draft set, or archives it. Every label follows a numbering change at " +
    "once. An issued set is refused: its name and numbering went out with it.",
  request: {
    headers: idempotencyKeyHeader,
    params: setParams,
    body: jsonBody(EditExhibitSetRequest),
  },
  responses: {
    200: { description: "Done", content: { "application/json": { schema: CreatedExhibitSet } } },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const addMembersRoute = defineOpenAPIRoute(writeMeta("addExhibitSetMembers"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/members",
  description:
    "Adds exhibits to the end of a draft set, in the order given. A document appears once in a set.",
  request: {
    headers: idempotencyKeyHeader,
    params: setParams,
    body: jsonBody(AddExhibitSetMembersRequest),
  },
  responses: {
    201: {
      description: "The new members",
      content: { "application/json": { schema: AddedExhibitSetMembers } },
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

const removeMemberRoute = defineOpenAPIRoute(
  {
    ...writeMeta("removeExhibitSetMember"),
    // Adding the exhibit back puts it at the end; a reorder returns it to its old place.
    reversal: { kind: "inverse", by: "exhibits.addExhibitSetMembers" },
  },
  {
    method: "delete",
    path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/members/{memberId}",
    description:
      "Takes an exhibit out of a draft set. The exhibits after it move up one label. The exhibit " +
      "itself stays on the matter. An issued set's exhibits are withdrawn instead.",
    request: { headers: idempotencyKeyHeader, params: memberParams },
    responses: {
      200: { description: "Done", content: { "application/json": { schema: CreatedExhibitSet } } },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      422: errors[422],
      429: errors[429],
    },
  },
);

const reorderRoute = defineOpenAPIRoute(writeMeta("reorderExhibitSet"), {
  method: "put",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/order",
  description:
    "Replaces the order of a draft set in one step. The order names every member exactly once; a " +
    "member added or removed since the set was read refuses it. Answers with every label that moved.",
  request: {
    headers: idempotencyKeyHeader,
    params: setParams,
    body: jsonBody(ReorderExhibitSetRequest),
  },
  responses: {
    200: {
      description: "The labels that moved",
      content: { "application/json": { schema: ExhibitLabelMoves } },
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

export function registerExhibitSetRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...listSetsRoute, middleware: chokepointMiddleware(chokepoint, listSetsRoute) },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      const sets = await listExhibitSets(database, matterId as MatterId);
      return c.json({ data: sets.map((set) => ({ ...set })) }, 200);
    },
  );

  app.openapi(
    { ...createSetRoute, middleware: chokepointMiddleware(chokepoint, createSetRoute) },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      return idempotentWrite(c, 201, async (database, options) => {
        const created = await createExhibitSet(
          database,
          { matterId: matterId as MatterId, name: body.name, scheme: body.scheme },
          options,
        );
        return { body: { id: created.setId }, effect: created.effect };
      });
    },
  );

  app.openapi(
    { ...readSetRoute, middleware: chokepointMiddleware(chokepoint, readSetRoute) },
    async (c) => {
      const { matterId, setId } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      const set = await readExhibitSet(database, matterId as MatterId, setId as ExhibitSetId);
      if (set === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such exhibit set on this matter.",
        });
      }
      return c.json(setDetailBody(set), 200);
    },
  );

  app.openapi(
    { ...editSetRoute, middleware: chokepointMiddleware(chokepoint, editSetRoute) },
    async (c) => {
      const { matterId, setId } = c.req.valid("param");
      const { archived, ...edit } = c.req.valid("json");
      return idempotentWrite(c, 200, async (database, options) => {
        const matter = matterId as MatterId;
        const id = setId as ExhibitSetId;
        const statements: EffectWrite["statements"][number][] = [];
        if (edit.name !== undefined || edit.scheme !== undefined) {
          statements.push(
            ...(await editExhibitSet(database, matter, id, edit, options)).effect.statements,
          );
        }
        if (archived === true) {
          statements.push(
            ...(await archiveExhibitSet(database, matter, id, options)).effect.statements,
          );
        }
        return { body: { id }, effect: { statements, outboxMessages: [] } };
      });
    },
  );

  app.openapi(
    { ...addMembersRoute, middleware: chokepointMiddleware(chokepoint, addMembersRoute) },
    async (c) => {
      const { matterId, setId } = c.req.valid("param");
      const { exhibitIds } = c.req.valid("json");
      return idempotentWrite(c, 201, async (database, options) => {
        const added = await addMembers(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          exhibitIds as MatterExhibitId[],
          options,
        );
        return { body: { memberIds: added.memberIds }, effect: added.effect };
      });
    },
  );

  app.openapi(
    { ...removeMemberRoute, middleware: chokepointMiddleware(chokepoint, removeMemberRoute) },
    async (c) => {
      const { matterId, setId, memberId } = c.req.valid("param");
      return idempotentWrite(c, 200, async (database, options) => {
        const removed = await removeMember(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          memberId as ExhibitSetMemberId,
          options,
        );
        return { body: { id: setId as ExhibitSetId }, effect: removed.effect };
      });
    },
  );

  app.openapi(
    { ...reorderRoute, middleware: chokepointMiddleware(chokepoint, reorderRoute) },
    async (c) => {
      const { matterId, setId } = c.req.valid("param");
      const { memberIds } = c.req.valid("json");
      return idempotentWrite(c, 200, async (database, options) => {
        const reordered = await reorderMembers(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          memberIds as ExhibitSetMemberId[],
          options,
        );
        return { body: { moves: reordered.moves }, effect: reordered.effect };
      });
    },
  );
}
