import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { compareToBaseline } from "@magna-carta/file-integrity/compare";
import { hashAll } from "@magna-carta/file-integrity/hash";
import { buildReceipt } from "@magna-carta/file-integrity/receipt";
import {
  getCurrentVersionForIntegrity,
  getVersionForIntegrity,
} from "@magna-carta/file-manager/queries";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../bindings.ts";
import { resolveFirmBucket } from "../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierField } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { createWorkerDigestSink } from "../../file-integrity/worker-sink.ts";

const Algorithms = z.object({
  md5: z.string(),
  sha1: z.string(),
  sha256: z.string(),
  sha384: z.string(),
  sha512: z.string(),
});

const HashResponse = z
  .object({
    algorithms: Algorithms,
    sizeBytes: z.number(),
    computedAt: z.string(),
    expectedMatch: z.enum(["md5", "sha1", "sha256", "sha384", "sha512"]).nullable(),
  })
  .openapi("FileIntegrityHashResponse");

export const fileIntegrityHashMeta: RouteMeta = {
  operationId: "fileIntegrity.hash",
  surface: "app",
  authenticated: true,
  permission: "tools:fileIntegrity",
  resource: "firm",
  audited: false,
  // Optional, and it has to be: the request body is raw bytes, and the chokepoint's
  // required-idempotency gate fingerprints a request by reading its body through Hono's
  // text-decoding cache — which would hand the hasher a UTF-8-mangled copy and produce digests of
  // something the caller never sent. Nothing is stored here, so a replay is free to recompute.
  idempotency: "optional",
  rateLimit: "default",
};

export const fileIntegrityHashRoute = defineOpenAPIRoute(fileIntegrityHashMeta, {
  method: "post",
  path: "/api/v1/file-integrity/hash",
  description:
    "Compute MD5, SHA-1, SHA-256, SHA-384 and SHA-512 digests of the request body in a single pass. Optionally report which algorithm matches an expected digest. Nothing is stored.",
  request: {
    query: z.object({ expected: z.string().min(1).max(128).optional() }),
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: {
    200: {
      description: "The five digests and byte size of the supplied body",
      content: { "application/json": { schema: HashResponse } },
    },
    400: {
      description: "Empty request body",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:fileIntegrity",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "The body exceeds the firm's inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const VerifyRequest = z.object({
  fileId: identifierField("file"),
  // The committed version to verify; the file's current version when omitted.
  versionId: identifierField("fileVersion").optional(),
});

const VerifyResponseSchema = z
  .object({
    algorithms: Algorithms,
    sizeBytes: z.number(),
    baselineSha256: z.string().nullable(),
    comparison: z.enum(["match", "mismatch", "no-baseline"]),
    computedAt: z.string(),
    receipt: z.unknown(),
  })
  .openapi("FileIntegrityVerifyResponse");

export const fileIntegrityVerifyMeta: RouteMeta = {
  operationId: "fileIntegrity.verify",
  surface: "app",
  authenticated: true,
  permission: "tools:fileIntegrity",
  resource: "firm",
  // Writes a file.integrity_verified audit row to the per-firm audit_log — the chain-of-custody
  // record that the check ran, who ran it, and what it found.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const fileIntegrityVerifyRoute = defineOpenAPIRoute(fileIntegrityVerifyMeta, {
  method: "post",
  path: "/api/v1/file-integrity/verify",
  description:
    "Recompute a stored file's digests from its bytes at rest and compare the SHA-256 to the digest recorded at intake, recording the check. Verifies the current version unless an earlier committed version is named. Returns the digests, the baseline result, and a hash receipt.",
  request: {
    body: { content: { "application/json": { schema: VerifyRequest } } },
  },
  responses: {
    200: {
      description: "The recomputed digests, the baseline comparison, and the receipt",
      content: { "application/json": { schema: VerifyResponseSchema } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:fileIntegrity",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "No clean current version exists for the file, or the named version is not one of its committed versions",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description:
        "The stored file exceeds the firm's inspectable-size cap for inline verification",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type FileIntegrityApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function matchExpected(
  algorithms: { md5: string; sha1: string; sha256: string; sha384: string; sha512: string },
  expected: string | undefined,
): "md5" | "sha1" | "sha256" | "sha384" | "sha512" | null {
  if (expected === undefined) return null;
  const wanted = expected.toLowerCase();
  for (const key of ["md5", "sha1", "sha256", "sha384", "sha512"] as const) {
    if (algorithms[key] === wanted) return key;
  }
  return null;
}

export function registerFileIntegrityRoutes(app: FileIntegrityApp, chokepoint: Chokepoint): void {
  // POST /api/v1/file-integrity/hash — stream the request body straight through the five-algorithm
  // digest. The declared application/octet-stream body carries no zod schema, so nothing parses or
  // buffers it and the raw stream reaches the hasher unbuffered; the size cap is enforced from
  // Content-Length before hashing.
  app.openapi(
    {
      ...fileIntegrityHashRoute,
      middleware: chokepointMiddleware(chokepoint, fileIntegrityHashRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
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
          title: "File too large to hash inline",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }
      const hashes = await hashAll(body, createWorkerDigestSink);
      const { expected } = c.req.valid("query");
      return c.json(
        {
          algorithms: {
            md5: hashes.md5,
            sha1: hashes.sha1,
            sha256: hashes.sha256,
            sha384: hashes.sha384,
            sha512: hashes.sha512,
          },
          sizeBytes: hashes.sizeBytes,
          computedAt: new Date().toISOString(),
          expectedMatch: matchExpected(hashes, expected),
        },
        200,
      );
    },
  );

  // POST /api/v1/file-integrity/verify — resolve the file's current clean version from the
  // firm-scoped database, read its bytes from R2, recompute all five digests, compare the SHA-256
  // to the ingest baseline, write a chain-of-custody audit row, and return the digests plus a
  // hash receipt. The R2 key is always server-resolved from the firm-scoped fileId — never
  // client-supplied.
  app.openapi(
    {
      ...fileIntegrityVerifyRoute,
      middleware: chokepointMiddleware(chokepoint, fileIntegrityVerifyRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { fileId, versionId } = c.req.valid("json");

      // Both reads are scoped by the file id, so a version id from another file resolves nothing.
      const version =
        versionId === undefined
          ? await getCurrentVersionForIntegrity(firm.firmDatabase, fileId as FileId)
          : await getVersionForIntegrity(
              firm.firmDatabase,
              fileId as FileId,
              versionId as FileVersionId,
            );
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "No verifiable version",
          status: 404,
          detail:
            versionId === undefined
              ? "The file has no clean current version to verify."
              : "That is not a committed version of this file.",
        });
      }

      // Enforce the size cap against the stored sizeBytes — never against a client-supplied value.
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (version.sizeBytes === null) {
        // A clean version should carry its byte size from ingest; a null size is an integrity gap,
        // not a licence to read unbounded bytes from R2. Refuse rather than skip the cap.
        return problemJson(c, {
          type: "not-found",
          title: "No verifiable version",
          status: 404,
          detail: "The file's stored version is missing size metadata.",
        });
      }
      if (version.sizeBytes > cap) {
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "File too large to verify inline",
          status: 413,
          detail: `The stored file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }

      // The R2 key is firm-scoped and server-resolved — never sourced from the request body.
      const object = await resolveFirmBucket(c.env, firm.bucketName).bucket.get(version.r2Key);
      if (object === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Stored bytes unavailable",
          status: 404,
          detail: "The file's stored object could not be read.",
        });
      }

      const hashes = await hashAll(object.body, createWorkerDigestSink);
      const comparison = compareToBaseline(hashes.sha256, version.contentSha256);
      const computedAt = new Date().toISOString();

      // Write the chain-of-custody audit row before returning. Metadata carries ids, digests,
      // result, size, and timestamp — never file contents or display names (redacted by default).
      const auditLogId = newIdentifier("auditLog");
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: auditLogId,
              event: "file.integrity_verified",
              actorUserId: userId,
              subjectId: fileId,
              metadata: {
                versionId: version.id,
                baselineSha256: version.contentSha256,
                computed: {
                  md5: hashes.md5,
                  sha1: hashes.sha1,
                  sha256: hashes.sha256,
                  sha384: hashes.sha384,
                  sha512: hashes.sha512,
                },
                result: comparison,
                sizeBytes: hashes.sizeBytes,
                verifiedAt: computedAt,
              },
              now: computedAt,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => computedAt },
      );

      const receipt = buildReceipt({
        tool: { name: "File Hash & Integrity", version: "1" },
        firmName: await firm.readFirmName(),
        file: { name: null, fileId, versionId: version.id },
        hashes,
        verification: {
          baselineSha256: version.contentSha256,
          comparison,
          verifiedBy: userId,
          auditLogId,
        },
        computedAt,
      });

      return c.json(
        {
          algorithms: {
            md5: hashes.md5,
            sha1: hashes.sha1,
            sha256: hashes.sha256,
            sha384: hashes.sha384,
            sha512: hashes.sha512,
          },
          sizeBytes: hashes.sizeBytes,
          baselineSha256: version.contentSha256,
          comparison,
          computedAt,
          receipt,
        },
        200,
      );
    },
  );
}
