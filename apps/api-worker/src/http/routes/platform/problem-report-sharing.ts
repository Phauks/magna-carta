/*
 * The firm's switch for whether its problem reports also reach Magna Carta.
 *
 * Every member reads it, because the report dialog tells the sender who will read their words
 * before they send them. Whoever answers the firm's reports (incidents:viewDescription) turns it,
 * since they are the people who otherwise hear about a fault first. Turning it off withdraws every
 * report shared so far; turning it on shares only reports sent from then on.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ProblemReportSharing } from "@magna-carta/data-access/incident-contract";
import {
  firmSharesProblemReports,
  setFirmSharesProblemReportsStatements,
} from "@magna-carta/data-access/shared-problem-report-statements";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmId } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

const refusals = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the route's permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
};

function meta(
  operationId: string,
  permission: "firm:reportIncident" | "incidents:viewDescription",
  audited: boolean,
): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const getSharingRoute = defineOpenAPIRoute(
  meta("incidents.getSharing", "firm:reportIncident", false),
  {
    method: "get",
    path: "/api/v1/incidents/sharing",
    description: "Whether the firm's problem reports also reach Magna Carta.",
    responses: {
      200: {
        description: "The firm's switch",
        content: { "application/json": { schema: ProblemReportSharing } },
      },
      ...refusals,
    },
  },
);

const setSharingRoute = defineOpenAPIRoute(
  meta("incidents.setSharing", "incidents:viewDescription", true),
  {
    method: "put",
    path: "/api/v1/incidents/sharing",
    description:
      "Turns sharing with Magna Carta on or off. Off withdraws every report shared so far; on " +
      "shares reports sent from now on.",
    request: {
      body: { content: { "application/json": { schema: ProblemReportSharing } }, required: true },
    },
    responses: {
      200: {
        description: "The firm's switch, as set",
        content: { "application/json": { schema: ProblemReportSharing } },
      },
      ...refusals,
      422: {
        description: "The body failed validation",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

export function registerProblemReportSharingRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...getSharingRoute, middleware: chokepointMiddleware(chokepoint, getSharingRoute) },
    async (c) => {
      const shares = await firmSharesProblemReports(c.env.DB_CONTROL, requireChokepointFirmId(c));
      return c.json({ sharesWithMagnaCarta: shares }, 200);
    },
  );

  app.openapi(
    { ...setSharingRoute, middleware: chokepointMiddleware(chokepoint, setSharingRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const { sharesWithMagnaCarta } = c.req.valid("json");
      // One batch, so turning it off never leaves the switch off and the shared reports listed.
      await c.env.DB_CONTROL.batch(
        setFirmSharesProblemReportsStatements(
          c.env.DB_CONTROL,
          firmId,
          sharesWithMagnaCarta,
        ) as unknown as D1PreparedStatement[],
      );
      return c.json({ sharesWithMagnaCarta }, 200);
    },
  );
}
