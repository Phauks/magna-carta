import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// THE FIRM'S OWN NAME, as its clients read it.
//
// There is deliberately no GET here. Every session already resolves the firm's display name — the
// bootstrap returns it as `firm.name`, and the chokepoint's own firm context reads it for every
// request — so a second read would be a second answer to the same question, and the one a screen
// would have to reconcile against the session it is already holding.
//
// WHICH COLUMN, AND WHY IT IS NOT THE OTHER ONE. `firm.name` is the provisioner's resume identity:
// it is UNIQUE, it is what a crashed provisioning run finds its own partial row by, and for a
// self-serve firm it is a platform-generated handle rather than anything a person chose. Renaming
// it would break that and would let one firm's chosen name refuse another's. `firm.display_name` is
// the human-facing one, unique to nobody, and null there means "the operator-typed name stands" —
// which is why clearing it is a real act rather than a validation failure.
//
// The write lands on the CONTROL plane and its audit row lands in the FIRM's own log, which cannot
// share that batch. The ordering follows the release-channel route exactly: the idempotency record
// and the name commit together, and the audit row is written after, on the first execution only, so
// a replay short-circuits before it and cannot double-write history.

const PERMISSION = "firm:manageProfile" as const;

const FirmProfileResponse = z
  .object({
    displayName: z.string().openapi({
      description:
        "What the firm is called to its clients — on invoices, in the portal, and on every " +
        "generated document. Never the provisioning handle behind it.",
    }),
  })
  .openapi("FirmProfileResponse");

const SetFirmProfileRequest = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      // The same normalization the joining door applies to a firm name it is given, so a name
      // typed here and the same name typed there are the same name.
      .transform((value) => value.normalize("NFC"))
      .openapi({
        description:
          "The firm's human-facing name. Required and non-empty: a firm with no name prints none " +
          "on the documents it sends.",
      }),
  })
  .openapi("SetFirmProfileRequest");

const errorResponses = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks firm:manageProfile",
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
      "The name is empty or too long, or the Idempotency-Key was reused with a different body",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const setMeta: RouteMeta = {
  operationId: "firmProfile.set",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Audited: the name on an invoice is what a client recognises the firm by, and a later "when did
  // we start calling ourselves this" turns on who changed it and when.
  audited: true,
  idempotency: "required",
  // The business write is the control-plane firm row, so its idempotency record commits there too —
  // atomic with the write, on the members.invite precedent.
  idempotencyStore: "control",
  rateLimit: "default",
};

const setRoute = defineOpenAPIRoute(setMeta, {
  method: "put",
  path: "/api/v1/firm/profile",
  description:
    "Sets what the firm is called to its clients. The name reaches invoices, the client portal " +
    "and generated documents from the moment it is saved; documents already produced keep the " +
    "name they were produced under. Read it from the session bootstrap, which resolves it for " +
    "every request already.",
  request: {
    headers: idempotencyKeyHeader,
    body: { required: true, content: { "application/json": { schema: SetFirmProfileRequest } } },
  },
  responses: {
    200: {
      description: "The firm's name after the write",
      content: { "application/json": { schema: FirmProfileResponse } },
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

export function registerFirmProfileRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...setRoute, middleware: chokepointMiddleware(chokepoint, setRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const firmContext = requireChokepointFirmContext(c);
      const { displayName } = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);

      // Captured inside the effect for the post-commit audit row, which cannot ride its batch.
      let previousName = "";
      let capturedNow = new Date().toISOString();

      const result = await runIdempotentEffect({
        database: c.env.DB_CONTROL,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        effect: async () => {
          capturedNow = new Date().toISOString();
          const row = await c.env.DB_CONTROL.prepare(
            "SELECT name, display_name FROM firm WHERE id = ?1",
          )
            .bind(firmId)
            .first<{ name: string; display_name: string | null }>();
          // What the firm was CALLED before, resolved the same way every read resolves it, so the
          // audit row records the change a person would have seen rather than a null.
          previousName = row === null ? "" : (row.display_name ?? row.name);

          return {
            write: {
              statements: [
                c.env.DB_CONTROL.prepare("UPDATE firm SET display_name = ?2 WHERE id = ?1").bind(
                  firmId,
                  displayName,
                ),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify({ displayName }),
          };
        },
      });

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }

      if (result.kind === "replayed") {
        c.header("Idempotency-Replayed", "true");
      } else {
        // First execution only: the firm's own log, after the control-plane batch is durable. A
        // replay short-circuits above and cannot reach this.
        await insertAuditLogStatement(firmContext.firmDatabase, {
          id: newIdentifier("auditLog"),
          event: "firm.profile_updated",
          actorUserId: userId,
          subjectId: firmId,
          // The firm's own name on both sides. It is the firm's, not a person's, and it is the fact
          // the row exists to record.
          metadata: { from: previousName, to: displayName },
          now: capturedNow,
        }).run();
      }

      return c.json({ displayName }, 200);
    },
  );
}
