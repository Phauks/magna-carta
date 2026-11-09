import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  resolveScopedSetting,
  writeScopedSettingStatement,
} from "@magna-carta/data-access/scoped-setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  incrementMinutesDefinition,
  roundingDirectionDefinition,
} from "@magna-carta/timekeeping/settings";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// THE FIRM'S TIME-CAPTURE POLICY — the increment a captured duration rounds to, and the direction
// it rounds in. Two settings a firm decides once and every unbilled hour is measured by.
//
// THE FIRM TIER, AND ONLY THE FIRM TIER. Both keys are scope-overridable: a matter, a client, a
// timekeeper or a location may carry its own value, and the resolver walks most-specific-first. This
// route reads and writes the FIRM row and nothing else, so an administrator setting the firm to
// quarter hours does not silently reach into a matter somebody deliberately pinned to tenths.
//
// WHY THIS IS NOT `GET /api/v1/time-entries/rounding-policy`. That route answers a different
// question — what will happen to THIS capture, resolved through the whole scope chain for a given
// matter and timekeeper — and it rides `time:track`, because every member capturing time needs the
// answer. A settings screen needs the firm's own value: the one it is about to overwrite, which
// equals the resolved one only when no override exists. Two questions, two reads; collapsing them
// would leave a settings page showing a matter's override as though it were the firm's rule.

const PERMISSION = "time:manageSettings" as const;

const FirmTimePolicyResponse = z
  .object({
    incrementMinutes: z
      .number()
      .int()
      .positive()
      .openapi({
        description:
          "The firm's minimum billing increment: what a captured duration rounds TO, in minutes. " +
          "Six — a tenth of an hour — is the prevailing default. It is also what one BILLING UNIT " +
          "is worth, so a firm on quarter hours and a firm on tenths mean different amounts of " +
          "work by the same number of units.",
      }),
    roundingDirection: z.enum(["up", "nearest", "down"]).openapi({
      description: "How the firm resolves a duration that falls between increments.",
    }),
  })
  .openapi("FirmTimePolicyResponse");

const PatchFirmTimePolicyRequest = z
  .object({
    // Sparse: an absent field is unchanged, and an empty patch writes nothing and audits nothing.
    incrementMinutes: z
      .number()
      .int()
      .positive()
      // An hour is the coarsest increment any firm bills at, and the bound is here rather than only
      // on the screen so a caller gets an answer it can act on instead of a stored value that would
      // round a six-minute call up to a working day.
      .max(60)
      .optional(),
    roundingDirection: z.enum(["up", "nearest", "down"]).optional(),
  })
  .openapi("PatchFirmTimePolicyRequest");

const errorResponses = {
  400: {
    description: "The Idempotency-Key header is missing on a write",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks time:manageSettings",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is already in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The increment is not a whole number of minutes between 1 and 60, the direction is not one " +
      "of the three, or the Idempotency-Key was reused with a different body",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const getMeta: RouteMeta = {
  operationId: "firmTimePolicy.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "firmTimePolicy.update",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Audited: every unbilled hour after the change is measured differently from every hour before
  // it, and a later "why does this invoice round like that" turns on who changed it and when. The
  // metadata is a whole number and a closed enum; nothing a person typed.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/time-policy",
  description:
    "Reads the firm's own time-capture policy: the increment a captured duration rounds to and " +
    "the direction it rounds in. This is the FIRM tier — the value a matter, client, timekeeper " +
    "or location override would sit above. To ask what a particular capture will actually be " +
    "billed at, read the resolved policy from the time-entries surface instead.",
  responses: {
    200: {
      description: "The firm's time-capture policy",
      content: { "application/json": { schema: FirmTimePolicyResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/time-policy",
  description:
    "Updates the firm's time-capture policy. Sparse: an absent field is left alone, and an empty " +
    "patch changes nothing and records nothing. Time already captured keeps the rounding it was " +
    "recorded under; the new policy applies to what is captured after it. Returns the policy " +
    "after the write.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: PatchFirmTimePolicyRequest } },
    },
  },
  responses: {
    200: {
      description: "The firm's time-capture policy after the write",
      content: { "application/json": { schema: FirmTimePolicyResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

type PolicyApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type PolicyBody = z.infer<typeof FirmTimePolicyResponse>;

// An empty scope context consults the firm tier and the in-code default, and nothing else — which is
// exactly the row this surface owns.
async function readFirmTimePolicy(database: SqlDatabase): Promise<PolicyBody> {
  const [incrementMinutes, roundingDirection] = await Promise.all([
    resolveScopedSetting(database, incrementMinutesDefinition, {}),
    resolveScopedSetting(database, roundingDirectionDefinition, {}),
  ]);
  return { incrementMinutes, roundingDirection };
}

export function registerFirmTimePolicyRoutes(app: PolicyApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(await readFirmTimePolicy(firm.firmDatabase), 200);
    },
  );

  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const { incrementMinutes, roundingDirection } = body;

      if (incrementMinutes === undefined && roundingDirection === undefined) {
        // An empty patch changes nothing and must not add an audit row: a redelivered no-op would
        // otherwise put a policy change in the log that nobody made.
        return c.json(await readFirmTimePolicy(firm.firmDatabase), 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const stored = await readFirmTimePolicy(firm.firmDatabase);
      const merged: PolicyBody = {
        incrementMinutes: incrementMinutes ?? stored.incrementMinutes,
        roundingDirection: roundingDirection ?? stored.roundingDirection,
      };

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const timestamp = now();
          return {
            write: {
              statements: [
                ...(incrementMinutes === undefined
                  ? []
                  : [
                      writeScopedSettingStatement(
                        firm.firmDatabase,
                        incrementMinutesDefinition,
                        "firm",
                        null,
                        incrementMinutes,
                        timestamp,
                      ),
                    ]),
                ...(roundingDirection === undefined
                  ? []
                  : [
                      writeScopedSettingStatement(
                        firm.firmDatabase,
                        roundingDirectionDefinition,
                        "firm",
                        null,
                        roundingDirection,
                        timestamp,
                      ),
                    ]),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.time_policy_updated",
                  actorUserId,
                  subjectId: null,
                  // What the firm measured by before and what it measures by now. Both sides,
                  // because "changed to six" does not say whether that was a change at all.
                  metadata: { from: stored, to: merged },
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            // Composed from the merged value rather than re-read: a read inside this effect would
            // not yet see its own uncommitted write.
            responseBody: canonicalJsonStringify(merged),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(await readFirmTimePolicy(firm.firmDatabase), 200);
    },
  );
}
