import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { commitEffectBatch, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import { recordRepairProvenanceStatement } from "@magna-carta/data-access/file-repair-provenance-statements";
import { fileAuditStatement } from "@magna-carta/file-manager/audit";
import { initiateUpload } from "@magna-carta/file-manager/file-service";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { computeVerdict } from "@magna-carta/file-manager/verdict";
import { readFirmScanPolicy } from "@magna-carta/file-manager/scan-policy-settings";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  assertAlsoHasPermission,
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierField } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveFirmBucket } from "../../files/firm-bucket.ts";

type AppContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

// base64 -> bytes. Inputs are bounded by the firm's inspectable-size cap, so a single pass is fine.
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// A one-shot ReadableStream over a byte buffer — the body shape MalwareScanPort.scan expects.
function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// The recovery container's JSON wire contract (camelCase), validated at the trust boundary before it
// is handed back. Mirrors containers/file-repair/src/dto.rs.
const DiagnosisReportSchema = z
  .object({
    detectedFormat: z.string().nullable(),
    corruption: z.array(z.string()),
    recoverability: z.string(),
    repairSupported: z.boolean(),
    carveSuggested: z.boolean(),
    detail: z.string(),
  })
  .openapi("FileRepairDiagnosis");

const SalvagedFileSchema = z.object({
  name: z.string(),
  mediaType: z.string().nullable(),
  contentBase64: z.string(),
});
const RecoveredItemSchema = z.object({
  name: z.string(),
  recovered: z.boolean(),
  detail: z.string(),
});
const LossManifestSchema = z.object({
  items: z.array(RecoveredItemSchema),
  fullyRecovered: z.boolean(),
  synthesized: z.array(z.string()),
});
type LossManifest = z.infer<typeof LossManifestSchema>;
export const RepairResultSchema = z
  .object({
    files: z.array(SalvagedFileSchema),
    loss: LossManifestSchema,
  })
  .openapi("FileRepairResult");

const baseMeta = {
  surface: "app",
  authenticated: true,
  permission: "tools:fileRepair",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
} as const satisfies Omit<RouteMeta, "operationId">;

export const fileRepairDiagnoseMeta: RouteMeta = {
  ...baseMeta,
  operationId: "fileRepair.diagnose",
};
export const fileRepairRepairMeta: RouteMeta = { ...baseMeta, operationId: "fileRepair.repair" };
export const fileRepairCarveMeta: RouteMeta = { ...baseMeta, operationId: "fileRepair.carve" };

// Unlike diagnose/repair/carve above (stateless — resource: "firm", gated solely on tools:fileRepair),
// attach WRITES a version into a matter, so its primary gate is files:upload (the matter-write gate
// every other mutating file route names) against resource: "matter" — the same shape uploads.ts's
// initiateUploadMeta uses. tools:fileRepair is asserted a SECOND time, in-handler
// (assertAlsoHasPermission), because the recovery-engine call this route rides is itself a
// fileRepair-gated action: a principal must hold BOTH capabilities to reconstruct AND save.
const attachBaseMeta = {
  surface: "app",
  authenticated: true,
  permission: "files:upload",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
} as const satisfies Omit<RouteMeta, "operationId">;

export const fileRepairRepairAttachMeta: RouteMeta = {
  ...attachBaseMeta,
  operationId: "fileRepair.repairAttach",
};

export const fileRepairCarveAttachMeta: RouteMeta = {
  ...attachBaseMeta,
  operationId: "fileRepair.carveAttach",
};

// A refusal before dispatch is one of these three typed Problem responses (all declared on every route).
type PreflightProblem = ProblemResponse<400> | ProblemResponse<413> | ProblemResponse<503>;
type Dispatched =
  | { readonly ok: false; readonly problem: PreflightProblem }
  | { readonly ok: true; readonly containerResponse: Response };

// Shared preflight + dispatch: size-cap the input, then stream it to the recovery container. Returns
// the container's raw Response, or a ready-made typed Problem when the request is refused before
// dispatch. The explicit tagged union keeps the Problem responses precisely typed for the handler.
export async function dispatchToRecovery(
  c: AppContext,
  operation: "diagnose" | "repair" | "carve",
): Promise<Dispatched> {
  const firm = requireChokepointFirmContext(c);
  const body = c.req.raw.body;
  if (body === null) {
    return {
      ok: false,
      problem: problemJson(c, {
        type: "validation",
        title: "Empty body",
        status: 400,
        detail: "Provide the file bytes as the request body.",
      }),
    };
  }
  const sizeBytes = Number(c.req.header("content-length") ?? "0");
  const cap = await readInspectableSizeCap(firm.firmDatabase);
  if (sizeBytes > cap) {
    await body.cancel(); // drain the branch so it cannot backpressure, then refuse
    return {
      ok: false,
      problem: problemJson(c, {
        type: "upload-not-allowed",
        title: "File too large to repair inline",
        status: 413,
        detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
      }),
    };
  }
  const service = c.env.FILE_REPAIR_SERVICE;
  if (service === undefined) {
    return {
      ok: false,
      problem: problemJson(c, {
        type: "service-unavailable",
        title: "Recovery engine unavailable",
        status: 503,
        detail: "The file-recovery engine is not currently reachable. Try again shortly.",
      }),
    };
  }
  const containerResponse = await service.fetch(
    new Request(`http://recovery/${operation}`, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
  return { ok: true, containerResponse };
}

// Re-scan every reconstructed file through the firm's malware gate. Repaired/carved bytes are rebuilt
// from possibly-malicious input and are never trusted, so a definitive `flagged` finding on ANY file
// withholds them all. `clean` and `unscanned` (no engine bound) pass: a repair is then never MORE
// exposed than the other stateless file tools, which do not scan at all, while a positive malware hit
// is still blocked whenever the scan engine is present. A genuine engine fault throws inside
// computeVerdict and propagates to the route error boundary (a redacted error, never a fake clean).
async function anyFileFlagged(
  c: AppContext,
  files: readonly { readonly contentBase64: string; readonly mediaType: string | null }[],
): Promise<boolean> {
  const firm = requireChokepointFirmContext(c);
  // Lazily imported: resolveScanPort pulls the @cloudflare/containers runtime, whose extensionless
  // internal import breaks the static OpenAPI-emit module graph at load time (mirrors scan-diagnose).
  const { resolveScanPort } = await import("../../files/scan-port-binding.ts");
  const port = resolveScanPort(c.env);
  const policy = await readFirmScanPolicy(firm.firmDatabase);
  for (const file of files) {
    const bytes = decodeBase64(file.contentBase64);
    const raw = await port.scan(bytesToStream(bytes), {
      sizeBytes: bytes.length,
      sniffedContentType: file.mediaType,
    });
    if (computeVerdict(raw, policy).verdict === "flagged") return true;
  }
  return false;
}

// One salvaged file -> one attached version, riding the ingest gate: initiateUpload mints the pending
// file (or version, when target.fileId is given) exactly as a direct upload would, so the same async
// ingest consumer (hash + scan + commit/quarantine) governs it — never a second, parallel malware gate
// here. The provenance row + the "file.repaired"/"file.carved" audit ride the SAME batch as the
// pending file/version rows (commitEffectBatch), so the honest loss manifest is durable even if ingest
// later quarantines the reconstruction; the bytes are put to R2 only after that batch commits, so a
// failed commit never leaves an orphaned R2 object for the ingest consumer to pick up.
async function attachOneFile(
  c: AppContext,
  file: { name: string; mediaType: string | null; contentBase64: string },
  manifest: LossManifest,
  operation: "repair" | "carve",
  target: { matterId: MatterId; fileId?: FileId; folderId?: FolderId | null; fileName: string },
): Promise<{ fileId: string; versionId: string }> {
  const firm = requireChokepointFirmContext(c);
  const userId = requireChokepointUserId(c);
  // Resolve the firm's bucket before any write, through the one resolver every R2-touching path
  // shares (files/firm-bucket.ts) — so these bytes land in the bucket ingest reads them back from.
  const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
  const bytes = decodeBase64(file.contentBase64);
  const now = () => new Date().toISOString();
  const auditContext = { clock: { now }, actorUserId: userId };

  const initiated = await initiateUpload(
    firm.firmDatabase,
    {
      matterId: target.matterId,
      fileId: target.fileId,
      folderId: target.folderId ?? null,
      name: target.fileName,
      declaredSize: bytes.length,
      declaredContentType: file.mediaType,
      uploadedBy: userId,
      mode: "put",
      uploadKind: "interactive",
    },
    auditContext,
  );

  const effect: EffectWrite = {
    statements: [
      ...initiated.effect.statements,
      recordRepairProvenanceStatement(firm.firmDatabase, {
        id: newIdentifier("repairProvenance"),
        fileVersionId: initiated.versionId,
        operation,
        fullyRecovered: manifest.fullyRecovered,
        manifestJson: JSON.stringify(manifest),
        sourceMediaType: file.mediaType,
        createdAt: now(),
      }),
      fileAuditStatement(
        firm.firmDatabase,
        auditContext,
        operation === "repair" ? "file.repaired" : "file.carved",
        initiated.versionId,
        {
          operation,
          fullyRecovered: manifest.fullyRecovered,
          lostCount: manifest.items.filter((item) => !item.recovered).length,
          synthesizedCount: manifest.synthesized.length,
        },
      ),
    ],
    outboxMessages: initiated.effect.outboxMessages,
  };
  // Not runIdempotentEffect: this route is idempotency: "optional" (a repair reconstruction is not
  // byte-reproducible run to run, so a client cannot safely retry-replay it), and the chokepoint's
  // idempotency port only stashes an idempotency context for a "required" route — mirrors
  // completeUploadRoute/abortUploadRoute in uploads.ts, the other optional-idempotency mutating routes
  // in this file's neighborhood, which commit their effect the same direct way.
  await commitEffectBatch(firm.firmDatabase, effect, { now });

  // The metadata batch is committed; now put the bytes so the R2 event drives ingest.
  await bucket.put(initiated.r2Key, bytes, { customMetadata: initiated.dimensions });
  return { fileId: initiated.fileId, versionId: initiated.versionId };
}

const problemResponses = {
  400: {
    description: "Empty request body",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "Missing tools:fileRepair",
    content: { "application/problem+json": { schema: Problem } },
  },
  413: {
    description: "File exceeds the inspectable-size cap",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
  503: {
    description: "Recovery engine unavailable",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const diagnoseResponses = {
  200: {
    description: "Diagnosis report",
    content: { "application/json": { schema: DiagnosisReportSchema } },
  },
  ...problemResponses,
} as const;

const diagnoseRoute = defineOpenAPIRoute(fileRepairDiagnoseMeta, {
  method: "post",
  path: "/api/v1/file-repair/diagnose",
  description:
    "Diagnose a possibly-corrupt uploaded file: detect its format, describe the corruption, and " +
    "report whether it can be repaired (and whether carving may recover embedded files). Nothing is stored.",
  request: {
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: diagnoseResponses,
});

const salvageResponses = {
  200: {
    description: "The reconstructed files and the honest loss manifest",
    content: { "application/json": { schema: RepairResultSchema } },
  },
  422: {
    description:
      "The file could not be reconstructed, or the output was withheld by the malware gate",
    content: { "application/problem+json": { schema: Problem } },
  },
  ...problemResponses,
} as const;

const repairRoute = defineOpenAPIRoute(fileRepairRepairMeta, {
  method: "post",
  path: "/api/v1/file-repair/repair",
  description:
    "Repair a structurally corrupted uploaded file by reconstructing its format (ZIP/OOXML, CFB/OLE2, " +
    "or a PDF cross-reference), returning the salvaged file plus an honest manifest of what could not be " +
    "recovered. The reconstructed output is re-scanned for malware before it is returned. Nothing is stored.",
  request: {
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: salvageResponses,
});

const carveRoute = defineOpenAPIRoute(fileRepairCarveMeta, {
  method: "post",
  path: "/api/v1/file-repair/carve",
  description:
    "Carve embedded known-type files (e.g. JPEG, PNG, PDF, ZIP) out of an unrecognized or severely " +
    "damaged uploaded file by scanning its raw bytes, validating each candidate by actually decoding it. " +
    "Every carved file is re-scanned for malware before it is returned. Nothing is stored.",
  request: {
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: salvageResponses,
});

// Carved names come from the engine's SalvagedFile.name; strip any path separators or traversal so a
// carved fragment can never write outside its folder or collide with a control name.
function sanitizeCarvedName(name: string, index: number): string {
  const base = name.replace(/[/\\]/g, "_").replace(/^\.+/, "").trim();
  return base.length > 0 ? base : `carved-${index + 1}`;
}

const attachResponses = {
  // Spread first: the literal keys below intentionally override problemResponses' generic 403
  // (naming only tools:fileRepair) with the dual-gate-aware description, and add 202/404/422.
  ...problemResponses,
  202: {
    description:
      "Attaching: the pending file/version rows and the provenance were committed and the bytes " +
      "were put to R2. The version is pending until the ingest queue consumer commits or quarantines it.",
    content: {
      "application/json": { schema: z.object({ fileId: z.string(), versionId: z.string() }) },
    },
  },
  403: {
    description: "Missing files:upload, or missing tools:fileRepair",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The target file, or its folder, is unknown in this firm, or belongs to another matter",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: salvageResponses[422],
} as const;

const carveAttachResponses = {
  ...problemResponses,
  202: {
    description:
      "Attaching carved files; versions pending. Each carved file's metadata was committed and bytes " +
      "were put to R2. Versions are pending until ingest resolves.",
    content: {
      "application/json": {
        schema: z.object({
          files: z.array(z.object({ fileId: z.string(), versionId: z.string(), name: z.string() })),
        }),
      },
    },
  },
  403: {
    description: "Missing files:upload, or missing tools:fileRepair",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The target folder, or the matter, is unknown in this firm",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: salvageResponses[422],
} as const;

const repairAttachRoute = defineOpenAPIRoute(fileRepairRepairAttachMeta, {
  method: "post",
  path: "/api/v1/file-repair/repair/attach",
  description:
    "Repair the uploaded corrupt file and save the result into a matter: a new version of an " +
    "existing file (when fileId is given) or a new file. The reconstruction rides the ingest " +
    "malware gate; the honest loss manifest is stored with the version. Returns 202 — the version " +
    "is pending until ingest resolves.",
  request: {
    query: z.object({
      matterId: identifierField("matter"),
      fileId: identifierField("file").optional(),
      folderId: identifierField("folder").optional(),
      fileName: z.string().min(1).optional(),
    }),
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: attachResponses,
});

const carveAttachRoute = defineOpenAPIRoute(fileRepairCarveAttachMeta, {
  method: "post",
  path: "/api/v1/file-repair/carve/attach",
  description:
    "Carve embedded files out of the uploaded input and save each as a new file in the matter folder. " +
    "Each carved file rides the ingest malware gate and carries the honest carve manifest. Returns 202.",
  request: {
    query: z.object({
      matterId: identifierField("matter"),
      folderId: identifierField("folder").optional(),
    }),
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: carveAttachResponses,
});

export function registerFileRepairRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...diagnoseRoute, middleware: chokepointMiddleware(chokepoint, diagnoseRoute) },
    async (c) => {
      const dispatched = await dispatchToRecovery(c, "diagnose");
      if (!dispatched.ok) return dispatched.problem;
      if (dispatched.containerResponse.status !== 200) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Diagnosis failed",
          status: 503,
          detail: "The recovery engine returned an error. Try again shortly.",
        });
      }
      const report = DiagnosisReportSchema.parse(await dispatched.containerResponse.json());
      return c.json(report, 200);
    },
  );

  app.openapi(
    { ...repairRoute, middleware: chokepointMiddleware(chokepoint, repairRoute) },
    async (c) => {
      const dispatched = await dispatchToRecovery(c, "repair");
      if (!dispatched.ok) return dispatched.problem;
      const { containerResponse } = dispatched;
      if (containerResponse.status === 422) {
        return problemJson(c, {
          type: "validation",
          title: "The file could not be repaired",
          status: 422,
          detail: "The recovery engine could not reconstruct usable content from this file.",
        });
      }
      if (containerResponse.status !== 200) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recovery failed",
          status: 503,
          detail: "The recovery engine returned an error. Try again shortly.",
        });
      }
      const result = RepairResultSchema.parse(await containerResponse.json());
      if (await anyFileFlagged(c, result.files)) {
        // A definitive malware finding in the reconstructed output — withhold every byte, disclose only
        // that it was flagged (never the file content or the signature) so the caller learns why.
        return problemJson(c, {
          type: "validation",
          title: "The reconstructed output was withheld",
          status: 422,
          detail:
            "The reconstructed output was flagged by the malware scanner and was not returned.",
        });
      }
      return c.json(result, 200);
    },
  );

  app.openapi(
    { ...carveRoute, middleware: chokepointMiddleware(chokepoint, carveRoute) },
    async (c) => {
      const dispatched = await dispatchToRecovery(c, "carve");
      if (!dispatched.ok) return dispatched.problem;
      const { containerResponse } = dispatched;
      if (containerResponse.status === 422) {
        return problemJson(c, {
          type: "validation",
          title: "Nothing could be carved",
          status: 422,
          detail: "The recovery engine could not carve any valid embedded file from this input.",
        });
      }
      if (containerResponse.status !== 200) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recovery failed",
          status: 503,
          detail: "The recovery engine returned an error. Try again shortly.",
        });
      }
      const result = RepairResultSchema.parse(await containerResponse.json());
      if (await anyFileFlagged(c, result.files)) {
        return problemJson(c, {
          type: "validation",
          title: "The carved output was withheld",
          status: 422,
          detail: "A carved file was flagged by the malware scanner; no content was returned.",
        });
      }
      return c.json(result, 200);
    },
  );

  app.openapi(
    { ...repairAttachRoute, middleware: chokepointMiddleware(chokepoint, repairAttachRoute) },
    async (c) => {
      // The dual gate: the route's own primary permission (files:upload, checked by the chokepoint
      // before this handler runs) plus this SECOND, in-handler check for tools:fileRepair — the
      // recovery-engine call below is itself a fileRepair-gated action, so attaching its output
      // requires both capabilities together.
      const forbidden = assertAlsoHasPermission(c, "tools:fileRepair");
      if (forbidden !== null) return forbidden;

      const dispatched = await dispatchToRecovery(c, "repair");
      if (!dispatched.ok) return dispatched.problem;
      const { containerResponse } = dispatched;
      if (containerResponse.status === 422) {
        return problemJson(c, {
          type: "validation",
          title: "The file could not be repaired",
          status: 422,
          detail: "The recovery engine could not reconstruct usable content from this file.",
        });
      }
      if (containerResponse.status !== 200) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recovery failed",
          status: 503,
          detail: "The recovery engine returned an error. Try again shortly.",
        });
      }
      const result = RepairResultSchema.parse(await containerResponse.json());
      const query = c.req.valid("query");
      const file = result.files[0];
      if (file === undefined) {
        return problemJson(c, {
          type: "validation",
          title: "The file could not be repaired",
          status: 422,
          detail: "The recovery engine could not reconstruct usable content from this file.",
        });
      }
      try {
        const attached = await attachOneFile(c, file, result.loss, "repair", {
          matterId: query.matterId,
          fileId: query.fileId,
          folderId: query.folderId ?? null,
          fileName: query.fileName ?? file.name,
        });
        return c.json(attached, 202);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) {
          if (caught.code === "upload-policy-size" || caught.code === "upload-policy-type") {
            return problemJson(c, {
              type: "upload-not-allowed",
              title: "Upload not allowed",
              status: 422,
              detail: caught.message,
            });
          }
          if (
            caught.code === "unknown-file" ||
            caught.code === "unknown-folder" ||
            caught.code === "file-matter-mismatch" ||
            caught.code === "file-cross-matter"
          ) {
            return problemJson(c, {
              type: "not-found",
              title: "Not found",
              status: 404,
              detail: "No such resource in this firm.",
            });
          }
        }
        throw caught;
      }
    },
  );

  app.openapi(
    { ...carveAttachRoute, middleware: chokepointMiddleware(chokepoint, carveAttachRoute) },
    async (c) => {
      // The dual gate: files:upload (primary) plus tools:fileRepair (secondary).
      const forbidden = assertAlsoHasPermission(c, "tools:fileRepair");
      if (forbidden !== null) return forbidden;

      const dispatched = await dispatchToRecovery(c, "carve");
      if (!dispatched.ok) return dispatched.problem;
      const { containerResponse } = dispatched;
      if (containerResponse.status === 422) {
        return problemJson(c, {
          type: "validation",
          title: "Nothing could be carved",
          status: 422,
          detail: "The recovery engine could not carve any valid embedded file from this input.",
        });
      }
      if (containerResponse.status !== 200) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recovery failed",
          status: 503,
          detail: "The recovery engine returned an error. Try again shortly.",
        });
      }
      const result = RepairResultSchema.parse(await containerResponse.json());
      const query = c.req.valid("query");
      const attached: { fileId: string; versionId: string; name: string }[] = [];
      try {
        for (const [index, file] of result.files.entries()) {
          const name = sanitizeCarvedName(file.name, index);
          const one = await attachOneFile(c, file, result.loss, "carve", {
            matterId: query.matterId,
            folderId: query.folderId ?? null,
            fileName: name,
          });
          attached.push({ ...one, name });
        }
        return c.json({ files: attached }, 202);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) {
          if (caught.code === "upload-policy-size" || caught.code === "upload-policy-type") {
            return problemJson(c, {
              type: "upload-not-allowed",
              title: "Upload not allowed",
              status: 422,
              detail: caught.message,
            });
          }
          if (
            caught.code === "unknown-file" ||
            caught.code === "unknown-folder" ||
            caught.code === "file-matter-mismatch" ||
            caught.code === "file-cross-matter"
          ) {
            return problemJson(c, {
              type: "not-found",
              title: "Not found",
              status: 404,
              detail: "No such resource in this firm.",
            });
          }
        }
        throw caught;
      }
    },
  );
}
