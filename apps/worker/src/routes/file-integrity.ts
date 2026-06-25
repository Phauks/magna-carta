import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { hashAll } from "@magna-carta/file-integrity/hash";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { createWorkerDigestSink } from "../file-integrity/worker-sink.ts";

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
  // digest. No request-body schema (the bytes are binary), so the raw stream reaches the hasher
  // unbuffered; the size cap is enforced from Content-Length before hashing.
  app.openapi(
    { ...fileIntegrityHashRoute, middleware: chokepointMiddleware(chokepoint, fileIntegrityHashRoute) },
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
}
