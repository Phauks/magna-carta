import { type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  cancelRunStatement,
  readNumberedCheckByAnyId,
  readRun,
  reportedRunStatus,
} from "@magna-carta/conflicts/check-run";
import { CancelledRun } from "@magna-carta/conflicts/contract";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierPathParam, idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";

// What a member can do to a run while it is in flight: stop it.
//
// Kept beside conflicts.ts rather than inside it, so the check surface's main module does not grow
// with every act a run gains.

type ConflictsRunsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const runIdParam = z.object({
  checkId: identifierPathParam("conflictsCheck", "checkId"),
  runId: identifierPathParam("conflictsCheck", "runId"),
});

const CancelledRunResponse = CancelledRun.openapi("ConflictsCancelledRun");

const cancelRunRoute = defineOpenAPIRoute(
  {
    operationId: "conflicts.cancelRun",
    surface: "app",
    authenticated: true,
    permission: "conflicts:run",
    resource: "firm",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  },
  {
    method: "post",
    path: "/api/v1/conflicts/checks/{checkId}/runs/{runId}/cancel",
    description:
      "Stops a run that has not finished. The run is kept in the check's history as cancelled, " +
      "naming who stopped it, and records no result: whatever it had not finished is not searched. " +
      "A run that had already settled is left exactly as it settled, and the answer says how.",
    request: { headers: idempotencyKeyHeader, params: runIdParam },
    responses: {
      200: {
        description: "The run as it now stands",
        content: { "application/json": { schema: CancelledRunResponse } },
      },
      400: problem("Missing Idempotency-Key (this operation requires one)"),
      401: problem("No valid session"),
      403: problem("The session member lacks the required permission"),
      404: problem("The firm is unreachable, the member is deactivated, or the run is unknown"),
      409: problem("A request with this Idempotency-Key is still in progress"),
      422: problem(
        "The request is invalid, or the Idempotency-Key was reused with a different payload",
      ),
      429: problem("Rate limit exceeded"),
    },
  },
);

function notFound(c: Context, detail: string): ProblemResponse<404> {
  return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail });
}

export function registerConflictsRunRoutes(app: ConflictsRunsApp, chokepoint: Chokepoint): void {
  // POST /api/v1/conflicts/checks/{checkId}/runs/{runId}/cancel
  app.openapi(
    { ...cancelRunRoute, middleware: chokepointMiddleware(chokepoint, cancelRunRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const { checkId, runId } = c.req.valid("param");
      const numbered = await readNumberedCheckByAnyId(firm.firmDatabase, checkId);
      if (numbered === null) return notFound(c, "No such conflicts check in this firm.");
      const run = await readRun(firm.firmDatabase, runId);
      if (run === null || run.numbered_check_id !== numbered.id) {
        return notFound(c, "No such run of this conflicts check.");
      }
      // A plain guarded update rather than an effect batch: it moves one mutable row, and a repeat
      // finds the run already settled and changes nothing. The chokepoint still requires the key so
      // a replay is recognised.
      await cancelRunStatement(
        firm.firmDatabase,
        run.id,
        actorUserId,
        new Date().toISOString(),
      ).run();
      const settled = (await readRun(firm.firmDatabase, run.id)) ?? run;
      return c.json(
        { id: run.id, status: reportedRunStatus(settled) } as z.infer<typeof CancelledRunResponse>,
        200,
      );
    },
  );
}
