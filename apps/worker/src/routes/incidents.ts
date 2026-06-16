import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import { incidentCreated } from "@magna-carta/telemetry/events";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The user-initiated incident report — the "bug-report Worker" realized as one route in the single
// Worker. Body fields are id-and-action shaped (redacted by construction) except `description`, the
// user's words (firm boundary now; the protected() crypto module encrypts it when it lands).
// Bounded everywhere so a report cannot become an unbounded write.
const ReportIncidentRequest = z
  .object({
    // error_ handles the client correlates to its crash(es); may be empty ("nothing crashed but…").
    errorIds: z.array(z.string().regex(identifierPattern("error"))).max(10),
    // The client breadcrumb ring (never content — the client library enforces that when it ships).
    breadcrumbs: z
      .array(
        z.object({
          at: z.string().max(40),
          action: z.string().max(120),
          route: z.string().max(200),
        }),
      )
      .max(50),
    description: z.string().min(1).max(5000),
    context: z.object({
      route: z.string().max(200),
      appVersion: z.string().max(60),
      clientAt: z.string().max(40),
    }),
  })
  .openapi("ReportIncidentRequest");

const ReportIncidentResponse = z
  .object({ id: z.string(), status: z.string() })
  .openapi("ReportIncidentResponse");

// idempotency: "optional" — the chokepoint applies no idempotency gate to optional routes (a
// duplicate report is at worst a duplicate row; handler-managed replay on a supplied key is a named
// seam). audited: true — the incident row IS the durable record (the per-firm audit_log table is a
// slice 1·1 seam). firm:reportIncident is seeded onto every default role, so any member may report.
export const reportIncidentMeta: RouteMeta = {
  operationId: "incidents.report",
  surface: "app",
  authenticated: true,
  permission: "firm:reportIncident",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "incident-report",
};

export const reportIncidentRoute = defineOpenAPIRoute(reportIncidentMeta, {
  method: "post",
  path: "/api/v1/incidents",
  description:
    "Files a diagnostic incident from the session firm: writes the per-firm incident row and the " +
    "incident.created outbox row in one atomic batch (the diagnostics agent's future feed). Any " +
    "member may report; the description is the user's words, the rest is id-and-action shaped.",
  request: {
    body: { content: { "application/json": { schema: ReportIncidentRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded incident",
      content: { "application/json": { schema: ReportIncidentResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks firm:reportIncident",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session's firm is not reachable, or the session member is deactivated — absent, never an existence oracle",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The body failed validation (over-cap breadcrumbs/errorIds, empty description, …)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Registers POST /api/v1/incidents through the chokepoint. The handler runs only past
// session → firm → firm:reportIncident → rate-limit; the reporter and firm come from the chokepoint
// context, never client input.
export function registerIncidentsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...reportIncidentRoute,
      middleware: chokepointMiddleware(chokepoint, reportIncidentMeta, reportIncidentRoute),
    },
    async (c) => {
      const reportedBy = requireChokepointUserId(c);
      const { firmDatabase } = requireChokepointFirmContext(c);
      const request = c.req.valid("json");

      const incidentId = newIdentifier("incident");
      const now = new Date().toISOString();
      const errorIdCount = request.errorIds.length;

      // One atomic per-firm batch: the incident row + the incident.created outbox row (no consumer
      // yet — the relay sweeps it to the Queue; the diagnostics agent subscribes later). Optional
      // idempotency → no record (commitEffectBatch with no idempotencyRecord).
      await commitEffectBatch(
        firmDatabase,
        {
          statements: [
            firmDatabase
              .prepare(
                "INSERT INTO incident (id, error_ids, breadcrumbs, description, context, reported_by, created_at) " +
                  "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
              )
              .bind(
                incidentId,
                JSON.stringify(request.errorIds),
                JSON.stringify(request.breadcrumbs),
                request.description,
                JSON.stringify(request.context),
                reportedBy,
                now,
              ),
          ],
          outboxMessages: [{ topic: "incident.created", payload: { incidentId, errorIdCount } }],
        },
        { now: () => now },
      );

      c.get("logger")?.log(
        incidentCreated(
          { correlationId: c.get("correlationId") ?? "", now },
          { incidentId, errorIdCount },
        ),
      );

      return c.json({ id: incidentId, status: "open" }, 201);
    },
  );
}
