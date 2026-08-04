import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  lookupDictionaryEntry,
  dictionaryForFirm,
} from "@magna-carta/document-assembly/dictionary";
import { legalFormatsFor } from "@magna-carta/document-assembly/format";
import { prepareTemplateVersion } from "@magna-carta/document-assembly/register";
import {
  composeTemplateArchive,
  composeTemplateRegistration,
  composeTemplateVersionRegistration,
  TEMPLATE_OBJECT_PREFIX,
} from "@magna-carta/document-assembly/template-service";
import {
  listDocumentTemplates,
  markTemplateVersionCleanStatement,
  markTemplateVersionQuarantinedStatement,
  readDocumentTemplate,
  readDocumentTemplateVersion,
  setCurrentTemplateVersionStatement,
  type DocumentTemplateRow,
} from "@magna-carta/document-assembly/template-statements";
import type {
  FieldManifest,
  MergeFieldDetection,
  NormalizationWarning,
} from "@magna-carta/document-assembly/types";
import { readFirmScanPolicy } from "@magna-carta/file-manager/scan-policy-settings";
import { computeVerdict } from "@magna-carta/file-manager/verdict";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  DocumentTemplateId,
  DocumentTemplateVersionId,
  LocationId,
  MatterTypeId,
} from "@magna-carta/identifiers/types";
import { documentTemplateNormalization } from "@magna-carta/telemetry/metrics";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { identifierPathParam, idempotencyKeyHeader } from "../contracts/common.ts";
import { paginated } from "../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";

// The template-catalogue surface: presign an upload slot, register a template (or a new version of
// one), list the catalogue, read a version's field manifest, archive a template, and read the merge-field
// dictionary as the firm sees it.
//
// Registration is where all the expensive work happens, on purpose. A template is an untrusted upload
// that will be executed against privileged firm and client data, so its macro payloads are removed and
// the stripped package is re-verified, its placeholders are normalized however Word split them, its
// drafting history is scrubbed, and its bytes are scanned — ONCE, at the moment a human is looking at
// the result — and the version's stored bytes are the output of all of it. Nothing on the assembly path
// repeats any of it.

const PRESIGN_TTL_SECONDS = 300;

// The staging prefix a raw upload lands under before registration reads it. It sits inside the
// `templates/` prefix so template bytes meter under one dimension whether or not registration
// succeeded, and a staged object is deleted once its registration has read it.
const TEMPLATE_STAGING_PREFIX = `${TEMPLATE_OBJECT_PREFIX}staging/`;

const templateParam = z.object({
  templateId: identifierPathParam("documentTemplate", "templateId"),
});

const versionFieldsParam = z.object({
  templateId: identifierPathParam("documentTemplate", "templateId"),
  versionId: identifierPathParam("documentTemplateVersion", "versionId"),
});

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

const TemplateUploadResponse = z
  .object({ uploadKey: z.string(), uploadUrl: z.string() })
  .openapi("TemplateUploadResponse");

// The opt-in flag, described once and shared by both registration operations. Converting a firm's own
// uploaded document is a change to that document, so the product asks rather than assumes: the fields
// are always detected and reported, and the rewrite happens only when this says so.
const convertMergeFieldsField = z
  .boolean()
  .optional()
  .openapi({
    description:
      "Whether to convert Word merge fields in the uploaded document into this system's {{field}} form. " +
      "Leave this off to see what the document contains first: the response lists every Word merge field " +
      "found, and the document is left exactly as you authored it. Turning it on rewrites each one in " +
      "place — the document you registered is not the document you uploaded — and is required before a " +
      "document that uses Word merge fields can be registered, because Word merge fields are not filled " +
      "in by this system as they stand.",
  });

const RegisterTemplateRequest = z
  .object({
    uploadKey: z.string().min(1),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    matterTypeId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    convertMergeFields: convertMergeFieldsField,
  })
  .openapi("RegisterTemplateRequest");

const RegisterTemplateVersionRequest = z
  .object({ uploadKey: z.string().min(1), convertMergeFields: convertMergeFieldsField })
  .openapi("RegisterTemplateVersionRequest");

const NormalizationWarningSchema = z
  .object({ code: z.string(), part: z.string(), detail: z.string() })
  .openapi("TemplateNormalizationWarning");

// One Word merge field found in the upload, reported whether or not it was converted. This is the
// feedback half of the opt-in: it is what an administrator reads before deciding.
const MergeFieldDetectionSchema = z
  .object({
    fieldName: z.string(),
    mappedKey: z.string(),
    part: z.string(),
    occurrences: z.number(),
    form: z.string(),
    mapsToKnownField: z.boolean(),
  })
  .openapi("TemplateMergeFieldDetection");

const RegisteredTemplateResponse = z
  .object({
    templateId: z.string(),
    versionId: z.string(),
    versionNumber: z.number(),
    status: z.string(),
    fieldCount: z.number(),
    // How many macro payload parts were removed from the upload before it was stored. A non-zero count
    // is what tells an administrator that the template they registered had code in it.
    macroPartsRemoved: z.number(),
    // What was found in the uploaded document, and what was done to it.
    mergeFieldsConverted: z.boolean(),
    mergeFieldsDetected: z.array(MergeFieldDetectionSchema),
    warnings: z.array(NormalizationWarningSchema),
  })
  .openapi("RegisteredTemplate");

const TemplateSummary = z
  .object({
    templateId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    matterTypeId: z.string().nullable(),
    locationId: z.string().nullable(),
    status: z.string(),
    currentVersionId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("TemplateSummary");

const TemplatePage = paginated(TemplateSummary).openapi("TemplatePage");

const TemplateFieldEntry = z
  .object({
    key: z.string(),
    format: z.string().nullable(),
    occurrences: z.number(),
    parts: z.array(z.string()),
    forms: z.array(z.string()),
    source: z.string().nullable(),
    valueType: z.string().nullable(),
    absence: z.string().nullable(),
    description: z.string().nullable(),
  })
  .openapi("TemplateFieldEntry");

const TemplateFieldsResponse = z
  .object({
    templateId: z.string(),
    versionId: z.string(),
    versionNumber: z.number(),
    normalizerVersion: z.number(),
    fields: z.array(TemplateFieldEntry),
    warnings: z.array(NormalizationWarningSchema),
  })
  .openapi("TemplateFields");

const MergeFieldEntry = z
  .object({
    key: z.string(),
    source: z.string(),
    valueType: z.string(),
    defaultFormat: z.string(),
    formats: z.array(z.string()),
    absence: z.string(),
    description: z.string(),
  })
  .openapi("MergeFieldEntry");

const MergeFieldsResponse = z.object({ fields: z.array(MergeFieldEntry) }).openapi("MergeFields");

const ArchivedTemplateResponse = z
  .object({ templateId: z.string(), status: z.literal("archived") })
  .openapi("ArchivedTemplate");

// ---------------------------------------------------------------------------------------------
// Route metadata
// ---------------------------------------------------------------------------------------------

// templates:* is firm-scoped: a template carries no matter data, so the catalogue's tenancy root is the
// firm. An ASSEMBLY is matter-rooted and carries the matter's wall like any other document operation —
// that surface lives in assemblies.ts and binds resource "matter".
function manageMeta(
  action: string,
  audited: boolean,
  idempotency: RouteMeta["idempotency"],
): RouteMeta {
  return {
    operationId: `templates.${action}`,
    surface: "app",
    authenticated: true,
    permission: "templates:manage",
    resource: "firm",
    audited,
    idempotency,
    ...(idempotency === "required" ? { idempotencyStore: "firm" as const } : {}),
    rateLimit: idempotency === "required" ? ("expensive" as const) : ("default" as const),
  };
}

// Listing and reading the dictionary are bound to documents:assemble rather than a third read key: a
// member who can assemble must be able to see what they can assemble, and a member who cannot has no
// use for the list.
function readMeta(action: string): RouteMeta {
  return {
    operationId: `templates.${action}`,
    surface: "app",
    authenticated: true,
    permission: "documents:assemble",
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const uploadRoute = defineOpenAPIRoute(manageMeta("upload", false, "optional"), {
  method: "post",
  path: "/api/v1/templates/upload",
  description:
    "Mints a staging slot for a template document and returns a short-lived presigned PUT URL the " +
    "client uploads the .docx to directly (bytes never transit the Worker). After uploading, register " +
    "the template with POST /api/v1/templates, or add a version with " +
    "POST /api/v1/templates/{templateId}/versions.",
  responses: {
    200: {
      description: "The staging key and the presigned upload URL",
      content: { "application/json": { schema: TemplateUploadResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks the required capability",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or no such template",
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

const registerRoute = defineOpenAPIRoute(manageMeta("register", true, "required"), {
  method: "post",
  path: "/api/v1/templates",
  description:
    "Registers an uploaded .docx as a new template and its first version. The upload is prepared " +
    "before it is stored: any macro content is removed and the result re-verified as macro-free, " +
    "placeholders are rewritten into one contiguous run each, the document's drafting history is " +
    "scrubbed, and the resulting bytes are scanned. The response reports everything that was found " +
    "and changed — including any macro project that was removed and every Word merge field detected. " +
    "Word merge fields are converted only when convertMergeFields is set; without it, a document that " +
    "uses them is refused with the list of fields so the choice can be made deliberately. Returns 422 " +
    "when a placeholder names no merge field, or when the document cannot be made safe to store.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: RegisterTemplateRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The template and its first version were registered",
      content: { "application/json": { schema: RegisteredTemplateResponse } },
    },
    422: {
      description: "The uploaded document cannot be registered as a template",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks the required capability",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or no such template",
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

const addVersionRoute = defineOpenAPIRoute(manageMeta("addVersion", true, "required"), {
  method: "post",
  path: "/api/v1/templates/{templateId}/versions",
  description:
    "Registers a new version of an existing template from an uploaded .docx. A template is never " +
    "edited in place: the new version is prepared and stored exactly as a first version is — same " +
    "macro removal, same placeholder normalization, same opt-in for converting Word merge fields — and " +
    "the catalogue's current version moves to it once its bytes clear the scan. Superseded versions " +
    "stay readable, because every assembled document records the exact version it came from.",
  request: {
    params: templateParam,
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: RegisterTemplateVersionRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The new version was registered",
      content: { "application/json": { schema: RegisteredTemplateResponse } },
    },
    422: {
      description: "The uploaded document cannot be registered as a template version",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks the required capability",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or no such template",
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

const listRoute = defineOpenAPIRoute(readMeta("list"), {
  method: "get",
  path: "/api/v1/templates",
  description:
    "Lists the firm's assembly templates, newest page first by name. Every template is visible to " +
    "every member who can assemble; a template bound to a matter type is still listed, and the " +
    "binding narrows which matters offer it. Filter by matter type to see only what a matter of that " +
    "type would offer.",
  request: {
    query: z.object({
      cursor: z.string().optional(),
      status: z.enum(["active", "archived"]).optional(),
      matterTypeId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "A cursor-paginated page of templates",
      content: { "application/json": { schema: TemplatePage } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks the required capability",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or no such template",
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

const fieldsRoute = defineOpenAPIRoute(readMeta("fields"), {
  method: "get",
  path: "/api/v1/templates/{templateId}/versions/{versionId}/fields",
  description:
    "Returns the merge fields a template version uses — every key, how it is rendered, how many times " +
    "and in which parts of the document it appears, and what happens when the matter has no value for " +
    "it — plus anything the preparation pass noticed. This is the authoring feedback surface: it is " +
    "what turns a template that will not assemble cleanly into a fixable message.",
  request: { params: versionFieldsParam },
  responses: {
    200: {
      description: "The version's field manifest, resolved against the merge-field dictionary",
      content: { "application/json": { schema: TemplateFieldsResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks the required capability",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or no such template",
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

const archiveRoute = defineOpenAPIRoute(manageMeta("archive", true, "optional"), {
  method: "post",
  path: "/api/v1/templates/{templateId}/archive",
  description:
    "Archives a template so it is no longer offered for assembly. Never a delete: a template that " +
    "produced a filed document has to remain explicable, so the catalogue row and every version of it " +
    "stay readable.",
  request: { params: templateParam },
  responses: {
    200: {
      description: "The template is archived",
      content: { "application/json": { schema: ArchivedTemplateResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks the required capability",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or no such template",
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

const mergeFieldsRoute = defineOpenAPIRoute(readMeta("mergeFields"), {
  method: "get",
  path: "/api/v1/merge-fields",
  description:
    "Returns the merge fields a template author may use, with the renderings each one supports and " +
    "what a document shows when the matter has no value for it. This is the list a template is " +
    "authored against; a placeholder naming anything outside it is refused at registration.",
  responses: {
    200: {
      description: "The merge-field dictionary as this firm sees it",
      content: { "application/json": { schema: MergeFieldsResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks the required capability",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or no such template",
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

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

type TemplatesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type TemplatesContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

function toSummary(row: DocumentTemplateRow): z.infer<typeof TemplateSummary> {
  return {
    templateId: row.id,
    name: row.name,
    description: row.description,
    matterTypeId: row.matterTypeId,
    locationId: row.locationId,
    status: row.status,
    currentVersionId: row.currentVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// The list cursor is the (name, id) pair of the last row of the previous page. Names are not unique, so
// the id is the tiebreaker that keeps the page boundary stable when two templates share a name.
function encodeCursor(row: DocumentTemplateRow): string {
  return btoa(JSON.stringify([row.name, row.id]));
}

function decodeCursor(cursor: string | undefined): { name: string; id: string } | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(atob(cursor));
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
      return undefined;
    }
    return { name: parsed[0], id: parsed[1] };
  } catch {
    return undefined;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface PreparedUpload {
  readonly bytes: Uint8Array;
  readonly manifest: FieldManifest;
  readonly warnings: readonly NormalizationWarning[];
  readonly normalizerVersion: number;
  readonly removedMacroParts: readonly string[];
  readonly mergeFieldDetections: readonly MergeFieldDetection[];
  readonly mergeFieldsConverted: boolean;
  readonly contentSha256: string;
}

type PreparationOutcome =
  | { readonly ok: true; readonly prepared: PreparedUpload }
  | { readonly ok: false; readonly response: ProblemResponse<422> };

// Read the staged upload, run it through the whole preparation pipeline, and hand back the bytes to
// store. Every refusal is a 422 problem naming what the author has to fix — never a partial
// registration, and never a stored version whose bytes nothing verified.
async function prepareStagedUpload(
  c: TemplatesContext,
  uploadKey: string,
  convertMergeFields: boolean,
): Promise<PreparationOutcome> {
  const firm = requireChokepointFirmContext(c);
  const firmId = requireChokepointFirmId(c);
  const logger = createWorkersLogger(c.env.TELEMETRY);
  const { bucket } = resolveFirmBucket(c.env, firm.bucketName);

  // The staging key is pinned to the session firm's own prefix, so a caller cannot name an object
  // outside it — the client's uploadKey is checked against the shape this firm's presign mints, never
  // trusted as a path.
  const expectedPrefix = `${TEMPLATE_STAGING_PREFIX}${firmId}/`;
  if (!uploadKey.startsWith(expectedPrefix) || uploadKey.includes("..")) {
    return {
      ok: false,
      response: problemJson(c, {
        type: "validation",
        title: "Unknown upload",
        status: 422,
        detail: "The upload key does not name a staged template upload for this firm.",
      }),
    };
  }

  const staged = await bucket.get(uploadKey);
  if (staged === null) {
    return {
      ok: false,
      response: problemJson(c, {
        type: "validation",
        title: "Upload not found",
        status: 422,
        detail:
          "No uploaded document was found for that upload key. Upload the file, then register it.",
      }),
    };
  }
  const uploadedBytes = new Uint8Array(await staged.arrayBuffer());

  // The metadata scrub runs over the NORMALIZED package, inside the preparation pipeline, so the
  // template's drafting history is removed once here rather than on every document it produces. It is
  // imported lazily for the same reason the scan port is: keeping the engine out of the OpenAPI-emit
  // script's module graph.
  const { createMetadataPort } = await import("@magna-carta/metadata");
  const { SCRUB_ALL } = await import("@magna-carta/metadata");
  const metadataPort = createMetadataPort();

  const preparation = await prepareTemplateVersion(
    uploadedBytes,
    async (bytes) => {
      const outcome = await metadataPort.scrub({ bytes, filename: "template.docx" }, SCRUB_ALL);
      return outcome.ok ? outcome.bytes : undefined;
    },
    {
      convertMergeFields,
      // The identity mapping today. The per-firm field-mapping library — a firm-scoped store of
      // confirmed Word-field-name to merge-field-key mappings that grows as an administrator confirms
      // them, so a second template import reuses what the first established — plugs in here and
      // nowhere else.
    },
  );

  if (!preparation.ok) {
    logger.count(documentTemplateNormalization.metricName, {
      outcome: "refused",
      placeholderForm: "brace",
    });
    const normalizationFailure = preparation.reason === "normalization-failed";
    return {
      ok: false,
      response: problemJson(c, {
        type: normalizationFailure ? "template-normalization-failed" : "template-not-activatable",
        title: normalizationFailure
          ? "The template's merge fields need fixing"
          : "The document cannot be registered as a template",
        status: 422,
        detail: preparation.detail,
        // The findings ride the standard field-error list so the authoring surface can point at each
        // one: `path` is the document part it sits in, `code` classifies it, `detail` is the message an
        // author acts on. They name parts and merge-field keys — never a resolved value, because none
        // exists at registration.
        errors: [
          ...preparation.normalizationFailures.map((finding) => ({
            path: finding.part,
            code: finding.code,
            detail:
              finding.excerpt === ""
                ? finding.detail
                : `${finding.detail} (near: ${finding.excerpt})`,
          })),
          ...preparation.macroFindings.map((finding) => ({
            path: "package",
            code: `macro-${finding.kind}`,
            detail: finding.detail,
          })),
          // Feedback rides the refusal: every Word merge field found is listed, so a caller can offer
          // the choice (convert, or edit the document in Word) rather than a dead end.
          ...preparation.mergeFieldDetections.map((detection) => ({
            path: detection.part,
            code: "word-merge-field",
            detail: `"${detection.fieldName}" appears ${detection.occurrences} time${detection.occurrences === 1 ? "" : "s"} and would become {{${detection.mappedKey}}}${detection.mapsToKnownField ? "" : ", which is not a merge field this firm has"}.`,
          })),
        ],
      }),
    };
  }

  logger.count(documentTemplateNormalization.metricName, {
    outcome: "accepted",
    placeholderForm: preparation.preparation.warnings.some(
      (warning) => warning.code === "merge-field-converted",
    )
      ? "mergeField"
      : "brace",
  });

  return {
    ok: true,
    prepared: {
      ...preparation.preparation,
      contentSha256: await sha256Hex(preparation.preparation.bytes),
    },
  };
}

// Scan the bytes that will be stored, and produce the statements that move the version off `pending`.
// A template is untrusted content that a firm will run against privileged data, so the scan is over the
// FINAL bytes — the same engine, the same firm policy, and the same verdict computation an uploaded file
// gets. It is scanned here rather than through the file-ingest consumer because that consumer resolves a
// `file_version` row by its object key, and a template is not a file; the gate it enforces (nothing
// assembles from bytes no verdict covers) is enforced by the status ladder on this row instead.
async function scanAndGateStatements(
  c: TemplatesContext,
  versionId: DocumentTemplateVersionId,
  templateId: DocumentTemplateId,
  bytes: Uint8Array,
  now: string,
): Promise<{ statements: unknown[]; activated: boolean }> {
  const firm = requireChokepointFirmContext(c);
  const database = firm.firmDatabase;
  const { resolveScanPort } = await import("../files/scan-port-binding.ts");
  const raw = await resolveScanPort(c.env).scan(new Response(bytes as unknown as BodyInit).body!, {
    sizeBytes: bytes.byteLength,
    sniffedContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const verdict = computeVerdict(raw, await readFirmScanPolicy(database));

  if (verdict.verdict === "flagged") {
    return {
      statements: [
        markTemplateVersionQuarantinedStatement(
          database,
          versionId,
          verdict.reason,
          raw.engineVersion,
        ),
      ],
      activated: false,
    };
  }
  return {
    statements: [
      markTemplateVersionCleanStatement(
        database,
        versionId,
        verdict.verdict,
        raw.engineVersion,
        verdict.verdict === "unscanned" ? verdict.reason : null,
        now,
      ),
      setCurrentTemplateVersionStatement(database, templateId, versionId, now),
    ],
    activated: true,
  };
}

export function registerTemplatesRoutes(app: TemplatesApp, chokepoint: Chokepoint): void {
  // POST /api/v1/templates/upload — mint a staging slot and a presigned PUT URL.
  app.openapi(
    { ...uploadRoute, middleware: chokepointMiddleware(chokepoint, uploadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const { bucketName } = resolveFirmBucket(c.env, firm.bucketName);
      // The staging key is server-minted from the SESSION firm id, never from client input.
      const uploadKey = `${TEMPLATE_STAGING_PREFIX}${firmId}/${newIdentifier("documentTemplateVersion")}`;
      const uploadUrl = await presignerForEnv(c.env).presignPut(
        bucketName,
        uploadKey,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        PRESIGN_TTL_SECONDS,
      );
      return c.json({ uploadKey, uploadUrl }, 200);
    },
  );

  // POST /api/v1/templates — register a template plus its first version.
  app.openapi(
    { ...registerRoute, middleware: chokepointMiddleware(chokepoint, registerRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");

      const outcome = await prepareStagedUpload(
        c,
        request.uploadKey,
        request.convertMergeFields === true,
      );
      if (!outcome.ok) return outcome.response;

      const now = (): string => new Date().toISOString();
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const registration = composeTemplateRegistration(
            firm.firmDatabase,
            {
              name: request.name,
              description: request.description ?? null,
              matterTypeId: (request.matterTypeId ?? null) as MatterTypeId | null,
              locationId: (request.locationId ?? null) as LocationId | null,
              preparation: outcome.prepared,
              contentSha256: outcome.prepared.contentSha256,
            },
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
          );
          // The bytes are written before the rows commit: a written object with no row is a stray
          // object the metering sweep reconciles, while a committed row pointing at bytes that were
          // never written is a template that fails at 4:55pm on a filing deadline.
          await bucket.put(registration.r2Key, outcome.prepared.bytes as unknown as ArrayBuffer);
          const gate = await scanAndGateStatements(
            c,
            registration.versionId,
            registration.templateId,
            outcome.prepared.bytes,
            now(),
          );
          const body = {
            templateId: registration.templateId,
            versionId: registration.versionId,
            versionNumber: 1,
            status: gate.activated ? "clean" : "quarantined",
            fieldCount: outcome.prepared.manifest.fields.length,
            macroPartsRemoved: outcome.prepared.removedMacroParts.length,
            mergeFieldsConverted: outcome.prepared.mergeFieldsConverted,
            mergeFieldsDetected: outcome.prepared.mergeFieldDetections,
            warnings: outcome.prepared.warnings,
          };
          return {
            write: {
              statements: [
                ...registration.effect.statements,
                ...(gate.statements as typeof registration.effect.statements),
              ],
              outboxMessages: registration.effect.outboxMessages,
            },
            responseCode: 201,
            responseBody: JSON.stringify(body),
          };
        },
      });

      // The staged upload has served its purpose; leaving it would meter twice for the same template.
      await bucket.delete(request.uploadKey);
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof RegisteredTemplateResponse>,
        201,
      );
    },
  );

  // POST /api/v1/templates/{templateId}/versions — a new version of an existing template.
  app.openapi(
    { ...addVersionRoute, middleware: chokepointMiddleware(chokepoint, addVersionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { templateId } = c.req.valid("param");
      const request = c.req.valid("json");

      const template = await readDocumentTemplate(firm.firmDatabase, templateId);
      if (template === undefined) return notFound(c, "No such template.");
      if (template.status !== "active") {
        return problemJson(c, {
          type: "template-not-activatable",
          title: "The template is archived",
          status: 422,
          detail: "An archived template takes no new versions.",
        });
      }

      const outcome = await prepareStagedUpload(
        c,
        request.uploadKey,
        request.convertMergeFields === true,
      );
      if (!outcome.ok) return outcome.response;

      const now = (): string => new Date().toISOString();
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const registration = await composeTemplateVersionRegistration(
            firm.firmDatabase,
            templateId,
            {
              name: template.name,
              description: template.description,
              matterTypeId: template.matterTypeId,
              locationId: template.locationId,
              preparation: outcome.prepared,
              contentSha256: outcome.prepared.contentSha256,
            },
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
          );
          await bucket.put(registration.r2Key, outcome.prepared.bytes as unknown as ArrayBuffer);
          const gate = await scanAndGateStatements(
            c,
            registration.versionId,
            templateId,
            outcome.prepared.bytes,
            now(),
          );
          const version = await readDocumentTemplateVersion(
            firm.firmDatabase,
            registration.versionId,
          );
          const body = {
            templateId,
            versionId: registration.versionId,
            versionNumber: version?.versionNumber ?? 0,
            status: gate.activated ? "clean" : "quarantined",
            fieldCount: outcome.prepared.manifest.fields.length,
            macroPartsRemoved: outcome.prepared.removedMacroParts.length,
            mergeFieldsConverted: outcome.prepared.mergeFieldsConverted,
            mergeFieldsDetected: outcome.prepared.mergeFieldDetections,
            warnings: outcome.prepared.warnings,
          };
          return {
            write: {
              statements: [
                ...registration.effect.statements,
                ...(gate.statements as typeof registration.effect.statements),
              ],
              outboxMessages: registration.effect.outboxMessages,
            },
            responseCode: 201,
            responseBody: JSON.stringify(body),
          };
        },
      });

      await bucket.delete(request.uploadKey);
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof RegisteredTemplateResponse>,
        201,
      );
    },
  );

  // GET /api/v1/templates — the catalogue list.
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const after = decodeCursor(query.cursor);
      const pageSize = 50;
      const rows = await listDocumentTemplates(firm.firmDatabase, {
        status: query.status,
        matterTypeId: query.matterTypeId as MatterTypeId | undefined,
        limit: pageSize + 1,
        afterName: after?.name,
        afterId: after?.id,
      });
      const page = rows.slice(0, pageSize);
      const last = page.at(-1);
      return c.json(
        {
          data: page.map(toSummary),
          nextCursor: rows.length > pageSize && last !== undefined ? encodeCursor(last) : null,
        },
        200,
      );
    },
  );

  // GET /api/v1/templates/{templateId}/versions/{versionId}/fields — the authoring feedback surface.
  app.openapi(
    { ...fieldsRoute, middleware: chokepointMiddleware(chokepoint, fieldsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { templateId, versionId } = c.req.valid("param");
      const version = await readDocumentTemplateVersion(firm.firmDatabase, versionId);
      if (version === undefined || version.templateId !== templateId) {
        return notFound(c, "No such template version.");
      }
      const manifest = parseManifestJson(version.fieldManifestJson);
      const warnings = parseWarningsJson(version.normalizationWarningsJson);
      return c.json(
        {
          templateId,
          versionId,
          versionNumber: version.versionNumber,
          normalizerVersion: version.normalizerVersion,
          fields: manifest.fields.map((field) => {
            const entry = lookupDictionaryEntry(field.key);
            return {
              key: field.key,
              format: field.format,
              occurrences: field.occurrences,
              parts: [...field.parts],
              forms: [...field.forms],
              source: entry?.source ?? null,
              valueType: entry?.valueType ?? null,
              absence: entry?.absence ?? null,
              description: entry?.description ?? null,
            };
          }),
          warnings: warnings.map((warning) => ({
            code: warning.code,
            part: warning.part,
            detail: warning.detail,
          })),
        },
        200,
      );
    },
  );

  // POST /api/v1/templates/{templateId}/archive — soft-archive.
  app.openapi(
    { ...archiveRoute, middleware: chokepointMiddleware(chokepoint, archiveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { templateId } = c.req.valid("param");
      const template = await readDocumentTemplate(firm.firmDatabase, templateId);
      if (template === undefined) return notFound(c, "No such template.");
      const now = (): string => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        composeTemplateArchive(firm.firmDatabase, templateId, {
          clock: { now },
          actorUserId: userId,
          randomSource: cryptoRandomSource,
        }),
        { now },
      );
      return c.json({ templateId, status: "archived" as const }, 200);
    },
  );

  // GET /api/v1/merge-fields — the dictionary a template is authored against.
  app.openapi(
    { ...mergeFieldsRoute, middleware: chokepointMiddleware(chokepoint, mergeFieldsRoute) },
    (c) =>
      c.json(
        {
          fields: dictionaryForFirm().map((entry) => ({
            key: entry.key,
            source: entry.source,
            valueType: entry.valueType,
            defaultFormat: entry.defaultFormat,
            formats: [...legalFormatsFor(entry.valueType)],
            absence: entry.absence,
            description: entry.description,
          })),
        },
        200,
      ),
  );
}

function parseManifestJson(json: string): FieldManifest {
  try {
    const parsed = JSON.parse(json) as Partial<FieldManifest>;
    return {
      fields: Array.isArray(parsed.fields) ? parsed.fields : [],
      totalOccurrences: typeof parsed.totalOccurrences === "number" ? parsed.totalOccurrences : 0,
    };
  } catch {
    return { fields: [], totalOccurrences: 0 };
  }
}

function parseWarningsJson(json: string): NormalizationWarning[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as NormalizationWarning[]) : [];
  } catch {
    return [];
  }
}

function notFound(c: TemplatesContext, detail: string): ProblemResponse<404> {
  return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail });
}
