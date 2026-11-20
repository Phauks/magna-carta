/*
 * Magna Carta's view of the problem reports firms share with it.
 *
 * WHY THE PLATFORM-OPERATOR GUARD AND NOT A FIRM PERMISSION. The reader is outside every firm, so
 * the firm is named in the path and the authority is the platform's own, the lane the error lookup
 * runs in; `surface: "public"` only means the chokepoint does not resolve a firm from the session.
 *
 * WHAT THE FIRM AGREED TO. A report is listed only while its firm's switch is on, and only if it
 * was sent while the switch was on (shared_problem_report). The list carries redacted facts and no
 * words. Opening one report decrypts the sender's words and the answer under the firm key, with the
 * operator as the actor, so the decrypt audit row lands in the firm's own database where the firm
 * can see who read it.
 */
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { incidentDescription } from "@magna-carta/data-access/protected-field-registry";
import type { FirmId } from "@magna-carta/identifiers/types";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import {
  SharedProblemReportDetail,
  SharedProblemReportList,
} from "@magna-carta/data-access/incident-contract";
import { readIncident } from "@magna-carta/data-access/incident-statements";
import { incidentDetailOf } from "@magna-carta/data-access/incident-views";
import { isIncidentStatus } from "@magna-carta/data-access/incident-statements";
import type { ProtectedReadContext } from "@magna-carta/data-access/protected-fields";
import {
  selectSharedProblemReportStatement,
  selectSharedProblemReportsStatement,
  type SharedProblemReportRow,
} from "@magna-carta/data-access/shared-problem-report-statements";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { firmDatabaseFor } from "../../../firm-database/firm-database-proxy.ts";
import { firmKeyProviderForEnv } from "../../../firm-key-provider-wiring.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { imageResponse } from "../shared/image-bytes.ts";
import { platformOperatorGuard } from "../shared/platform-operator-guard.ts";

const reportParams = z.object({
  firmId: z.string().regex(identifierPattern("firm")),
  incidentId: z.string().regex(identifierPattern("incident")),
});

const refusals = {
  401: {
    description: "Not signed in",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "Not a platform operator, or 2FA not enabled",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
};

const notShared = {
  404: {
    description: "No such report, or its firm does not share it",
    content: { "application/problem+json": { schema: Problem } },
  },
};

function meta(operationId: string, audited: boolean): RouteMeta {
  return {
    operationId,
    surface: "public",
    authenticated: true,
    permission: null,
    resource: "firm",
    audited,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const listRoute = defineOpenAPIRoute(meta("platform.sharedProblemReports", false), {
  method: "get",
  path: "/api/v1/platform/problem-reports",
  description: "The problem reports firms share with Magna Carta, newest first. No words.",
  responses: {
    200: {
      description: "The shared reports",
      content: { "application/json": { schema: SharedProblemReportList } },
    },
    ...refusals,
  },
});

const getRoute = defineOpenAPIRoute(meta("platform.sharedProblemReport", true), {
  method: "get",
  path: "/api/v1/platform/problem-reports/{firmId}/{incidentId}",
  description:
    "One shared report in full. The words and the answer are opened through the audited read, " +
    "which the firm sees in its own record.",
  request: { params: reportParams },
  responses: {
    200: {
      description: "The report",
      content: { "application/json": { schema: SharedProblemReportDetail } },
    },
    ...refusals,
    ...notShared,
  },
});

const screenshotRoute = defineOpenAPIRoute(meta("platform.sharedProblemReportScreenshot", false), {
  method: "get",
  path: "/api/v1/platform/problem-reports/{firmId}/{incidentId}/screenshot",
  description: "The screenshot a shared report was sent with.",
  request: { params: reportParams },
  responses: {
    200: {
      description: "The image bytes",
      content: { "image/png": { schema: z.string() }, "image/jpeg": { schema: z.string() } },
    },
    ...refusals,
    ...notShared,
  },
});

function statusOf(value: string) {
  return isIncidentStatus(value) ? value : "open";
}

function notFound<C extends Parameters<typeof problemJson>[0]>(c: C) {
  return problemJson(c, { type: "not-found", title: "Not found", status: 404 });
}

/** The shared row, or undefined where it was never shared or the firm has stopped sharing. */
async function sharedRow(
  env: Bindings,
  firmId: string,
  incidentId: string,
): Promise<SharedProblemReportRow | undefined> {
  const row = await selectSharedProblemReportStatement(
    env.DB_CONTROL,
    firmId as FirmId,
    incidentId,
  ).first<SharedProblemReportRow>();
  return row ?? undefined;
}

export function registerSharedProblemReportRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  const guarded = [platformOperatorGuard as MiddlewareHandler];

  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute, guarded) },
    async (c) => {
      const { results } = await selectSharedProblemReportsStatement(
        c.env.DB_CONTROL,
      ).all<SharedProblemReportRow>();
      return c.json(
        {
          reports: results.map((row) => ({
            incidentId: row.incident_id,
            firmId: row.firm_id,
            firmName: row.firm_name,
            sentAt: row.sent_at,
            route: row.route,
            errorIdCount: row.error_id_count,
            status: statusOf(row.status),
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute, guarded) },
    async (c) => {
      const { firmId, incidentId } = c.req.valid("param");
      const shared = await sharedRow(c.env, firmId, incidentId);
      if (shared === undefined) return notFound(c);
      const database = firmDatabaseFor(c.env.FIRM_DATABASE, firmId);
      const row = await readIncident(database, incidentId);
      if (row === undefined) return notFound(c);
      // The firm agreed to this read by sharing, so the grant is made here for this one report,
      // after the shared row has been found, and audited in the firm's database like any other.
      const context: ProtectedReadContext = {
        firmId: firmId as FirmId,
        firmKeyVersion: 1,
        firmKeyProvider: firmKeyProviderForEnv(c.env),
        database,
        effectivePermissions: new Set([incidentDescription.permission]),
        actorUserId: c.get("platformOperatorUserId") ?? null,
        clock: { now: () => new Date().toISOString() },
        randomSource: cryptoRandomSource,
      };
      return c.json(
        { firmId, firmName: shared.firm_name, report: await incidentDetailOf(context, row) },
        200,
      );
    },
  );

  app.openapi(
    { ...screenshotRoute, middleware: chokepointMiddleware(chokepoint, screenshotRoute, guarded) },
    async (c) => {
      const { firmId, incidentId } = c.req.valid("param");
      const shared = await sharedRow(c.env, firmId, incidentId);
      if (shared === undefined) return notFound(c);
      const row = await readIncident(firmDatabaseFor(c.env.FIRM_DATABASE, firmId), incidentId);
      if (row === undefined || row.screenshot_key === null) return notFound(c);
      const { bucket } = resolveFirmBucket(c.env, shared.bucket_name);
      const contentType = row.screenshot_key.endsWith(".png") ? "image/png" : "image/jpeg";
      return (await imageResponse(bucket, row.screenshot_key, contentType)) ?? notFound(c);
    },
  );
}
