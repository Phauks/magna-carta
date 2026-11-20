import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { KnownPermission } from "@magna-carta/access-control/registry";
import {
  leaveRecordPresence,
  touchRecordPresence,
} from "@magna-carta/data-access/record-presence-statements";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";

// WHO ELSE IS HERE, served for one kind of record. Any screen whose record several people may work
// on at once mounts these two routes under the record's own path, with the permission that reads the
// record, so the question "who else has this open" is never easier to ask than reading the record
// itself. The rows are @magna-carta/data-access's (src/record-presence-statements.ts).
//
//   POST   {record}/presence  — "I have this open": touch, and answer who else does
//   DELETE {record}/presence  — "I have left": take the member off at once
//
// Neither is audited: a touch every few seconds would bury the firm's log, and the fact it records
// is gone within the minute by design.

export const PresentMemberRecord = z
  .object({
    userId: z.string(),
    name: z.string(),
    seenAt: z.string().meta({ description: "When they last touched, as an ISO-8601 instant." }),
  })
  .meta({ id: "PresentMember" });

export const RecordPresenceResponse = z
  .object({ others: z.array(PresentMemberRecord) })
  .meta({ id: "RecordPresence" });

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

/** One kind of record whose presence a module serves. */
export interface RecordPresenceSurface<Parameters extends z.ZodObject> {
  /** The record kind as stored, e.g. "trust_bank_reconciliation". */
  readonly recordKind: string;
  /** The record's own path, with its id parameter, e.g. "/api/v1/trust/bank-reconciliations/{reconciliationId}". */
  readonly recordPath: string;
  readonly parameters: Parameters;
  /** Which path parameter is the record's id. */
  readonly idParameter: keyof z.infer<Parameters> & string;
  /** The operation prefix the module's other routes use, e.g. "trust". */
  readonly operationPrefix: string;
  /** The record's name in an operation id, e.g. "BankReconciliation". */
  readonly operationNoun: string;
  /** The permission that reads the record. */
  readonly permission: KnownPermission;
  /** Whether the record exists in the firm. A presence on a record that does not is refused 404. */
  readonly exists: (
    firmDatabase: ReturnType<typeof requireChokepointFirmContext>["firmDatabase"],
    recordId: string,
  ) => Promise<boolean>;
}

function meta(operationId: string, permission: KnownPermission): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export function registerRecordPresenceRoutes<Parameters extends z.ZodObject>(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  surface: RecordPresenceSurface<Parameters>,
): void {
  const path = `${surface.recordPath}/presence`;
  const touchRoute = defineOpenAPIRoute(
    meta(`${surface.operationPrefix}.touch${surface.operationNoun}Presence`, surface.permission),
    {
      method: "post",
      path,
      description:
        "Says the member has this record open now, and answers who else has opened it in the last 30 seconds. A screen calls it every few seconds while the record is in view.",
      request: { params: surface.parameters },
      responses: {
        200: {
          description: "Who else is here",
          content: { "application/json": { schema: RecordPresenceResponse } },
        },
        401: problem("No valid session"),
        403: problem("The session member cannot read this record"),
        404: problem("The record is unknown"),
        422: problem("The record id is malformed"),
        429: problem("Rate limit exceeded"),
      },
    },
  );
  const touchOperation = `${surface.operationPrefix}.touch${surface.operationNoun}Presence`;
  const leaveRoute = defineOpenAPIRoute(
    {
      ...meta(
        `${surface.operationPrefix}.leave${surface.operationNoun}Presence`,
        surface.permission,
      ),
      // Coming back to the record is the touch again.
      reversal: { kind: "inverse", by: touchOperation },
    },
    {
      method: "delete",
      path,
      description: "Says the member has left this record, so others stop seeing them at once.",
      request: { params: surface.parameters },
      responses: {
        204: { description: "Left" },
        401: problem("No valid session"),
        403: problem("The session member cannot read this record"),
        422: problem("The record id is malformed"),
        429: problem("Rate limit exceeded"),
      },
    },
  );

  const recordOf = (recordId: string) => ({ recordKind: surface.recordKind, recordId });

  app.openapi(
    { ...touchRoute, middleware: chokepointMiddleware(chokepoint, touchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const recordId = c.req.param(surface.idParameter) ?? "";
      if (!(await surface.exists(firm.firmDatabase, recordId))) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such record.",
        });
      }
      const others = await touchRecordPresence(
        firm.firmDatabase,
        recordOf(recordId),
        requireChokepointUserId(c),
        new Date().toISOString(),
      );
      return c.json(
        {
          others: others.map((member) => ({
            userId: member.userId,
            name: member.displayName,
            seenAt: member.seenAt,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...leaveRoute, middleware: chokepointMiddleware(chokepoint, leaveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      await leaveRecordPresence(
        firm.firmDatabase,
        recordOf(c.req.param(surface.idParameter) ?? ""),
        requireChokepointUserId(c),
      );
      return c.body(null, 204);
    },
  );
}
