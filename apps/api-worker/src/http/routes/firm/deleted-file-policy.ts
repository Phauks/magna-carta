import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  deletedFilePolicyDefinition,
  readDeletedFilePolicy,
} from "@magna-carta/file-manager/deleted-file-settings";
import { newIdentifier } from "@magna-carta/identifiers/generate";
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

// The firm's deleted-file policy: how long a deleted file waits in its matter's Trash, and whether it
// then moves to archive storage. Every member may read it, because each matter's Trash says when a
// file leaves it; changing it is the retention right (Admin by seed), the same right as the paper
// file's minimum retention. Nothing this route writes destroys anything: the tiering sweep reads the
// policy and moves bytes between storage classes, and no setting here deletes a byte.

const TrashDays = z.union([
  z.literal(30),
  z.literal(60),
  z.literal(90),
  z.literal(180),
  z.literal(365),
]);
const AfterTrash = z.enum(["archive", "keep-standard"]);

const DeletedFilePolicyResponse = z
  .object({
    trashDays: TrashDays.openapi({
      description:
        "Days a deleted file waits in its matter's Trash, where anyone with access can restore it.",
    }),
    afterTrash: AfterTrash.openapi({
      description:
        "What happens after Trash: archive moves the file to Infrequent Access storage in place; keep-standard leaves it where it is. Neither destroys it.",
    }),
  })
  .openapi("DeletedFilePolicyResponse");

const PatchDeletedFilePolicyRequest = z
  .object({
    // Sparse: an absent field is unchanged, and an empty patch writes nothing and audits nothing.
    trashDays: TrashDays.optional(),
    afterTrash: AfterTrash.optional(),
  })
  .openapi("PatchDeletedFilePolicyRequest");

const getMeta: RouteMeta = {
  operationId: "deletedFilePolicy.get",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "deletedFilePolicy.update",
  surface: "app",
  authenticated: true,
  permission: "matters:manageRetention",
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/deleted-file-policy",
  description:
    "Reads the firm's deleted-file policy: how many days a deleted file waits in its matter's Trash, " +
    "and whether it then moves to archive storage. A firm that has never set it reads the default: " +
    "30 days, then archive.",
  responses: {
    200: {
      description: "The firm's deleted-file policy",
      content: { "application/json": { schema: DeletedFilePolicyResponse } },
    },
    401: problem("No valid session"),
    404: problem("The firm is unreachable or the member is deactivated"),
    429: problem("Rate limit exceeded"),
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/deleted-file-policy",
  description:
    "Updates the firm's deleted-file policy. Sparse: an absent field is left alone, and an empty " +
    "patch writes nothing. The change and its audit row are one batch. Returns the policy after the write.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: PatchDeletedFilePolicyRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The firm's deleted-file policy after the write",
      content: { "application/json": { schema: DeletedFilePolicyResponse } },
    },
    400: problem("The Idempotency-Key header is missing on a write"),
    401: problem("No valid session"),
    403: problem("The session member lacks matters:manageRetention"),
    404: problem("The firm is unreachable or the member is deactivated"),
    409: problem("A request with this Idempotency-Key is already in progress"),
    422: problem(
      "The request body is invalid, or the Idempotency-Key was reused with a different body",
    ),
    429: problem("Rate limit exceeded"),
  },
});

type FirmApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerDeletedFilePolicyRoutes(app: FirmApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(await readDeletedFilePolicy(firm.firmDatabase), 200);
    },
  );

  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const current = await readDeletedFilePolicy(firm.firmDatabase);
      if (body.trashDays === undefined && body.afterTrash === undefined) {
        return c.json(current, 200);
      }
      const resolved = {
        trashDays: body.trashDays ?? current.trashDays,
        afterTrash: body.afterTrash ?? current.afterTrash,
      };
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const stamp = now();
          return {
            write: {
              statements: [
                writeFirmSettingStatement(
                  firm.firmDatabase,
                  deletedFilePolicyDefinition,
                  resolved,
                  stamp,
                ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.deleted_file_policy_updated",
                  actorUserId: userId,
                  subjectId: deletedFilePolicyDefinition.key,
                  metadata: body,
                  now: stamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify(resolved),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof DeletedFilePolicyResponse>,
        200,
      );
    },
  );
}
