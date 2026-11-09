import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { DecryptionError, ensureReady, extractHash, recoveryTier } from "@magna-carta/decryption";
import decryptionWasmModule from "@magna-carta/decryption/src/pkg/decryption_core_bg.wasm";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
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
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import type { RecoveryJobState, RecoveryStartInput } from "../../../recovery/recovery-types.ts";

// The button-initiated password-recovery surface: mints a job, fans it out through the
// RecoveryJobCoordinator Durable Object (env.RECOVERY_JOB, keyed `${firmId}:${jobId}`), and polls
// or cancels it. Mirrors routes/files/decryption.ts's boundary (attestation, size-cap, base64 decode,
// wasm init, DecryptionError -> 400 mapping) — that route extracts a hash and returns it inline;
// this one hands the SAME extracted hash to the coordinator instead, and NEVER returns file bytes.

// The Cloudflare-CPU-band fan-out width: how many containers a cfCapable job splits its wordlist
// across. Modest on purpose — a few containers is enough to prove the coordinator's fan-out and
// first-hit-cancel aggregation; it is a tunable throughput knob, not a bound on the keyspace a job
// can search (the container itself self-splits within a shard).
const RECOVERY_SHARD_COUNT = 4;

// Wrangler bundles .wasm imports as WebAssembly.Module — typed by the ambient declaration in
// worker-env.d.ts and passed to ensureReady so the engine initialises from the compiled module
// rather than attempting a network fetch at runtime. Cast through unknown because the ambient
// declaration must satisfy the compiler in all contexts, not just this assignment.
const decryptionWasm = decryptionWasmModule as unknown as WebAssembly.Module;

// atob -> Uint8Array. Duplicated from routes/files/decryption.ts rather than imported: both are small,
// private, and re-exporting them would couple two otherwise-independent route boundaries for no
// real benefit.
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// SHA-256 of raw bytes, returned as lowercase hex. Used exclusively for the redacted audit record —
// the digest identifies which file recovery was started against without retaining its content.
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const RecoveryTier = z.enum(["cfCapable", "gpuRequired"]);
const RecoveryStatus = z.enum(["queued", "running", "found", "exhausted", "needsGpu", "cancelled"]);

const RecoverStartRequest = z.object({
  fileBase64: z.string().min(1),
  // Validated manually in the handler: authorized must be true; false returns 400 rather than 422
  // so the client receives a stable problem code rather than a generic validation failure.
  attestation: z.object({ authorized: z.boolean() }),
});

const RecoverStartResponse = z
  .object({ jobId: z.string(), tier: RecoveryTier, status: RecoveryStatus })
  .openapi("RecoveryStartResponse");

const recoverStartMeta: RouteMeta = {
  operationId: "decryption.recoverStart",
  surface: "app",
  authenticated: true,
  permission: "tools:decryption",
  resource: "firm",
  // Writes a decryption.recovery_started audit row — the chain-of-custody record that a recovery
  // job was started, who started it, and what file (by digest) it targets. Never the password.
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
};

const recoverStartRoute = defineOpenAPIRoute(recoverStartMeta, {
  method: "post",
  path: "/api/v1/decryption/recover",
  description:
    "Starts an offline password-recovery job for an encrypted file (base64): extracts a " +
    "hashcat-compatible hash and hands it to the recovery coordinator, which fans the search out " +
    "across containers on the Cloudflare-CPU tier (or reports needsGpu for a slow key-derivation " +
    "function outside that tier). Requires explicit attestation that the requester holds the file " +
    "legitimately. The file is never stored; only the extracted hash reaches the coordinator.",
  request: {
    body: {
      content: { "application/json": { schema: RecoverStartRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The started job's id, recovery tier, and initial status",
      content: { "application/json": { schema: RecoverStartResponse } },
    },
    400: {
      description:
        "Attestation not authorised, file is not encrypted, format is unsupported, or bytes are malformed",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated but the member lacks tools:decryption",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const RecoveryJobIdParam = z.object({ jobId: z.string().min(1) });

const RecoverStatusResponse = z
  .object({
    status: RecoveryStatus,
    tier: RecoveryTier,
    progress: z.object({
      candidatesTried: z.number().int(),
      shardsDone: z.number().int(),
      shardCount: z.number().int(),
    }),
    // Present only when status === "found" — surfaced once to the authorized requester (their own
    // file, already attested). Never audited, never logged.
    result: z.object({ password: z.string() }).optional(),
  })
  .openapi("RecoveryStatusResponse");

const recoverStatusMeta: RouteMeta = {
  operationId: "decryption.recoverStatus",
  surface: "app",
  authenticated: true,
  permission: "tools:decryption",
  resource: "firm",
  // A read: no state changes, so no audit row. Reads aren't mutations.
  audited: false,
  // RouteMeta's idempotency axis only distinguishes "required" (money/trust/payment/outbound-comms
  // mutations) from "optional" — there is no "none": a GET carries no request-replay concern either
  // way, so "optional" is the correct (and only available) value here, matching every other GET
  // route in this app (e.g. conversions.status).
  idempotency: "optional",
  rateLimit: "default",
};

const recoverStatusRoute = defineOpenAPIRoute(recoverStatusMeta, {
  method: "get",
  path: "/api/v1/decryption/recover/{jobId}",
  description:
    "Polls a password-recovery job's current state. On status found, the response carries " +
    "result.password — surfaced once to the user who started the job (retrieval is bound to that " +
    "identity; the password is purged after a retention window), then every later poll omits " +
    "result. Every non-found status omits result.",
  request: { params: RecoveryJobIdParam },
  responses: {
    200: {
      description: "The job's current status, tier, progress, and (when found) the password",
      content: { "application/json": { schema: RecoverStatusResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated but the member lacks tools:decryption",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No recovery job with that id was started by the requesting user",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const recoverCancelMeta: RouteMeta = {
  operationId: "decryption.recoverCancel",
  surface: "app",
  authenticated: true,
  permission: "tools:decryption",
  resource: "firm",
  // Writes a decryption.recovery_cancelled audit row (actor, jobId only).
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const recoverCancelRoute = defineOpenAPIRoute(
  {
    ...recoverCancelMeta,
    reversal: {
      kind: "none",
      reason:
        "A cancelled recovery job is terminal. Searching again is a new job with its own budget, never this one resumed.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/decryption/recover/{jobId}",
    description:
      "Cancels a password-recovery job. A no-op if the job is already terminal (found, exhausted, " +
      "needsGpu, or already cancelled) — cancel never overwrites an outcome already reached.",
    request: { params: RecoveryJobIdParam },
    responses: {
      204: { description: "The job was cancelled (or was already terminal — a no-op either way)" },
      401: {
        description: "No valid session",
        content: { "application/problem+json": { schema: Problem } },
      },
      403: {
        description: "Authenticated but the member lacks tools:decryption",
        content: { "application/problem+json": { schema: Problem } },
      },
      429: {
        description: "Rate limit exceeded",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

type RecoveryApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerRecoveryRoutes(app: RecoveryApp, chokepoint: Chokepoint): void {
  // POST /api/v1/decryption/recover — extract the recovery hash from the submitted file bytes and
  // start a coordinator job. The file is never stored; only a redacted audit row is committed
  // (digest, format, tier, shard count, actor — no content, no password material, no hash-secret).
  app.openapi(
    { ...recoverStartRoute, middleware: chokepointMiddleware(chokepoint, recoverStartRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { fileBase64, attestation } = c.req.valid("json");

      // Explicit attestation gate: the client must declare authorized: true to confirm it holds the
      // file legitimately. A false value returns 400 (not a Zod 422) so the client receives a stable
      // problem code it can distinguish from a request-shape failure.
      if (!attestation.authorized) {
        return problemJson(c, {
          type: "validation",
          status: 400,
          title: "Attestation required",
          detail:
            "The decryption tool requires attestation that the requester is authorised to submit this file. Set attestation.authorized to true.",
        });
      }

      // Enforce the firm's inspectable-size cap before decoding the base64 body, mirroring
      // decryption.inspect/unlock: the base64 representation is ~33% larger than the binary, so the
      // decoded byte count is approximately fileBase64.length x 0.75.
      const estimatedBytes = Math.ceil((fileBase64.length * 3) / 4);
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (estimatedBytes > cap) {
        return problemJson(c, {
          type: "upload-not-allowed",
          status: 400,
          title: "File too large to inspect",
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }

      // Guard against malformed base64: atob() throws DOMException on invalid input, which would
      // otherwise escape as an unhandled 500. Catch it here and return a 400 that carries no echo
      // of the submitted value.
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64(fileBase64);
      } catch {
        return problemJson(c, {
          type: "validation",
          status: 400,
          title: "File bytes could not be decoded",
          detail: "The submitted file could not be decoded. Ensure the body is valid base64.",
        });
      }

      // Initialise the decryption engine from the compiled WASM module bundled at build time.
      await ensureReady(decryptionWasm);

      let extracted: Awaited<ReturnType<typeof extractHash>>;
      try {
        extracted = await extractHash(bytes);
      } catch (error) {
        if (error instanceof DecryptionError) {
          const title =
            error.code === "notEncrypted"
              ? "The file is not encrypted"
              : error.code === "unsupported"
                ? "Encrypted file format not supported"
                : "The file could not be read";
          return problemJson(c, {
            type: "validation",
            status: 400,
            title,
            // Stable code surfaces without echoing any file content.
            detail: `The recovery tool could not extract a recovery hash (${error.code}).`,
          });
        }
        throw error;
      }

      const tier = await recoveryTier(extracted.format, extracted.hashcatMode);
      const jobId = newIdentifier("recoveryJob");
      const startInput: RecoveryStartInput = {
        tier,
        shardCount: tier === "cfCapable" ? RECOVERY_SHARD_COUNT : 0,
        hash: extracted.hash,
        format: extracted.format,
        hashcatMode: extracted.hashcatMode,
        ruleSet: "best64",
        firmId,
        jobId,
        startedByUserId: userId,
      };
      const coordinator = c.env.RECOVERY_JOB.get(
        c.env.RECOVERY_JOB.idFromName(`${firmId}:${jobId}`),
      );
      const state: RecoveryJobState = await coordinator.start(startInput);

      // Compute the SHA-256 of the raw *input* (encrypted) bytes for the audit record — the digest
      // identifies which file recovery was started against without retaining its content. Never
      // hash or store the extracted hash-secret or any decrypted content.
      const fileSha256 = await sha256Hex(bytes);
      const now = new Date().toISOString();

      const auditLogId = newIdentifier("auditLog");
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: auditLogId,
              event: "decryption.recovery_started",
              actorUserId: userId,
              // No persistent file record for this ephemeral tool operation — the digest in metadata
              // is the traceability anchor, not a database subject id.
              subjectId: null,
              metadata: {
                actorUserId: userId,
                fileSha256,
                format: extracted.format,
                tier,
                shardCount: state.progress.shardCount,
              },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      return c.json({ jobId, tier, status: state.status }, 200);
    },
  );

  // GET /api/v1/decryption/recover/{jobId} — poll the coordinator for the job's current state. A
  // read: no audit row (reads aren't mutations). result.password is included ONLY on status found.
  app.openapi(
    { ...recoverStatusRoute, middleware: chokepointMiddleware(chokepoint, recoverStatusRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { jobId } = c.req.valid("param");

      const coordinator = c.env.RECOVERY_JOB.get(
        c.env.RECOVERY_JOB.idFromName(`${firmId}:${jobId}`),
      );
      const state: RecoveryJobState = await coordinator.status();

      // Retrieval is bound to the user who started the job: the recovered password egresses here and
      // nowhere else, so a jobId that leaks to another firm member must not surrender it. A job the
      // caller did not start — and an unknown job (startedByUserId "") — are indistinguishable: both
      // 404, never revealing whether the job exists.
      if (state.startedByUserId !== userId) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Recovery job not found",
          detail: "No recovery job with that id was started by you.",
        });
      }

      const response: z.infer<typeof RecoverStatusResponse> = {
        status: state.status,
        tier: state.tier,
        progress: state.progress,
      };
      if (state.status === "found" && state.password !== null) {
        response.result = { password: state.password };
      }
      return c.json(response, 200);
    },
  );

  // DELETE /api/v1/decryption/recover/{jobId} — cancel the job. The coordinator's cancel() is
  // already a no-op once terminal (first-hit-cancel), so this is safe to call more than once.
  app.openapi(
    { ...recoverCancelRoute, middleware: chokepointMiddleware(chokepoint, recoverCancelRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { jobId } = c.req.valid("param");

      const coordinator = c.env.RECOVERY_JOB.get(
        c.env.RECOVERY_JOB.idFromName(`${firmId}:${jobId}`),
      );
      await coordinator.cancel();

      const now = new Date().toISOString();
      const auditLogId = newIdentifier("auditLog");
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: auditLogId,
              event: "decryption.recovery_cancelled",
              actorUserId: userId,
              subjectId: null,
              metadata: { actorUserId: userId, jobId },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      return c.body(null, 204);
    },
  );
}
