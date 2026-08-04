import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import {
  insertDocumentAssemblyStatement,
  readDocumentAssembly,
} from "@magna-carta/document-assembly/assembly-statements";
import { DICTIONARY_VERSION } from "@magna-carta/document-assembly/resolve";
import { readTemplateVersionForAssembly } from "@magna-carta/document-assembly/template-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  DocumentAssemblyId,
  DocumentTemplateVersionId,
  FolderId,
} from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import { ASSEMBLY_ENGINE_VERSION } from "../assemblies/assembly-engine.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { identifierField, identifierPathParam, idempotencyKeyHeader } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// The assembly surface: submit a job onto a matter, and poll it.
//
// The submit route does three things and NOTHING else: authorize, persist the assembly row, start the
// coordinator Durable Object. No template read for its bytes, no merge resolution, no R2 access — all of
// that is the consumer's, off the request path, because reading a template package, parsing OOXML, and
// resolving a merge context are exactly the work that must never sit where a user is waiting.
//
// Both routes are matter-rooted: an assembly carries the matter's ethical wall like every other document
// operation, which is why they bind resource "matter" rather than the firm the catalogue belongs to.

const matterParam = z.object({ matterId: identifierPathParam("matter", "matterId") });

const assemblyParam = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  assemblyId: identifierPathParam("documentAssembly", "assemblyId"),
});

const SubmitAssemblyRequest = z
  .object({
    templateVersionId: identifierField("documentTemplateVersion"),
    // The matter folder the produced document lands in; absent means the matter's root.
    folderId: identifierField("folder").nullable().optional(),
  })
  .openapi("SubmitAssemblyRequest");

const SubmittedAssemblyResponse = z
  .object({ assemblyId: z.string(), status: z.literal("queued") })
  .openapi("SubmittedAssembly");

const AssemblyStatusResponse = z
  .object({
    assemblyId: z.string(),
    status: z.enum(["queued", "running", "done", "failed"]),
    outcome: z.string().nullable(),
    // Set once the document is filed — the File Manager handles the caller opens, converts, or sends
    // for signature.
    fileId: z.string().nullable(),
    fileVersionId: z.string().nullable(),
    // The merge fields the matter could not supply. KEYS ONLY — a caller that surfaces these is showing
    // an author which blanks to fill in, never anything a client's record held.
    absentFieldKeys: z.array(z.string()),
    reason: z.string().nullable(),
  })
  .openapi("AssemblyStatus");

const submitMeta: RouteMeta = {
  operationId: "assemblies.submit",
  surface: "app",
  authenticated: true,
  permission: "documents:assemble",
  resource: "matter",
  audited: true,
  // Required, not optional: a retried submit must not file two documents onto the matter.
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "expensive",
};

const statusMeta: RouteMeta = {
  operationId: "assemblies.status",
  surface: "app",
  authenticated: true,
  permission: "documents:assemble",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const submitRoute = defineOpenAPIRoute(submitMeta, {
  method: "post",
  path: "/api/v1/matters/{matterId}/assemblies",
  description:
    "Assembles a document from a template version against this matter and files it into the matter's " +
    "documents. Returns 202 with a handle to poll: the merge runs in the background and the produced " +
    "document enters the matter through the same upload and scan path every other file does. The " +
    "output is always a NEW document, never a new version of an existing one.",
  request: {
    params: matterParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SubmitAssemblyRequest } }, required: true },
  },
  responses: {
    202: {
      description: "The assembly was accepted and is now queued",
      content: { "application/json": { schema: SubmittedAssemblyResponse } },
    },
    422: {
      description: "The template version cannot be assembled from",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks documents:assemble",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The firm is unreachable, the member is deactivated, or no such matter or assembly",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is already in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const statusRoute = defineOpenAPIRoute(statusMeta, {
  method: "get",
  path: "/api/v1/matters/{matterId}/assemblies/{assemblyId}",
  description:
    "Returns an assembly's current state. A finished assembly carries the document and version it " +
    "produced, plus the merge fields the matter could not supply — which a caller must surface, " +
    "because a document that completed with blanks in it is the failure this reports.",
  request: { params: assemblyParam },
  responses: {
    200: {
      description: "The assembly's current state",
      content: { "application/json": { schema: AssemblyStatusResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks documents:assemble",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The firm is unreachable, the member is deactivated, or no such matter or assembly",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is already in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type AssembliesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type AssembliesContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerAssembliesRoutes(app: AssembliesApp, chokepoint: Chokepoint): void {
  // POST /api/v1/matters/{matterId}/assemblies — authorize, persist, start. Nothing else.
  app.openapi(
    { ...submitRoute, middleware: chokepointMiddleware(chokepoint, submitRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId } = c.req.valid("param");
      const request = c.req.valid("json");

      // The one read the submit path takes: a version that is archived, quarantined, or belongs to a
      // template that was archived must be refused HERE, while the caller can act on the answer, rather
      // than becoming a failed job they have to poll for.
      const version = await readTemplateVersionForAssembly(
        firm.firmDatabase,
        request.templateVersionId as DocumentTemplateVersionId,
      );
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such template version.",
        });
      }
      if (version.status !== "clean" || version.templateStatus !== "active") {
        return problemJson(c, {
          type: "template-not-activatable",
          title: "The template cannot be assembled from",
          status: 422,
          detail:
            version.templateStatus !== "active"
              ? "The template is archived."
              : "The template version has not cleared the file scan.",
        });
      }

      const now = (): string => new Date().toISOString();
      const { bucketName } = resolveFirmBucket(c.env, firm.bucketName);

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: () => {
          const assemblyId = newIdentifier("documentAssembly", cryptoRandomSource);
          return Promise.resolve({
            write: {
              statements: [
                insertDocumentAssemblyStatement(firm.firmDatabase, {
                  id: assemblyId,
                  matterId,
                  templateId: version.templateId,
                  templateVersionId: version.versionId,
                  folderId: (request.folderId ?? null) as FolderId | null,
                  engineVersion: ASSEMBLY_ENGINE_VERSION,
                  dictionaryVersion: DICTIONARY_VERSION,
                  requestedBy: userId,
                  createdAt: now(),
                }),
                domainAuditStatement(firm.firmDatabase, {
                  event: "documentAssembly.submitted",
                  subjectId: assemblyId,
                  actorUserId: userId,
                  clock: { now },
                  randomSource: cryptoRandomSource,
                  // Identifiers only — never a merge value, never a field value.
                  metadata: { matterId, templateVersionId: version.versionId },
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 202,
            responseBody: JSON.stringify({ assemblyId, status: "queued" }),
          });
        },
      });

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }

      // The coordinator is started only for a freshly executed submit; a replay already has its job
      // running (or finished) under the same handle, and start() is idempotent besides.
      const body = JSON.parse(result.responseBody ?? "{}") as { assemblyId?: string };
      const assemblyId = body.assemblyId ?? "";
      if (result.kind === "executed" && assemblyId !== "") {
        const coordinator = c.env.DOCUMENT_ASSEMBLY_JOB.get(
          c.env.DOCUMENT_ASSEMBLY_JOB.idFromName(`${firmId}:${assemblyId}`),
        );
        await coordinator.start({
          firmId,
          bucketName,
          assemblyId,
          matterId,
          templateVersionId: version.versionId,
          folderId: request.folderId ?? null,
          requestedBy: userId,
        });
      }

      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof SubmittedAssemblyResponse>,
        202,
      );
    },
  );

  // GET /api/v1/matters/{matterId}/assemblies/{assemblyId} — poll.
  app.openapi(
    { ...statusRoute, middleware: chokepointMiddleware(chokepoint, statusRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId, assemblyId } = c.req.valid("param");
      // Read the row, not the Durable Object: the row is scoped by its matter, which is what stops a
      // caller who can reach one matter from polling an assembly that belongs to another. The
      // coordinator is consulted only for a job that has not reported back yet.
      const assembly = await readDocumentAssembly(
        firm.firmDatabase,
        matterId,
        assemblyId as DocumentAssemblyId,
      );
      if (assembly === undefined) return notFound(c);

      if (assembly.status === "queued" || assembly.status === "running") {
        const firmId = requireChokepointFirmId(c);
        const coordinator = c.env.DOCUMENT_ASSEMBLY_JOB.get(
          c.env.DOCUMENT_ASSEMBLY_JOB.idFromName(`${firmId}:${assemblyId}`),
        );
        const state = await coordinator.status();
        // The stuck alarm can fail a job that never reported, and the row would still read `queued`.
        if (state.status === "failed") {
          return c.json(
            {
              assemblyId,
              status: "failed" as const,
              outcome: "failed",
              fileId: null,
              fileVersionId: null,
              absentFieldKeys: [],
              reason: state.reason,
            },
            200,
          );
        }
      }

      return c.json(
        {
          assemblyId,
          status: assembly.status,
          outcome: assembly.outcome,
          fileId: assembly.fileId,
          fileVersionId: assembly.fileVersionId,
          absentFieldKeys: [...assembly.absentFieldKeys],
          reason: assembly.failureReason,
        },
        200,
      );
    },
  );
}

function notFound(c: AssembliesContext): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: "No such assembly on this matter.",
  });
}
