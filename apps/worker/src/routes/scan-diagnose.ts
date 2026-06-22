import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The diagnostic-scan response — the engine's ScanResult union flattened into one stable shape so a
// caller reads the verdict + the relevant detail without a discriminated union. The verdict is an
// honest `unscanned` until the scan Container is activated (the engine-less adapter never claims clean).
const ScanDiagnosis = z
  .object({
    verdict: z.enum(["clean", "infected", "unscanned", "suspicious"]),
    engineVersion: z.string().nullable(),
    signature: z.string().nullable(), // the malware name, for an `infected` verdict
    reason: z.string().nullable(), // why `unscanned`/`suspicious` (no-engine, encrypted, decompression-bomb, …)
    activeContent: z.boolean(), // a `clean` file that still carries active content (PDF JS, Office macros)
  })
  .openapi("ScanDiagnosis");

// scan.diagnose — a firm-level, one-off diagnostic gated on `firm:scanFile` (seeded to every default
// role; a POST must name a capability whose namespace matches its resource, never a null
// "any-authenticated" permission). audited: true — the diagnostic stores nothing, so its audit row IS
// the record of who ran a scan and what verdict came back (verdict only, never the file's bytes/name).
const scanDiagnoseMeta: RouteMeta = {
  operationId: "scan.diagnose",
  surface: "app",
  authenticated: true,
  permission: "firm:scanFile",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const scanDiagnoseRoute = defineOpenAPIRoute(scanDiagnoseMeta, {
  method: "post",
  path: "/api/v1/scan/diagnose",
  description:
    "Scans an uploaded file — the raw bytes as the application/octet-stream request body — through the " +
    "malware-scan engine and returns its verdict + details. A one-off diagnostic: the file is NOT " +
    "stored and is NOT associated with any matter. Returns an honest `unscanned` verdict until the scan " +
    "Container is activated (the engine-less adapter never reports a false `clean`).",
  request: {},
  responses: {
    200: {
      description: "The scan diagnosis",
      content: { "application/json": { schema: ScanDiagnosis } },
    },
    400: {
      description: "Empty request body",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "The body exceeds the firm's inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ScanApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerScanDiagnoseRoute(app: ScanApp, chokepoint: Chokepoint): void {
  // POST /api/v1/scan/diagnose — stream the request body straight through the scan port and report the
  // verdict. No request-body schema (the bytes are binary), so the raw stream reaches the engine
  // unbuffered; the size cap is enforced from Content-Length before the scan runs.
  app.openapi(
    { ...scanDiagnoseRoute, middleware: chokepointMiddleware(chokepoint, scanDiagnoseRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the file bytes as the request body.",
        });
      }
      const sizeBytes = Number(c.req.header("content-length") ?? "0");
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (sizeBytes > cap) {
        await body.cancel(); // drain the branch so it cannot backpressure, then refuse
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "File too large to scan",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }
      // Lazily imported: resolveScanPort pulls in the @cloudflare/containers runtime (the scan
      // Container adapter), whose package ships an extensionless internal import that the node-ESM
      // OpenAPI-emit script cannot resolve at module-load time. Deferring it to request time keeps it
      // out of app.ts's static module graph (cached after the first call; no per-request cost).
      const { resolveScanPort } = await import("../files/scan-port-binding.ts");
      const result = await resolveScanPort(c.env).scan(body, {
        sizeBytes,
        sniffedContentType: c.req.header("content-type") ?? null,
      });

      // The diagnostic stores nothing, so this audit row is the record of who ran a scan and the
      // outcome. Redacted by construction: the verdict only — never the file's bytes or name.
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "file.scan_diagnosed",
              actorUserId: userId,
              subjectId: userId, // a stateless diagnostic — the member's own activity is the subject
              metadata: { verdict: result.verdict },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      // Flatten the ScanResult union into the stable diagnosis shape.
      return c.json(
        {
          verdict: result.verdict,
          engineVersion: result.engineVersion ?? null,
          signature: result.verdict === "infected" ? result.signature : null,
          reason:
            result.verdict === "unscanned" || result.verdict === "suspicious"
              ? result.reason
              : null,
          activeContent: result.verdict === "clean" ? (result.activeContent ?? false) : false,
        },
        200,
      );
    },
  );
}
