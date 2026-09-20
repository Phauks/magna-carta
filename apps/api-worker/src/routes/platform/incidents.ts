import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { incidentDescription } from "@magna-carta/data-access/protected-field-registry";
import { composeProtectedWrite } from "@magna-carta/data-access/protected-fields";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import { incidentCreated } from "@magna-carta/telemetry/events";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { firmKeyProviderForEnv } from "../../firm-key-provider-wiring.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The user-initiated incident report — the "bug-report Worker" realized as one route in the single
// Worker. Body fields are id-and-action shaped (redacted by construction) except `description`, the
// user's words — sealed into description_ciphertext under the firm key through the protected-field
// chokepoint (encrypted-only: the plaintext column is written NULL), readable only with an audited
// incidents:viewDescription decrypt. Bounded everywhere so a report cannot become an unbounded write.
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
      /*
       * What the deployment was doing, when the reporter filed from a surface that knew — today the
       * header's Build Information panel, which reads the fleet, the firm's database and the upload
       * preconditions and can hand its whole diagnosis to the report rather than making the reporter
       * paste it. Redacted by construction like every other field here: it carries Worker names,
       * commits, states and timings, and no firm content of any kind. Bounded so a report cannot
       * become an unbounded write, and optional because most surfaces have nothing to put in it.
       */
      deployment: z.string().max(4000).optional(),
    }),
  })
  .openapi("ReportIncidentRequest");

const ReportIncidentResponse = z
  .object({ id: z.string(), status: z.string() })
  .openapi("ReportIncidentResponse");

// The per-firm outbox topic a filed incident publishes. Named here rather than at the write site
// because something now subscribes to it, and a subscriber that spells a topic itself is a
// subscriber that can spell it differently — silently, because an unrecognized topic on the
// per-firm bus is acked and ignored by design, so a typo does not throw, it just stops delivering.
// Every other producer exports its topics from its own domain package; the incident write path has
// no domain package to put this in, so it lives beside the route that emits it and the notification
// registry's spelling is pinned against it by test.
export const INCIDENT_CREATED_TOPIC = "incident.created";

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
      middleware: chokepointMiddleware(chokepoint, reportIncidentRoute),
    },
    async (c) => {
      const reportedBy = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const { firmDatabase } = requireChokepointFirmContext(c);
      const request = c.req.valid("json");

      const incidentId = newIdentifier("incident");
      const now = new Date().toISOString();
      const errorIdCount = request.errorIds.length;

      // Seal the user's words under the firm key, bound to this incident row (the AAD carries the
      // incident id), BEFORE the batch — encrypted-only: the plaintext `description` column is
      // written NULL. firm_key_version 1 (the only version this slice mints).
      const sealedDescription = await composeProtectedWrite(
        { firmId, firmKeyVersion: 1, firmKeyProvider: firmKeyProviderForEnv(c.env) },
        incidentDescription,
        incidentId,
        request.description,
      );

      // One atomic per-firm batch: the incident row + the incident.created outbox row (no consumer
      // yet — the relay sweeps it to the Queue; the diagnostics agent subscribes later). Optional
      // idempotency → no record (commitEffectBatch with no idempotencyRecord).
      await commitEffectBatch(
        firmDatabase,
        {
          statements: [
            firmDatabase
              .prepare(
                "INSERT INTO incident (id, error_ids, breadcrumbs, description, description_ciphertext, context, reported_by, created_at) " +
                  "VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)",
              )
              .bind(
                incidentId,
                JSON.stringify(request.errorIds),
                JSON.stringify(request.breadcrumbs),
                sealedDescription.ciphertextValue,
                JSON.stringify(request.context),
                reportedBy,
                now,
              ),
          ],
          outboxMessages: [
            { topic: INCIDENT_CREATED_TOPIC, payload: { incidentId, errorIdCount } },
          ],
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
