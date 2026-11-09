import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  DecryptionError,
  detectFormat,
  ensureReady,
  extractHash,
  stripWithKey,
} from "@magna-carta/decryption";
import decryptionWasmModule from "@magna-carta/decryption/src/pkg/decryption_core_bg.wasm";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// Wrangler bundles .wasm imports as WebAssembly.Module — typed by the ambient declaration in
// worker-env.d.ts and passed to ensureReady so the engine initialises from the compiled module
// rather than attempting a network fetch at runtime. Cast through unknown because the ambient
// declaration must satisfy the compiler in all contexts, not just this assignment.
const decryptionWasm = decryptionWasmModule as unknown as WebAssembly.Module;

// atob -> Uint8Array.
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Uint8Array -> base64, chunked so large files do not blow the argument stack of String.fromCharCode.
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// SHA-256 of raw bytes, returned as lowercase hex. Used exclusively for the redacted audit record
// — the digest identifies which file was inspected without retaining its content.
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const DecryptionInspectRequest = z.object({
  fileBase64: z.string().min(1),
  // validated manually in the handler: authorized must be true; false returns 400 rather than 422
  // so the client receives a stable problem code rather than a generic validation failure
  attestation: z.object({ authorized: z.boolean() }),
});

const DecryptionInspectResponse = z
  .object({
    format: z.enum(["pdf", "zip", "ooxml"]),
    hash: z.string(),
    hashcatMode: z.number().int(),
  })
  .openapi("DecryptionInspectResponse");

export const decryptionInspectMeta: RouteMeta = {
  operationId: "decryption.inspect",
  surface: "app",
  authenticated: true,
  permission: "tools:decryption",
  resource: "firm",
  // Writes a decryption.inspected audit row to the per-firm audit_log — the chain-of-custody
  // record that the inspection ran, who ran it, and what file (by digest) was inspected.
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
};

const inspectRoute = defineOpenAPIRoute(decryptionInspectMeta, {
  method: "post",
  path: "/api/v1/decryption/inspect",
  description:
    "Detect the encrypted format of an uploaded file (base64) and extract a hashcat-compatible " +
    "recovery hash for offline password recovery. Requires explicit attestation that the requester " +
    "holds the file legitimately. Nothing is stored; only a redacted audit record is written.",
  request: {
    body: {
      content: { "application/json": { schema: DecryptionInspectRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Detected format, hashcat-compatible hash string, and hashcat mode number",
      content: { "application/json": { schema: DecryptionInspectResponse } },
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

const DecryptionUnlockRequest = z.object({
  fileBase64: z.string().min(1),
  // password is validated for presence only; strength/length are not constrained here since the
  // caller is supplying the file's own password, not setting a new one.
  password: z.string().min(1),
  // Validated manually in the handler: authorized must be true; false returns 400 rather than 422
  // so the client receives a stable problem code rather than a generic validation failure.
  attestation: z.object({ authorized: z.boolean() }),
});

const DecryptionUnlockResponse = z
  .object({
    decryptedBase64: z.string(),
    // Returned when the encrypted container encodes a filename (e.g. OOXML's internal name).
    filenameHint: z.string().optional(),
  })
  .openapi("DecryptionUnlockResponse");

export const decryptionUnlockMeta: RouteMeta = {
  operationId: "decryption.unlock",
  surface: "app",
  authenticated: true,
  permission: "tools:decryption",
  resource: "firm",
  // Writes a decryption.unlocked audit row to the per-firm audit_log — the chain-of-custody record
  // that the decryption ran, who ran it, and what file (by digest) was decrypted. The password and
  // decrypted bytes are NEVER written to the audit or to any log.
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
};

const unlockRoute = defineOpenAPIRoute(decryptionUnlockMeta, {
  method: "post",
  path: "/api/v1/decryption/unlock",
  description:
    "Decrypt a password-protected file (PDF, ZIP, or OOXML) using the supplied key and return " +
    "the decrypted bytes as base64. Requires explicit attestation that the requester holds the " +
    "file legitimately. Nothing is stored; only a redacted audit record is written.",
  request: {
    body: {
      content: { "application/json": { schema: DecryptionUnlockRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Decrypted file bytes encoded as base64, with an optional filename hint",
      content: { "application/json": { schema: DecryptionUnlockResponse } },
    },
    400: {
      description:
        "Attestation not authorised, wrong password, file is not encrypted, format unsupported, or bytes are malformed",
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

export function registerDecryptionRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/decryption/inspect — detect the encrypted format from the submitted file bytes and
  // extract a hashcat-compatible recovery hash. The file is never stored; only a redacted audit row
  // is committed (digest, format, outcome, actor — no content, no password material).
  app.openapi(
    { ...inspectRoute, middleware: chokepointMiddleware(chokepoint, inspectRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
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

      // Enforce the firm's inspectable-size cap before decoding the base64 body. The base64
      // representation is ~33% larger than the binary, so the decoded byte count is approximately
      // fileBase64.length × 0.75. Apply the cap conservatively against this estimate.
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
      // otherwise escape as an unhandled 500. Catch it here and return a 400 that carries no
      // echo of the submitted value.
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
      // Passing the module explicitly avoids the URL-fetch fallback that wasm-bindgen would
      // otherwise attempt at runtime (there is no serving URL in the Worker context).
      await ensureReady(decryptionWasm);

      let result: Awaited<ReturnType<typeof extractHash>>;
      try {
        result = await extractHash(bytes);
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
            detail: `The decryption tool could not extract a recovery hash (${error.code}).`,
          });
        }
        throw error;
      }

      // Compute the SHA-256 of the raw input bytes for the audit record. The digest identifies which
      // file was inspected without retaining its content — never store the bytes or any plaintext.
      const fileSha256 = await sha256Hex(bytes);
      const now = new Date().toISOString();

      // Write the chain-of-custody audit row before returning. Metadata carries the actor id, the
      // file digest, format, and outcome — never file content, password material, or the hash itself.
      const auditLogId = newIdentifier("auditLog");
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: auditLogId,
              event: "decryption.inspected",
              actorUserId: userId,
              // No persistent file record for this ephemeral tool operation — the digest in metadata
              // is the traceability anchor, not a database subject id.
              subjectId: null,
              metadata: {
                actorUserId: userId,
                fileSha256,
                format: result.format,
                outcome: "extracted",
                attestation: attestation.authorized,
              },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      return c.json(
        { format: result.format, hash: result.hash, hashcatMode: result.hashcatMode },
        200,
      );
    },
  );

  // POST /api/v1/decryption/unlock — decrypt a password-protected file using the supplied key and
  // return the plaintext bytes as base64. The file is never stored; only a redacted audit row is
  // committed (digest, format, outcome, actor — no password, no decrypted content, ever).
  app.openapi(
    { ...unlockRoute, middleware: chokepointMiddleware(chokepoint, unlockRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { fileBase64, password, attestation } = c.req.valid("json");

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

      // Enforce the firm's inspectable-size cap before decoding the base64 body.
      const estimatedBytes = Math.ceil((fileBase64.length * 3) / 4);
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (estimatedBytes > cap) {
        return problemJson(c, {
          type: "upload-not-allowed",
          status: 400,
          title: "File too large to decrypt",
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

      // Detect the format for the audit record from the raw bytes (lightweight magic-byte check).
      // detectFormat reuses the already-initialised engine. null means unrecognised — omit from audit
      // rather than guess.
      const detectedFormat = await detectFormat(bytes);

      let result: Awaited<ReturnType<typeof stripWithKey>>;
      try {
        result = await stripWithKey(bytes, password);
      } catch (error) {
        if (error instanceof DecryptionError) {
          if (error.code === "wrongPassword") {
            // Generic detail only — do NOT reveal whether the file or format was otherwise valid,
            // and never echo the password or any file content in the response.
            return problemJson(c, {
              type: "wrong-password",
              status: 400,
              title: "Wrong password",
              detail: "The supplied password did not decrypt the file.",
            });
          }
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
            detail: `The decryption tool could not decrypt the file (${error.code}).`,
          });
        }
        throw error;
      }

      // Compute the SHA-256 of the raw *input* (encrypted) bytes for the audit record. The digest
      // identifies which file was decrypted without retaining its content. Never hash or store the
      // decrypted bytes.
      const fileSha256 = await sha256Hex(bytes);
      const now = new Date().toISOString();

      // Build the audit metadata — actor, digest, outcome, attestation. Conditionally include format
      // when detection succeeded. NEVER include the password, the decrypted bytes, or any plaintext.
      const auditMetadata: Record<string, unknown> = {
        actorUserId: userId,
        fileSha256,
        outcome: "decrypted",
        attestation: attestation.authorized,
      };
      if (detectedFormat !== null) {
        auditMetadata["format"] = detectedFormat;
      }

      const auditLogId = newIdentifier("auditLog");
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: auditLogId,
              event: "decryption.unlocked",
              actorUserId: userId,
              // No persistent file record for this ephemeral tool operation — the digest in metadata
              // is the traceability anchor, not a database subject id.
              subjectId: null,
              metadata: auditMetadata,
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      const response: { decryptedBase64: string; filenameHint?: string } = {
        decryptedBase64: encodeBase64(result.bytes),
      };
      if (result.filenameHint !== undefined) {
        response.filenameHint = result.filenameHint;
      }
      return c.json(response, 200);
    },
  );
}
