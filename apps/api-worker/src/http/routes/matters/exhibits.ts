import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  CreateExhibitRequest,
  CreatedExhibit,
  EditExhibitRequest,
  ExhibitSchemePresets,
  MatterExhibitList,
} from "@magna-carta/exhibits/contract";
import { archiveExhibit, createExhibit, editExhibit } from "@magna-carta/exhibits/exhibit-service";
import { DEFAULT_EXHIBIT_SCHEME, EXHIBIT_SCHEME_PRESETS } from "@magna-carta/exhibits/presets";
import { listMatterExhibits } from "@magna-carta/exhibits/queries";
import type {
  FileId,
  FileVersionId,
  MatterExhibitId,
  MatterId,
} from "@magna-carta/identifiers/types";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  errors,
  exhibitParams,
  idempotentWrite,
  jsonBody,
  matterIdParam,
  readErrors,
  readMeta,
  writeMeta,
} from "./exhibit-route-support.ts";

// A matter's exhibits: one row per document the matter may file as an exhibit, with a reference
// name that never changes and a title that may. The register read says which sets each exhibit is
// in and what it is called there. Bytes never reach these routes: an exhibit links a file that is
// already on the matter, uploaded through the file surface.

const listExhibitsRoute = defineOpenAPIRoute(readMeta("listExhibits"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/exhibits",
  description:
    "Every exhibit on the matter, oldest first, with the sets each one appears in and the label it " +
    "carries in each. A draft set's label is computed from the current order; an issued set's is " +
    "the label it went out with.",
  request: { params: matterIdParam },
  responses: {
    200: {
      description: "The matter's exhibits",
      content: { "application/json": { schema: MatterExhibitList } },
    },
    401: readErrors[401],
    403: readErrors[403],
    404: readErrors[404],
    429: readErrors[429],
  },
});

const createExhibitRoute = defineOpenAPIRoute(writeMeta("createExhibit"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibits",
  description:
    "Makes a document already on the matter an exhibit. The file must have a clean version. The " +
    "reference name an in-text citation uses is minted from this first title and never changes; " +
    "supply one to choose it.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: jsonBody(CreateExhibitRequest),
  },
  responses: {
    201: {
      description: "The new exhibit",
      content: { "application/json": { schema: CreatedExhibit } },
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

const editExhibitRoute = defineOpenAPIRoute(writeMeta("editExhibit"), {
  method: "patch",
  path: "/api/v1/matters/{matterId}/exhibits/{exhibitId}",
  description:
    "Retitles an exhibit, pins it to a version of its file or floats it on the current one, or " +
    "archives it. A draft set shows the change at once; an issued set keeps what went out. The " +
    "reference name does not move.",
  request: {
    headers: idempotencyKeyHeader,
    params: exhibitParams,
    body: jsonBody(EditExhibitRequest),
  },
  responses: {
    200: {
      description: "Done",
      content: { "application/json": { schema: CreatedExhibit.pick({ id: true }) } },
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

const schemePresetsRoute = defineOpenAPIRoute(readMeta("listSchemePresets"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/exhibit-scheme-presets",
  description:
    "The default numbering a new set takes, and the starter numberings a member may copy into a " +
    "set. None is tied to a court; copying one writes its values onto the set.",
  request: { params: matterIdParam },
  responses: {
    200: {
      description: "The presets",
      content: { "application/json": { schema: ExhibitSchemePresets } },
    },
    401: readErrors[401],
    403: readErrors[403],
    404: readErrors[404],
    429: readErrors[429],
  },
});

export function registerExhibitRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...schemePresetsRoute, middleware: chokepointMiddleware(chokepoint, schemePresetsRoute) },
    (c) =>
      c.json(
        {
          defaultScheme: DEFAULT_EXHIBIT_SCHEME,
          presets: EXHIBIT_SCHEME_PRESETS.map((preset) => ({ ...preset })),
        },
        200,
      ),
  );

  app.openapi(
    { ...listExhibitsRoute, middleware: chokepointMiddleware(chokepoint, listExhibitsRoute) },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      const exhibits = await listMatterExhibits(database, matterId as MatterId);
      return c.json(
        {
          data: exhibits.map((exhibit) => ({
            ...exhibit,
            appearances: exhibit.appearances.map((appearance) => ({ ...appearance })),
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...createExhibitRoute, middleware: chokepointMiddleware(chokepoint, createExhibitRoute) },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      return idempotentWrite(c, 201, async (database, options) => {
        const created = await createExhibit(
          database,
          {
            ...body,
            matterId: matterId as MatterId,
            fileId: body.fileId as FileId,
            pinnedFileVersionId: (body.pinnedFileVersionId ?? null) as FileVersionId | null,
          },
          options,
        );
        return {
          body: { id: created.exhibitId, referenceName: created.referenceName },
          effect: created.effect,
        };
      });
    },
  );

  app.openapi(
    { ...editExhibitRoute, middleware: chokepointMiddleware(chokepoint, editExhibitRoute) },
    async (c) => {
      const { matterId, exhibitId } = c.req.valid("param");
      const { archived, ...edit } = c.req.valid("json");
      return idempotentWrite(c, 200, async (database, options) => {
        const id = exhibitId as MatterExhibitId;
        const matter = matterId as MatterId;
        const statements: EffectWrite["statements"][number][] = [];
        if (Object.keys(edit).length > 0) {
          const edited = await editExhibit(
            database,
            matter,
            id,
            {
              ...edit,
              pinnedFileVersionId: edit.pinnedFileVersionId as FileVersionId | null | undefined,
            },
            options,
          );
          statements.push(...edited.effect.statements);
        }
        if (archived === true) {
          statements.push(
            ...(await archiveExhibit(database, matter, id, options)).effect.statements,
          );
        }
        return { body: { id }, effect: { statements, outboxMessages: [] } };
      });
    },
  );
}
