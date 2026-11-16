import { z } from "@hono/zod-openapi";
import { changeMatterPartyRole } from "@magna-carta/directory/party";
import { ChangeMatterPartyRoleRequest, MatterPartyResponse } from "@magna-carta/directory/contract";
import { identifierField } from "@magna-carta/identifiers/field";
import type { MatterPartyId } from "@magna-carta/identifiers/types";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  authErrors,
  directoryErrorResponse,
  mutationMeta,
  writeOptions,
  type DirectoryApp,
} from "./directory.ts";

// CHANGING THE ROLE A PARTY PLAYS ON A MATTER. A party who turns out to be the opposing party rather
// than a witness is the same person in a different part, so the act is a change of role rather than
// a delete and a fresh add. The domain function closes the old link and opens a new one in one
// batch, so a conflicts report that named the party in its old role stays reproducible; this route
// answers the new link's id.

const changeMatterPartyRoleRoute = defineOpenAPIRoute(
  mutationMeta("changeMatterPartyRole", "directory:edit"),
  {
    method: "patch",
    path: "/api/v1/directory/matter-parties/{id}",
    description:
      "Changes the role (and capacity) of one party link. The old link is severed and kept as " +
      "evidence and a new link opened in the new role, in one batch, so a conflicts report that " +
      "named the party in its old role stays reproducible. Answers the id of the new link; a link " +
      "that is not live reports 404.",
    request: {
      headers: idempotencyKeyHeader,
      params: z.object({ id: identifierField("matterParty") }),
      body: {
        content: { "application/json": { schema: ChangeMatterPartyRoleRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The link that now carries the role",
        content: { "application/json": { schema: MatterPartyResponse } },
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

export function registerMatterPartyRoleRoutes(app: DirectoryApp, chokepoint: Chokepoint): void {
  // PATCH /api/v1/directory/matter-parties/{id}
  app.openapi(
    {
      ...changeMatterPartyRoleRoute,
      middleware: chokepointMiddleware(chokepoint, changeMatterPartyRoleRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const replacement = await changeMatterPartyRole(
          firm.firmDatabase,
          id as MatterPartyId,
          { role: request.role, capacity: request.capacity ?? null },
          writeOptions(userId, idempotency),
        );
        if (replacement === null) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No live party link carries this id.",
          });
        }
        return c.json({ id: replacement } as z.infer<typeof MatterPartyResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );
}
