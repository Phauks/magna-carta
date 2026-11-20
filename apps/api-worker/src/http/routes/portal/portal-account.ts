import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { selectPersonStatement } from "@magna-carta/directory/statements";
import type { DirectoryPersonId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointPortalClient,
  requireChokepointPortalFirmClient,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// THE CLIENT'S OWN SIDE OF THE PORTAL: who they are, and the firms that share with them. Both routes
// are on the portal lane, so neither ever sees a member row or a firm the client was not invited to.

const PortalFirm = z
  .object({
    firmId: z.string(),
    firmName: z.string(),
  })
  .openapi("PortalFirm");

const PortalAccountResponse = z
  .object({
    name: z.string(),
    email: z.string(),
    firms: z.array(PortalFirm),
  })
  .openapi("PortalAccount");

const PortalFirmResponse = z
  .object({
    firmId: z.string(),
    firmName: z.string(),
    // The Directory person the firm knows this client as, by the name the firm keeps for them.
    personName: z.string(),
  })
  .openapi("PortalFirmDetail");

const portalAccountMeta: RouteMeta = {
  operationId: "portal.account",
  surface: "portal",
  authenticated: true,
  permission: null,
  resource: "portalShare",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
  principals: ["portalUser"],
  portalScope: "account",
};

export const portalAccountRoute = defineOpenAPIRoute(portalAccountMeta, {
  method: "get",
  path: "/api/portal/v1/account",
  description:
    "The signed-in client and the firms that share with them. Only a portal client reaches it; " +
    "anyone else is answered as if the route did not exist.",
  responses: {
    200: {
      description: "The client and their firms",
      content: { "application/json": { schema: PortalAccountResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The session is not a portal client's",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const portalFirmMeta: RouteMeta = {
  operationId: "portal.firm",
  surface: "portal",
  authenticated: true,
  permission: null,
  resource: "portalShare",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
  principals: ["portalUser"],
  portalScope: "firm",
};

export const portalFirmRoute = defineOpenAPIRoute(portalFirmMeta, {
  method: "get",
  path: "/api/portal/v1/firms/{firmId}",
  description:
    "One firm that shares with the signed-in client, and the name it knows them by. A firm the " +
    "client holds no active portal access to is answered as absent.",
  request: { params: z.object({ firmId: z.string().min(1) }) },
  responses: {
    200: {
      description: "The firm",
      content: { "application/json": { schema: PortalFirmResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "No such firm, the client's access to it has ended, or the session is not a portal " +
        "client's (one answer for all three)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerPortalAccountRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...portalAccountRoute, middleware: chokepointMiddleware(chokepoint, portalAccountRoute) },
    async (c) => {
      const client = requireChokepointPortalClient(c);
      const [user, firms] = await Promise.all([
        c.env.DB_CONTROL.prepare('SELECT name, email FROM "user" WHERE id = ?1')
          .bind(client.principalId)
          .first<{ name: string; email: string }>(),
        c.env.DB_CONTROL.prepare(
          "SELECT f.id AS firm_id, COALESCE(f.display_name, f.name) AS firm_name " +
            "FROM portal_membership m JOIN firm f ON f.id = m.firm_id " +
            "WHERE m.principal_id = ?1 AND m.status = 'active' AND f.status = 'active' " +
            "ORDER BY firm_name",
        )
          .bind(client.principalId)
          .all<{ firm_id: string; firm_name: string }>(),
      ]);
      if (user === null) throw new Error("portal client's own user row is missing");
      return c.json(
        {
          name: user.name,
          email: user.email,
          firms: firms.results.map((row) => ({ firmId: row.firm_id, firmName: row.firm_name })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...portalFirmRoute, middleware: chokepointMiddleware(chokepoint, portalFirmRoute) },
    async (c) => {
      const client = requireChokepointPortalFirmClient(c);
      const firm = await c.env.DB_CONTROL.prepare(
        "SELECT COALESCE(display_name, name) AS firm_name FROM firm WHERE id = ?1",
      )
        .bind(client.firmId)
        .first<{ firm_name: string }>();
      const { firmDatabase } = requireChokepointFirmContext(c);
      const person = await selectPersonStatement(
        firmDatabase,
        client.directoryEntityId as DirectoryPersonId,
      ).first<{ display_name: string }>();
      if (firm === null) throw new Error("the lane admitted a firm whose row is missing");
      return c.json(
        {
          firmId: client.firmId,
          firmName: firm.firm_name,
          personName: person?.display_name ?? "",
        },
        200,
      );
    },
  );
}
