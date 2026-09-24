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
import type { Bindings } from "../../../bindings.ts";
import { ASSEMBLY_ENGINE_VERSION } from "../../../assemblies/assembly-engine.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierPathParam, idempotencyKeyHeader } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

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

const OutputFormat = z.enum(["docx", "pdf"]);

const SubmitAssemblyRequest = z
  .object({
    templateVersionId: identifierField("documentTemplateVersion"),
    // The matter folder the produced document lands in; absent means the matter's root.
    folderId: identifierField("folder").nullable().optional(),
    // What to file. A Word template's merge always produces a word-processing document; "pdf" carries
    // that document across the same office-suite conversion the file converter uses before filing it,
    // inside the same job. A PDF is what the platform seal accepts, so a document meant to be signed is
    // assembled as one rather than converted afterwards. Defaults to "docx".
    //
    // A FILLABLE-PDF template produces a PDF and only a PDF: leave this out, or ask for "pdf". Asking
    // for "docx" is refused rather than answered with a re-typeset copy of the firm's own form.
    outputFormat: OutputFormat.optional(),
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
    // What this job set out to file, answerable before the document lands and still answerable after
    // one that failed. It is what tells a caller whether the produced document can be handed to the
    // platform seal, which takes a PDF and nothing else.
    outputFormat: OutputFormat,
    // Set once the document is filed — the File Manager handles the caller opens, converts, or sends
    // for signature.
    fileId: z.string().nullable(),
    fileVersionId: z.string().nullable(),
    // The merge fields the matter could not supply. KEYS ONLY — a caller that surfaces these is showing
    // an author which blanks to fill in, never anything a client's record held.
    absentFieldKeys: z.array(z.string()),
    // The Word merge fields the template carries unconverted, which this document therefore renders as
    // the text Word last cached in them rather than as a merged value. NAMES ONLY, on the same terms as
    // the absent keys. A non-empty list means the document reads as finished and is not.
    frozenMergeFieldNames: z.array(z.string()),
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
    "output is always a NEW document, never a new version of an existing one. Ask for outputFormat " +
    "pdf to have the merged document converted before it is filed; the job fails rather than filing " +
    "a word-processing document when the conversion cannot be done. A fillable-PDF template fills the " +
    "firm's own form and always produces a PDF; asking it for a word-processing document is refused.",
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
    "produced, plus the merge fields the matter could not supply and any Word merge fields the " +
    "template still carries — which a caller must surface, because a document that completed with " +
    "blanks in it, or with fields printing text left over from the template, is the failure this " +
    "reports. A Word merge field is not filled in by this system: it prints whatever text Word last " +
    "cached in it, which is why an assembly that meets one completes as succeeded_with_absences. " +
    "outputFormat says what the job set out to produce, so a caller knows before the document lands " +
    "whether it will be a PDF and can therefore be sealed.",
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
      // A FILLED FORM IS A PDF, and there is no route back. The merge engine emits a word-processing
      // package that the office suite can render to PDF; the form engine emits the firm's own PDF with
      // its boxes filled, and turning that into a `.docx` would be a re-typesetting of a court form —
      // a different document wearing the same name. So a form template defaults to `pdf` and refuses
      // `docx` HERE, where the caller can act on the answer, rather than becoming a failed job.
      const outputFormat = version.kind === "pdfForm" ? "pdf" : (request.outputFormat ?? "docx");
      if (version.kind === "pdfForm" && request.outputFormat === "docx") {
        return problemJson(c, {
          type: "validation",
          title: "A filled form is a PDF",
          status: 422,
          detail:
            "This template is a fillable PDF, so the document it produces is a PDF. Ask for outputFormat pdf, or leave it out.",
        });
      }

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
                  outputFormat,
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
                  // Identifiers and the requested format only — never a merge value, never a field
                  // value.
                  metadata: { matterId, templateVersionId: version.versionId, outputFormat },
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
          outputFormat,
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
              outputFormat: assembly.outputFormat,
              fileId: null,
              fileVersionId: null,
              absentFieldKeys: [],
              frozenMergeFieldNames: [],
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
          outputFormat: assembly.outputFormat,
          fileId: assembly.fileId,
          fileVersionId: assembly.fileVersionId,
          absentFieldKeys: [...assembly.absentFieldKeys],
          frozenMergeFieldNames: [...assembly.frozenFieldNames],
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
