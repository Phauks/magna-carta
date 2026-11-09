import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  checkUploadReadinessForFirm,
  UPLOAD_READINESS_AUDIT_EVENT,
} from "../../../files/upload-readiness.ts";

// The report: every precondition of a browser upload, checked from the server, in the order they
// must hold. `ready` is the one-word answer; the checks are the diagnosis when it is false.
const UploadReadinessCheck = z
  .object({
    id: z.enum([
      "bucket-recorded",
      "bucket-exists",
      "event-notifications",
      "lifecycle-rules",
      "cors-policy",
      "key-can-sign",
    ]),
    outcome: z.enum(["ok", "applied", "failed", "not-applicable"]),
    detail: z.string(),
  })
  .openapi("UploadReadinessCheck");

const UploadReadinessReport = z
  .object({
    ready: z.boolean(),
    bucketName: z.string().nullable(),
    provisioner: z.enum(["cloudflare-rest", "development"]),
    uploadPath: z.enum(["direct-to-storage", "through-the-application"]),
    checks: z.array(UploadReadinessCheck),
  })
  .openapi("UploadReadinessReport");

// A POST, because the check ACTS: the bucket settings the code owns are re-applied as it verifies
// them. Admin only, on the key the rest of the upload path's safety settings ride; it runs
// from the version panel, beside the other reads about what is running. Audited, as every mutating route is: the report
// is returned rather than stored, so the audit row is the record of who ran it and what it found.
const checkMeta: RouteMeta = {
  operationId: "uploadReadiness.check",
  surface: "app",
  authenticated: true,
  permission: "firm:manageScanPolicy",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const checkRoute = defineOpenAPIRoute(checkMeta, {
  method: "post",
  path: "/api/v1/firm/upload-readiness",
  description:
    "Checks, from the server, every precondition of a browser upload for this firm — the firm's " +
    "storage bucket exists, it carries the ingest notification, the expiry rules and the " +
    "browser-upload CORS policy (each re-applied as it is checked), and the storage credential " +
    "can sign a request the bucket honours. The one hop of an upload the application cannot see " +
    "is the browser's write to storage; this names which of its preconditions is not met.",
  responses: {
    200: {
      description: "The readiness report",
      content: { "application/json": { schema: UploadReadinessReport } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks firm:manageScanPolicy",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerUploadReadinessRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...checkRoute, middleware: chokepointMiddleware(chokepoint, checkRoute) },
    async (c) => {
      // The firm is the session's, never a path value; the check reads its row for the bucket and
      // region rather than trusting the context's cached name, so a firm whose provisioning just
      // finished is checked as it stands.
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const report = await checkUploadReadinessForFirm(c.env, requireChokepointFirmId(c));

      // The verdict and which checks failed — deployment facts, never anything about the firm's files.
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: UPLOAD_READINESS_AUDIT_EVENT,
              actorUserId: userId,
              subjectId: userId,
              metadata: {
                ready: report.ready,
                failed: report.checks
                  .filter((check) => check.outcome === "failed")
                  .map((check) => check.id),
              },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      // The report's arrays are readonly; the contract's response type is not. Same fields, copied.
      return c.json(
        {
          ready: report.ready,
          bucketName: report.bucketName,
          provisioner: report.provisioner,
          uploadPath: report.uploadPath,
          checks: report.checks.map((check) => ({ ...check })),
        },
        200,
      );
    },
  );
}
