import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { computeVerdict } from "@magna-carta/file-manager/verdict";
import { readFirmScanPolicy } from "@magna-carta/file-manager/scan-policy-settings";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

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
// is handed back. Mirrors containers/recovery/src/dto.rs.
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
const RepairResultSchema = z
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

export const fileRepairDiagnoseMeta: RouteMeta = { ...baseMeta, operationId: "fileRepair.diagnose" };
export const fileRepairRepairMeta: RouteMeta = { ...baseMeta, operationId: "fileRepair.repair" };
export const fileRepairCarveMeta: RouteMeta = { ...baseMeta, operationId: "fileRepair.carve" };

// A refusal before dispatch is one of these three typed Problem responses (all declared on every route).
type PreflightProblem = ProblemResponse<400> | ProblemResponse<413> | ProblemResponse<503>;
type Dispatched =
  | { readonly ok: false; readonly problem: PreflightProblem }
  | { readonly ok: true; readonly containerResponse: Response };

// Shared preflight + dispatch: size-cap the input, then stream it to the recovery container. Returns
// the container's raw Response, or a ready-made typed Problem when the request is refused before
// dispatch. The explicit tagged union keeps the Problem responses precisely typed for the handler.
async function dispatchToRecovery(
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
  const service = c.env.RECOVERY_SERVICE;
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
  const { resolveScanPort } = await import("../files/scan-port-binding.ts");
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
    description: "The file could not be reconstructed, or the output was withheld by the malware gate",
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
          detail: "The reconstructed output was flagged by the malware scanner and was not returned.",
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
}
