import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { computeVerdict, ScanFaultError } from "@magna-carta/file-manager/verdict";
import { readFirmScanPolicy } from "@magna-carta/file-manager/scan-policy-settings";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The diagnostic-scan response — the engine's raw facts collapsed (via the app-side verdict layer)
// into one stable shape so a caller reads the verdict + the relevant detail without a discriminated
// union. A flagged file (clamd signature, a counting YARA match, or a structural heuristic) reports as
// `infected` when clamd named a signature, otherwise `suspicious` with the triggering reason. The
// verdict is an honest `unscanned` until the scan Container is activated (the engine-less adapter never
// claims clean).
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
  // Optional, and it has to be: the request body is the raw file bytes, and the chokepoint's
  // required-idempotency gate fingerprints a request by reading its body through Hono's
  // text-decoding cache — which would hand the scan engine a UTF-8-mangled copy and return a verdict
  // on something the caller never sent. The diagnostic stores nothing, so a replay simply rescans.
  idempotency: "optional",
  rateLimit: "default",
};

const scanDiagnoseRoute = defineOpenAPIRoute(scanDiagnoseMeta, {
  method: "post",
  path: "/api/v1/scan/diagnose",
  description:
    "Scans an uploaded file — the raw bytes as the application/octet-stream request body — through the " +
    "malware-scan engine and returns its verdict + details. A one-off diagnostic: the file is NOT " +
    "stored and is NOT associated with any matter. Where no engine is wired at all the verdict is an " +
    "honest `unscanned` (never a false `clean`); where the engine is wired but unreachable the answer " +
    "is a 503, because an unreachable engine is not a verdict.",
  request: {
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
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
    503: {
      description: "The scan engine is wired but unreachable, so no verdict can be given",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ScanApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerScanDiagnoseRoute(app: ScanApp, chokepoint: Chokepoint): void {
  // POST /api/v1/scan/diagnose — stream the request body straight through the scan port and report the
  // verdict. The declared application/octet-stream body carries no zod schema, so nothing parses or
  // buffers it and the raw stream reaches the engine unbuffered; the size cap is enforced from
  // Content-Length before the scan runs.
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

      // Decide the verdict app-side from the raw facts, using the firm's own scan policy so the
      // diagnostic reflects exactly what ingest would decide for this firm (tier + suspicious-score
      // floor), not a fixed default. A wired engine that cannot answer is never a verdict — it raises
      // ScanFaultError, from the adapter on a 5xx and from computeVerdict on an `unavailable` report —
      // and this route answers it by name. The ingest consumer catches the same error and retries,
      // which is right for a queued file; here there is no file and nothing to retry, so a 500 with an
      // Error ID would send a member to support over a Container that simply is not up. The distinct
      // "no engine wired at all" case is not this: it reaches the verdict layer as an honest
      // `unscanned`/`no-engine` and is returned as one.
      let fileVerdict: ReturnType<typeof computeVerdict>;
      let raw: Awaited<ReturnType<ReturnType<typeof resolveScanPort>["scan"]>>;
      try {
        raw = await resolveScanPort(c.env).scan(body, {
          sizeBytes,
          sniffedContentType: c.req.header("content-type") ?? null,
        });
        fileVerdict = computeVerdict(raw, await readFirmScanPolicy(firm.firmDatabase));
      } catch (error) {
        if (error instanceof ScanFaultError) {
          return problemJson(c, {
            type: "service-unavailable",
            title: "The scan engine is unreachable",
            status: 503,
            detail:
              "The malware-scan engine did not answer, so this file has not been scanned and no verdict can be given. Nothing was stored. Try again shortly.",
          });
        }
        throw error;
      }

      // Collapse the verdict into the stable diagnosis enum: a flagged file reports `infected` when
      // clamd named a signature, otherwise `suspicious` with the triggering reason.
      const diagnosis =
        fileVerdict.verdict === "clean"
          ? {
              verdict: "clean" as const,
              signature: null,
              reason: null,
              activeContent: fileVerdict.activeContent,
            }
          : fileVerdict.verdict === "unscanned"
            ? {
                verdict: "unscanned" as const,
                signature: null,
                reason: fileVerdict.reason,
                activeContent: false,
              }
            : raw.clam.state === "infected"
              ? {
                  verdict: "infected" as const,
                  signature: raw.clam.signature,
                  reason: null,
                  activeContent: false,
                }
              : {
                  verdict: "suspicious" as const,
                  signature: null,
                  reason: fileVerdict.reason,
                  activeContent: false,
                };

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
              metadata: { verdict: diagnosis.verdict },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      return c.json({ engineVersion: raw.engineVersion ?? null, ...diagnosis }, 200);
    },
  );
}
