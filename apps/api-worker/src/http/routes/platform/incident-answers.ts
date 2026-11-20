import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import { commitEffectBatch, GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import {
  AnswerIncidentRequest,
  AttachIncidentScreenshotRequest,
  IncidentDetail,
  IncidentList,
  MAX_INCIDENT_SCREENSHOT_BYTES,
} from "@magna-carta/data-access/incident-contract";
import { incidentDetailOf, incidentSummaryOf } from "@magna-carta/data-access/incident-views";
import {
  answerIncidentStatement,
  INCIDENT_ANSWERED_TOPIC,
  incidentScreenshotObjectKey,
  readIncident,
  recordIncidentScreenshotStatement,
  reporterReadContext,
  selectIncidentsReportedByStatement,
  selectIncidentsStatement,
  type IncidentRow,
} from "@magna-carta/data-access/incident-statements";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { protectedReadContext } from "../../../protected-read-context.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { decodeBase64, imageResponse } from "../shared/image-bytes.ts";

/*
 * Answering a problem report, and the reporter hearing back.
 *
 * WHO READS WHAT. A report is a firm's own record: the reporter's words and the answerer's note are
 * sealed under the firm key, and the screenshot is in the firm's own bucket. Whoever holds
 * incidents:viewDescription reads every report and answers it. The person who filed a report reads
 * their OWN reports through the `mine` routes, with firm:reportIncident, which every role carries;
 * the decrypt grant for that one row is made in `reporterReadContext`, after the row's author is
 * checked, and is audited like any other. Somebody else's report on a `mine` route is not found,
 * never forbidden, so the routes do not say which reports exist.
 *
 * THE ANSWER IS ONE BATCH: the status, who set it and when, the sealed note, and the
 * `incident.answered` outbox row the reporter's notification rides. The note never travels in the
 * outbox payload; the notification says only the status and whether a note came with it.
 *
 * THE SCREENSHOT is written once, by the reporter, after the report: the dialog files the report
 * first so the words arrive even if the picture does not. The covered parts were painted out on the
 * reporter's device before upload, so nothing here sees what was covered. Only a PNG or JPEG the
 * bytes themselves say they are is kept, up to MAX_INCIDENT_SCREENSHOT_BYTES.
 */

const incidentParam = z.object({
  incidentId: z.string().regex(identifierPattern("incident")),
});

const errors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the route's permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "No such report in this firm, or not one this member filed",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
};

function meta(
  operationId: string,
  permission: "incidents:viewDescription" | "firm:reportIncident",
  audited = false,
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

const listIncidentsRoute = defineOpenAPIRoute(meta("incidents.list", "incidents:viewDescription"), {
  method: "get",
  path: "/api/v1/incidents",
  description:
    "The firm's problem reports, newest first, for whoever answers them. Each row opens the " +
    "reporter's words through the audited decrypt, so the list is capped.",
  responses: {
    200: { description: "The reports", content: { "application/json": { schema: IncidentList } } },
    ...errors,
  },
});

const getIncidentRoute = defineOpenAPIRoute(meta("incidents.get", "incidents:viewDescription"), {
  method: "get",
  path: "/api/v1/incidents/{incidentId}",
  description: "One problem report in full, for whoever answers it.",
  request: { params: incidentParam },
  responses: {
    200: { description: "The report", content: { "application/json": { schema: IncidentDetail } } },
    ...errors,
  },
});

const answerIncidentRoute = defineOpenAPIRoute(
  meta("incidents.answer", "incidents:viewDescription", true),
  {
    method: "patch",
    path: "/api/v1/incidents/{incidentId}",
    description:
      "Sets a report's status, with an optional note to the person who sent it, and tells them. " +
      "The note is sealed under the firm key; the notification carries only the status.",
    request: {
      params: incidentParam,
      body: { content: { "application/json": { schema: AnswerIncidentRequest } }, required: true },
    },
    responses: {
      200: {
        description: "The answered report",
        content: { "application/json": { schema: IncidentDetail } },
      },
      ...errors,
      422: {
        description: "The body failed validation",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

const getIncidentScreenshotRoute = defineOpenAPIRoute(
  meta("incidents.screenshot", "incidents:viewDescription"),
  {
    method: "get",
    path: "/api/v1/incidents/{incidentId}/screenshot",
    description: "The screenshot a report was sent with, for whoever answers it.",
    request: { params: incidentParam },
    responses: {
      200: {
        description: "The image bytes",
        content: { "image/png": { schema: z.string() }, "image/jpeg": { schema: z.string() } },
      },
      ...errors,
    },
  },
);

const listMyIncidentsRoute = defineOpenAPIRoute(meta("incidents.listMine", "firm:reportIncident"), {
  method: "get",
  path: "/api/v1/incidents/mine",
  description: "The reports the session member sent, newest first, with each one's status.",
  responses: {
    200: {
      description: "The member's reports",
      content: { "application/json": { schema: IncidentList } },
    },
    ...errors,
  },
});

const getMyIncidentRoute = defineOpenAPIRoute(meta("incidents.getMine", "firm:reportIncident"), {
  method: "get",
  path: "/api/v1/incidents/mine/{incidentId}",
  description: "One report the session member sent, with its status and any note.",
  request: { params: incidentParam },
  responses: {
    200: { description: "The report", content: { "application/json": { schema: IncidentDetail } } },
    ...errors,
  },
});

const getMyIncidentScreenshotRoute = defineOpenAPIRoute(
  meta("incidents.screenshotMine", "firm:reportIncident"),
  {
    method: "get",
    path: "/api/v1/incidents/mine/{incidentId}/screenshot",
    description: "The screenshot the session member sent with one of their reports.",
    request: { params: incidentParam },
    responses: {
      200: {
        description: "The image bytes",
        content: { "image/png": { schema: z.string() }, "image/jpeg": { schema: z.string() } },
      },
      ...errors,
    },
  },
);

const attachIncidentScreenshotRoute = defineOpenAPIRoute(
  {
    ...meta("incidents.attachScreenshot", "firm:reportIncident", true),
    // A four-megabyte write: the expensive budget, not the report budget, so three reports sent
    // with pictures do not spend six of the five report slots.
    rateLimit: "expensive",
  },
  {
    method: "put",
    path: "/api/v1/incidents/mine/{incidentId}/screenshot",
    description:
      "Attaches the screenshot to a report the session member just sent. Once only: a report " +
      "that already has one answers 409. The covered parts were painted out before upload.",
    request: {
      params: incidentParam,
      body: {
        content: { "application/json": { schema: AttachIncidentScreenshotRequest } },
        required: true,
      },
    },
    responses: {
      204: { description: "Attached" },
      ...errors,
      409: {
        description: "The report already has a screenshot",
        content: { "application/problem+json": { schema: Problem } },
      },
      422: {
        description: "Not a PNG or JPEG, or too large",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

function screenshotContentType(objectKey: string): string {
  return objectKey.endsWith(".png") ? "image/png" : "image/jpeg";
}

function alreadyAttached<C extends Parameters<typeof problemJson>[0]>(c: C) {
  return problemJson(c, {
    type: "conflict",
    title: "Already attached",
    status: 409,
    detail: "This report already has a screenshot.",
  });
}

function notFound<C extends Parameters<typeof problemJson>[0]>(c: C) {
  return problemJson(c, { type: "not-found", title: "Not found", status: 404 });
}

export function registerIncidentAnswerRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // The member's own routes register before the {incidentId} routes, so "mine" is never read as an id.
  app.openapi(
    { ...listMyIncidentsRoute, middleware: chokepointMiddleware(chokepoint, listMyIncidentsRoute) },
    async (c) => {
      const { firmDatabase } = requireChokepointFirmContext(c);
      const context = protectedReadContext(c);
      const { results } = await selectIncidentsReportedByStatement(
        firmDatabase,
        requireChokepointUserId(c),
      ).all<IncidentRow>();
      const incidents = [];
      for (const row of results) {
        const own = reporterReadContext(context, row);
        if (own !== null) incidents.push(await incidentSummaryOf(own, row));
      }
      return c.json({ incidents }, 200);
    },
  );

  app.openapi(
    { ...getMyIncidentRoute, middleware: chokepointMiddleware(chokepoint, getMyIncidentRoute) },
    async (c) => {
      const { firmDatabase } = requireChokepointFirmContext(c);
      const row = await readIncident(firmDatabase, c.req.valid("param").incidentId);
      const own = row === undefined ? null : reporterReadContext(protectedReadContext(c), row);
      if (row === undefined || own === null) return notFound(c);
      return c.json(await incidentDetailOf(own, row), 200);
    },
  );

  app.openapi(
    {
      ...getMyIncidentScreenshotRoute,
      middleware: chokepointMiddleware(chokepoint, getMyIncidentScreenshotRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const row = await readIncident(firm.firmDatabase, c.req.valid("param").incidentId);
      if (row === undefined || row.reported_by !== requireChokepointUserId(c)) return notFound(c);
      if (row.screenshot_key === null) return notFound(c);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const response = await imageResponse(
        bucket,
        row.screenshot_key,
        screenshotContentType(row.screenshot_key),
      );
      return response ?? notFound(c);
    },
  );

  app.openapi(
    {
      ...attachIncidentScreenshotRoute,
      middleware: chokepointMiddleware(chokepoint, attachIncidentScreenshotRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const row = await readIncident(firm.firmDatabase, c.req.valid("param").incidentId);
      if (row === undefined || row.reported_by !== requireChokepointUserId(c)) return notFound(c);
      if (row.screenshot_key !== null) return alreadyAttached(c);
      const bytes = decodeBase64(c.req.valid("json").imageBase64);
      if (bytes === undefined || bytes.byteLength > MAX_INCIDENT_SCREENSHOT_BYTES) {
        return problemJson(c, {
          type: "validation",
          title: "Not a usable screenshot",
          status: 422,
          detail:
            bytes === undefined ? "The image is not valid base64." : "The screenshot is too large.",
        });
      }
      const facts = readImageFacts(bytes);
      if (!facts.ok) {
        return problemJson(c, {
          type: "validation",
          title: "Not a usable screenshot",
          status: 422,
          detail: facts.detail,
        });
      }
      const objectKey = incidentScreenshotObjectKey(
        row.id,
        crypto.randomUUID(),
        facts.value.extension,
      );
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      // The object before the row that points at it: an unreferenced object is a cost, a row
      // pointing at nothing is a report whose answerer sees a broken picture.
      await bucket.put(objectKey, bytes as unknown as ArrayBuffer, {
        httpMetadata: { contentType: facts.value.contentType },
        customMetadata: firmScopedObjectDimensions("incident-screenshot"),
      });
      try {
        await commitEffectBatch(
          firm.firmDatabase,
          {
            statements: [recordIncidentScreenshotStatement(firm.firmDatabase, row.id, objectKey)],
            outboxMessages: [],
          },
          { now: () => new Date().toISOString() },
        );
      } catch (caught) {
        if (!(caught instanceof GuardedWriteRefusedError)) throw caught;
        // Another upload for this report landed between the read above and this write.
        await bucket.delete(objectKey);
        return alreadyAttached(c);
      }
      return c.body(null, 204);
    },
  );

  app.openapi(
    { ...listIncidentsRoute, middleware: chokepointMiddleware(chokepoint, listIncidentsRoute) },
    async (c) => {
      const { firmDatabase } = requireChokepointFirmContext(c);
      const context = protectedReadContext(c);
      const { results } = await selectIncidentsStatement(firmDatabase).all<IncidentRow>();
      const incidents = [];
      for (const row of results) incidents.push(await incidentSummaryOf(context, row));
      return c.json({ incidents }, 200);
    },
  );

  app.openapi(
    { ...getIncidentRoute, middleware: chokepointMiddleware(chokepoint, getIncidentRoute) },
    async (c) => {
      const { firmDatabase } = requireChokepointFirmContext(c);
      const row = await readIncident(firmDatabase, c.req.valid("param").incidentId);
      if (row === undefined) return notFound(c);
      return c.json(await incidentDetailOf(protectedReadContext(c), row), 200);
    },
  );

  app.openapi(
    { ...answerIncidentRoute, middleware: chokepointMiddleware(chokepoint, answerIncidentRoute) },
    async (c) => {
      const { firmDatabase } = requireChokepointFirmContext(c);
      const incidentId = c.req.valid("param").incidentId;
      const row = await readIncident(firmDatabase, incidentId);
      if (row === undefined) return notFound(c);
      const { status, note } = c.req.valid("json");
      const kept = note === undefined || note === null || note === "" ? null : note;
      const context = protectedReadContext(c);
      const answeredBy = requireChokepointUserId(c);
      const now = context.clock.now();
      await commitEffectBatch(
        firmDatabase,
        {
          statements: [
            await answerIncidentStatement(firmDatabase, context, {
              incidentId,
              status,
              note: kept,
              answeredBy,
              now,
            }),
          ],
          outboxMessages: [
            {
              topic: INCIDENT_ANSWERED_TOPIC,
              payload: { incidentId, reportedBy: row.reported_by, status, noted: kept !== null },
            },
          ],
        },
        { now: () => now },
      );
      const answered = await readIncident(firmDatabase, incidentId);
      if (answered === undefined) return notFound(c);
      return c.json(await incidentDetailOf(context, answered), 200);
    },
  );

  app.openapi(
    {
      ...getIncidentScreenshotRoute,
      middleware: chokepointMiddleware(chokepoint, getIncidentScreenshotRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const row = await readIncident(firm.firmDatabase, c.req.valid("param").incidentId);
      if (row === undefined || row.screenshot_key === null) return notFound(c);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const response = await imageResponse(
        bucket,
        row.screenshot_key,
        screenshotContentType(row.screenshot_key),
      );
      return response ?? notFound(c);
    },
  );
}
