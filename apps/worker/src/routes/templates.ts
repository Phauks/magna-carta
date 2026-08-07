import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  availabilityFor,
  availabilityNoteFor,
  lookupDictionaryEntry,
  dictionaryForFirm,
} from "@magna-carta/document-assembly/dictionary";
import { MERGE_FIELD_GROUPS } from "@magna-carta/document-assembly/catalog-groups";
import { mergeSubject } from "@magna-carta/document-assembly/catalog-subjects";
import { customFieldDictionaryEntries } from "@magna-carta/document-assembly/custom-field-bindings";
import {
  mergeFieldCatalogRevision,
  readCustomFieldCatalog,
} from "@magna-carta/document-assembly/resolve";
import {
  deleteFieldMappingEffect,
  fieldMappingResolverFor,
  listFieldMappings,
  readFieldMapping,
} from "@magna-carta/document-assembly/field-mapping-statements";
import { legalFormatsFor } from "@magna-carta/document-assembly/format";
import type { ConfirmedMergeFieldMapping } from "@magna-carta/document-assembly/normalize";
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
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type {
  DocumentTemplateFieldMappingId,
  DocumentTemplateId,
  DocumentTemplateVersionId,
  LocationId,
  MatterTypeId,
} from "@magna-carta/identifiers/types";
import {
  documentTemplateExpressionCheck,
  documentTemplateFieldBinding,
  documentTemplateNormalization,
} from "@magna-carta/telemetry/metrics";
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
  .object({
    uploadKey: z.string(),
    uploadUrl: z.string(),
    // The headers the staged upload must carry. They are covered by the URL's signature, so an upload
    // that sends anything less is rejected by storage rather than landing an unclassified object.
    uploadHeaders: z.record(z.string(), z.string()),
  })
  .openapi("TemplateUploadResponse");

// The two opt-in flags, described once and shared by both registration operations. Each one authorizes
// a change to the firm's OWN uploaded document, so the product asks rather than assumes: what the
// document contains is always detected and reported, and a rewrite happens only when the request says
// so.
const convertMergeFieldsField = z
  .boolean()
  .optional()
  .openapi({
    description:
      "Whether to convert Word merge fields in the uploaded document into this system's {{field}} form. " +
      "Leave this off and the document registers exactly as you authored it, with every Word merge " +
      "field listed in the response and recorded against the template — but those fields are not filled " +
      "in by this system, so every document assembled from the template prints the text Word last " +
      "cached in them, and each assembly reports that too. Turning it on rewrites each one in place: " +
      "the document registered is then not the document uploaded.",
  });

const stripMacrosField = z
  .boolean()
  .optional()
  .openapi({
    description:
      "Whether to remove macro content from the uploaded document. A template is run against " +
      "privileged client data, so one carrying macros cannot be stored: without this, an upload that " +
      "contains any is refused, and the response lists what was found. Turning it on removes the macro " +
      "project along with the content-type and relationship declarations that reference it, re-checks " +
      "the result from scratch, and refuses the registration outright if anything survived — the " +
      "document registered is then not the document uploaded. Uploading a macro-free copy of the file " +
      "is the other way through.",
  });

const RegisterTemplateRequest = z
  .object({
    uploadKey: z.string().min(1),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    matterTypeId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    convertMergeFields: convertMergeFieldsField,
    stripMacros: stripMacrosField,
  })
  .openapi("RegisterTemplateRequest");

const RegisterTemplateVersionRequest = z
  .object({
    uploadKey: z.string().min(1),
    convertMergeFields: convertMergeFieldsField,
    stripMacros: stripMacrosField,
  })
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
    // Whether the key came from this firm's own confirmed mappings rather than from the Word name
    // already matching a merge field.
    mappedFromLibrary: z.boolean(),
    // The text this field prints today — what Word cached in it the last time the document was merged.
    frozenText: z.string(),
  })
  .openapi("TemplateMergeFieldDetection");

// One Word merge field the REGISTERED version still carries, because conversion was not asked for.
// Recorded against the template, not refused: the field is then something every later reader can see
// and report, including every assembly, instead of a template nobody can register or inspect.
const UnconvertedMergeFieldSchema = z
  .object({
    fieldName: z.string(),
    mappedKey: z.string(),
    part: z.string(),
    occurrences: z.number(),
    form: z.string(),
    mapsToKnownField: z.boolean(),
    frozenText: z.string(),
  })
  .openapi("TemplateUnconvertedMergeField");

const RegisteredTemplateResponse = z
  .object({
    templateId: z.string(),
    versionId: z.string(),
    versionNumber: z.number(),
    status: z.string(),
    fieldCount: z.number(),
    // Whether the macro removal was asked for and ran, and how many payload parts it took out. Zero
    // with macrosStripped true means the removal was requested and the document had nothing in it.
    macrosStripped: z.boolean(),
    macroPartsRemoved: z.number(),
    // What was found in the uploaded document, and what was done to it.
    mergeFieldsConverted: z.boolean(),
    mergeFieldsDetected: z.array(MergeFieldDetectionSchema),
    // The merge fields the stored version still carries. Empty when conversion ran, or when the
    // document never used any. A non-empty list means documents assembled from this template will
    // print frozen text where those fields sit.
    unconvertedMergeFields: z.array(UnconvertedMergeFieldSchema),
    // The name-to-key mappings this registration added to the firm's field-mapping library, so a later
    // import of documents from the same source arrives already mapped.
    confirmedFieldMappings: z.array(z.object({ fieldName: z.string(), mergeKey: z.string() })),
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
    // Whether this field's value is held encrypted. A `protected` field is filled in only for a member
    // who holds the permission to decrypt it, and doing so is recorded; for anyone else it renders as a
    // marked gap. Carried here so the field-input surface can say that before anyone assembles.
    sensitivity: z.string().nullable(),
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
    // The Word merge fields this version carries unconverted, with the text each one prints. The field
    // inspector's other half: these are blanks that do not look like blanks.
    unconvertedMergeFields: z.array(UnconvertedMergeFieldSchema),
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
    // Whether the field's value is held encrypted — see TemplateFieldEntry. A template may bind a
    // protected field whoever registers it: a binding names a key, not a value, and nothing is decrypted
    // until a document is assembled. Marking it here is what lets the picker say so at the moment an
    // author chooses it.
    sensitivity: z.string(),
    description: z.string(),
    // What a person calls the field, and where a picker files it. A catalogue of hundreds is unusable
    // without them, and they belong to the field rather than to any one surface's idea of it.
    label: z.string(),
    group: z.string(),
    subject: z.string(),
    subjectLabel: z.string(),
    // Ordering and default visibility, never a filter: a field that exists stays findable by search.
    prominence: z.string(),
    // Search words a firm would type — "defendant" for the opposing party, "SSN" for the tax
    // identifier — so someone's own vocabulary finds the platform's key.
    synonyms: z.array(z.string()),
    // One invented sample rendering per legal format. Never firm data, so this response is the same
    // bytes for every member of a firm and safe to show before a matter is chosen.
    exampleRenderings: z.record(z.string(), z.string()),
    // Whether the value is filled from firm data, filled only when the matter carries the fact, or not
    // fillable at all. Derived from the source and the subject rather than declared per field.
    availability: z.string(),
    availabilityNote: z.string(),
    // A withdrawn field is deprecated, never removed: it still fills in, and it names what replaced it.
    status: z.string(),
    supersededBy: z.string().nullable(),
  })
  .openapi("MergeFieldEntry");

const MergeFieldGroupEntry = z
  .object({ key: z.string(), label: z.string(), order: z.number() })
  .openapi("MergeFieldGroup");

const MergeFieldsResponse = z
  .object({
    // Changes when the catalogue this firm sees changes — the platform's own version plus a digest of
    // the firm's field catalogue. A surface holding a cached copy compares this and revalidates rather
    // than refetching tens of kilobytes on every open.
    revision: z.string(),
    // The headings, in the order a picker presents them. Sent with the entries so a surface never has to
    // keep its own copy of an ordering that lives in one place.
    groups: z.array(MergeFieldGroupEntry),
    fields: z.array(MergeFieldEntry),
  })
  .openapi("MergeFields");

const ArchivedTemplateResponse = z
  .object({ templateId: z.string(), status: z.literal("archived") })
  .openapi("ArchivedTemplate");

// The firm's field-mapping library: what this firm has confirmed a Word field name means. Visible and
// editable because it is the firm's own statement about its own documents — a mapping nobody can see is
// one nobody can correct, and it silently steers every later import.
const FieldMappingEntry = z
  .object({
    mappingId: z.string(),
    fieldName: z.string(),
    mergeKey: z.string(),
    timesApplied: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MergeFieldMappingEntry");

const FieldMappingPage = paginated(FieldMappingEntry).openapi("MergeFieldMappingPage");

const DeletedFieldMappingResponse = z
  .object({ mappingId: z.string(), deleted: z.literal(true) })
  .openapi("DeletedMergeFieldMapping");

const fieldMappingParam = z.object({
  mappingId: identifierPathParam("documentTemplateFieldMapping", "mappingId"),
});

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
    "before it is stored: placeholders are rewritten into one contiguous run each, the document's " +
    "drafting history is scrubbed, and the resulting bytes are scanned. The response reports " +
    "everything that was found and everything that changed. Neither transform of your own document " +
    "runs unasked: macro content is removed only when stripMacros is set, and an upload carrying any " +
    "without it is refused with what was found; Word merge fields are converted only when " +
    "convertMergeFields is set, and without it the document registers exactly as authored with every " +
    "such field recorded against the template — those fields are not filled in by this system, so " +
    "every assembly of it prints the text Word cached in them and says so. Returns 422 when a " +
    "placeholder names no merge field, when macro content is present without the removal opt-in, or " +
    "when the document cannot be made safe to store.",
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
    "placeholder normalization, same opt-ins for removing macro content and converting Word merge " +
    "fields — and the catalogue's current version moves to it once its bytes clear the scan. " +
    "Superseded versions stay readable, because every assembled document records the exact version it " +
    "came from.",
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
    "authored against; a placeholder naming anything outside it is refused at registration. A field " +
    "marked protected holds an encrypted value: any author may bind it, and it is filled in only for " +
    "a member permitted to decrypt it, which is recorded.",
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

const fieldMappingsRoute = defineOpenAPIRoute(manageMeta("fieldMappings", false, "optional"), {
  method: "get",
  path: "/api/v1/merge-field-mappings",
  description:
    "Lists what this firm has confirmed its Word merge-field names mean. Each entry was recorded when " +
    "a template registration converted that field, and every later registration consults the list, so " +
    "importing a second document from the same source does not ask the same question again. Nothing " +
    "is ever added by guessing: a name this firm has not confirmed is reported as unmapped rather " +
    "than matched to something that looked close.",
  request: { query: z.object({ cursor: z.string().optional() }) },
  responses: {
    200: {
      description: "A cursor-paginated page of confirmed merge-field mappings",
      content: { "application/json": { schema: FieldMappingPage } },
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

const deleteFieldMappingRoute = defineOpenAPIRoute(
  manageMeta("deleteFieldMapping", true, "optional"),
  {
    method: "delete",
    path: "/api/v1/merge-field-mappings/{mappingId}",
    description:
      "Withdraws a confirmed merge-field mapping. A mapping is a statement this firm made about its " +
      "own documents, so it is removed outright rather than archived. Nothing already registered " +
      "changes: a template version's stored bytes and its field list are immutable, and the mapping " +
      "only ever acted at the moment a registration converted a field. The next registration that " +
      "meets this Word field name will report it as unmapped again.",
    request: { params: fieldMappingParam },
    responses: {
      200: {
        description: "The mapping is withdrawn",
        content: { "application/json": { schema: DeletedFieldMappingResponse } },
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
        description: "The firm is unreachable, the member is deactivated, or no such mapping",
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
  },
);

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

// What a registration tells the administrator about their own document: what was found, what was done
// to it, and what the stored version still carries. One home, so a first version and a new version of
// an existing template can never report differently on the same facts.
function registrationFeedback(prepared: PreparedUpload) {
  return {
    macrosStripped: prepared.macrosStripped,
    macroPartsRemoved: prepared.removedMacroParts.length,
    mergeFieldsConverted: prepared.mergeFieldsConverted,
    mergeFieldsDetected: prepared.mergeFieldDetections,
    unconvertedMergeFields: prepared.manifest.unconvertedMergeFields,
    confirmedFieldMappings: prepared.confirmedMergeFieldMappings,
    warnings: prepared.warnings,
  };
}

// The normalization findings that are about a CALCULATION rather than about a placeholder's
// delimiters. They route to their own problem type, because what an author has to fix is different:
// one is a name, a type, or a rendering, the other is a brace.
const EXPRESSION_FAILURE_CODES: ReadonlySet<string> = new Set([
  "expression-syntax-error",
  "expression-unknown-key",
  "expression-type-error",
  "expression-too-complex",
  "expression-format-illegal",
  "block-unbalanced",
  "block-nesting-too-deep",
]);

interface PreparedUpload {
  readonly bytes: Uint8Array;
  readonly manifest: FieldManifest;
  readonly warnings: readonly NormalizationWarning[];
  readonly normalizerVersion: number;
  readonly removedMacroParts: readonly string[];
  readonly macrosStripped: boolean;
  readonly mergeFieldDetections: readonly MergeFieldDetection[];
  readonly mergeFieldsConverted: boolean;
  readonly confirmedMergeFieldMappings: readonly ConfirmedMergeFieldMapping[];
  readonly contentSha256: string;
}

type PreparationOutcome =
  | { readonly ok: true; readonly prepared: PreparedUpload }
  | { readonly ok: false; readonly response: ProblemResponse<422> };

export interface RegistrationConsent {
  readonly convertMergeFields: boolean;
  readonly stripMacros: boolean;
}

// Read the staged upload, run it through the whole preparation pipeline, and hand back the bytes to
// store. Every refusal is a 422 problem naming what the author has to fix — never a partial
// registration, and never a stored version whose bytes nothing verified.
async function prepareStagedUpload(
  c: TemplatesContext,
  uploadKey: string,
  consent: RegistrationConsent,
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

  // The firm's field-mapping library, read ONCE and handed in as a resolver: a template with a hundred
  // Word fields must not cost a hundred lookups, the same batching rule the merge context follows.
  const resolveMergeFieldName = await fieldMappingResolverFor(firm.firmDatabase);

  // The firm's own field catalogue, read ONCE and folded into the dictionary the placeholders are
  // checked against, so a placeholder naming one of this firm's fields registers and one naming a
  // field the firm does not have is refused by name.
  const dictionary = dictionaryForFirm(
    customFieldDictionaryEntries(await readCustomFieldCatalog(firm.firmDatabase)),
  );

  const preparation = await prepareTemplateVersion(
    uploadedBytes,
    async (bytes) => {
      const outcome = await metadataPort.scrub({ bytes, filename: "template.docx" }, SCRUB_ALL);
      return outcome.ok ? outcome.bytes : undefined;
    },
    {
      convertMergeFields: consent.convertMergeFields,
      stripMacros: consent.stripMacros,
      resolveMergeFieldName,
      dictionary,
    },
  );

  if (!preparation.ok) {
    logger.count(documentTemplateNormalization.metricName, {
      outcome: "refused",
      placeholderForm: "brace",
    });
    // An expression finding and a delimiter finding are different things to fix, so they are different
    // problem types: one is about what a calculation MEANS, the other about how a placeholder is
    // written. The failure kind is counted, never the expression text — it names merge fields, and a
    // firm's own custom-field handles are in it.
    const expressionFindings = preparation.normalizationFailures.filter((finding) =>
      EXPRESSION_FAILURE_CODES.has(finding.code),
    );
    for (const finding of expressionFindings) {
      logger.count(documentTemplateExpressionCheck.metricName, {
        outcome: "refused",
        failureKind: finding.code,
      });
    }
    const expressionFailure = expressionFindings.length > 0;
    const normalizationFailure =
      preparation.reason === "normalization-failed" && !expressionFailure;
    const macroConsent = preparation.reason === "macro-consent-required";
    return {
      ok: false,
      response: problemJson(c, {
        type: expressionFailure
          ? "template-expression-invalid"
          : normalizationFailure
            ? "template-normalization-failed"
            : macroConsent
              ? "template-macro-consent-required"
              : "template-not-activatable",
        title: expressionFailure
          ? "A calculation or condition in the template needs fixing"
          : normalizationFailure
            ? "The template's merge fields need fixing"
            : macroConsent
              ? "This document contains macros"
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
          // Feedback rides the refusal, and especially the macro one: what was found is listed, so a
          // caller can offer the choice (remove them, or upload a macro-free copy) rather than a dead
          // end.
          ...preparation.macroFindings.map((finding) => ({
            path: "package",
            code: `macro-${finding.kind}`,
            detail: finding.detail,
          })),
          ...preparation.mergeFieldDetections.map((detection) => ({
            path: detection.part,
            code: "word-merge-field",
            detail: `"${detection.fieldName}" appears ${detection.occurrences} time${detection.occurrences === 1 ? "" : "s"} and would become {{${detection.mappedKey}}}${detection.mapsToKnownField ? "" : ", which is not a merge field this firm has"}.`,
          })),
        ],
      }),
    };
  }

  // One count per expression the version carries, so the accepted and refused arms share a denominator
  // — a refusal rate is only meaningful against how many expressions were checked at all.
  const acceptedExpressions =
    preparation.preparation.manifest.blocks.length +
    preparation.preparation.manifest.computedFields.length;
  for (let counted = 0; counted < acceptedExpressions; counted += 1) {
    logger.count(documentTemplateExpressionCheck.metricName, {
      outcome: "accepted",
      failureKind: "none",
    });
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

// Whether a registration's binding-index rows landed.
//
// The index is what answers "which templates break if this key goes away", so a registration whose
// bindings did not commit is a template that has become invisible to deprecation reporting and to the
// guard on destroying a firm's own field. NO MERGE-FIELD KEY IS A DIMENSION — the outcome is the whole
// signal, because a key names a firm's own custom field as often as a platform one and both are
// high-cardinality.
function countFieldBindingWrite(
  c: TemplatesContext,
  outcome: "written" | "replayed" | "refused",
): void {
  createWorkersLogger(c.env.TELEMETRY).count(documentTemplateFieldBinding.metricName, { outcome });
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
      // A template belongs to the firm, not to a matter — it is the thing matters are filled from.
      const presigned = await presignerForEnv(c.env).presignPut(
        bucketName,
        uploadKey,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        PRESIGN_TTL_SECONDS,
        firmScopedObjectDimensions("document-template"),
      );
      return c.json({ uploadKey, uploadUrl: presigned.url, uploadHeaders: presigned.headers }, 200);
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

      const outcome = await prepareStagedUpload(c, request.uploadKey, {
        convertMergeFields: request.convertMergeFields === true,
        stripMacros: request.stripMacros === true,
      });
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
          await bucket.put(registration.r2Key, outcome.prepared.bytes as unknown as ArrayBuffer, {
            customMetadata: firmScopedObjectDimensions("document-template"),
          });
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
            ...registrationFeedback(outcome.prepared),
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
        countFieldBindingWrite(c, "refused");
        return problemResponseForIdempotencyConflict(c, result);
      }
      countFieldBindingWrite(c, result.kind === "replayed" ? "replayed" : "written");
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

      const outcome = await prepareStagedUpload(c, request.uploadKey, {
        convertMergeFields: request.convertMergeFields === true,
        stripMacros: request.stripMacros === true,
      });
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
          await bucket.put(registration.r2Key, outcome.prepared.bytes as unknown as ArrayBuffer, {
            customMetadata: firmScopedObjectDimensions("document-template"),
          });
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
            ...registrationFeedback(outcome.prepared),
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
        countFieldBindingWrite(c, "refused");
        return problemResponseForIdempotencyConflict(c, result);
      }
      countFieldBindingWrite(c, result.kind === "replayed" ? "replayed" : "written");
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
      // The firm's catalogue, not the platform's: a template binding one of the firm's own fields must
      // describe it here, and a template binding a field the firm has since ARCHIVED must show the
      // binding with nothing behind it — which is exactly the repair signal this surface exists to give.
      const dictionary = dictionaryForFirm(
        customFieldDictionaryEntries(await readCustomFieldCatalog(firm.firmDatabase)),
      );
      return c.json(
        {
          templateId,
          versionId,
          versionNumber: version.versionNumber,
          normalizerVersion: version.normalizerVersion,
          fields: manifest.fields.map((field) => {
            const entry = lookupDictionaryEntry(field.key, dictionary);
            return {
              key: field.key,
              format: field.format,
              occurrences: field.occurrences,
              parts: [...field.parts],
              forms: [...field.forms],
              source: entry?.source ?? null,
              valueType: entry?.valueType ?? null,
              absence: entry?.absence ?? null,
              sensitivity: entry?.sensitivity ?? null,
              description: entry?.description ?? null,
            };
          }),
          unconvertedMergeFields: manifest.unconvertedMergeFields.map((field) => ({ ...field })),
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

  // GET /api/v1/merge-field-mappings — the firm's own confirmed Word-name-to-key mappings.
  app.openapi(
    { ...fieldMappingsRoute, middleware: chokepointMiddleware(chokepoint, fieldMappingsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const pageSize = 100;
      // The cursor is the last row's field name, which is unique in this table, so no tiebreaker is
      // needed to keep the page boundary stable.
      const rows = await listFieldMappings(firm.firmDatabase, {
        limit: pageSize + 1,
        afterFieldName: query.cursor === undefined ? undefined : atob(query.cursor),
      });
      const page = rows.slice(0, pageSize);
      const last = page.at(-1);
      return c.json(
        {
          data: page.map((row) => ({
            mappingId: row.id,
            fieldName: row.fieldName,
            mergeKey: row.mergeKey,
            timesApplied: row.timesApplied,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
          nextCursor: rows.length > pageSize && last !== undefined ? btoa(last.fieldName) : null,
        },
        200,
      );
    },
  );

  // DELETE /api/v1/merge-field-mappings/{mappingId} — withdraw one.
  app.openapi(
    {
      ...deleteFieldMappingRoute,
      middleware: chokepointMiddleware(chokepoint, deleteFieldMappingRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { mappingId } = c.req.valid("param");
      const existing = await readFieldMapping(
        firm.firmDatabase,
        mappingId as DocumentTemplateFieldMappingId,
      );
      if (existing === undefined) return notFound(c, "No such merge-field mapping.");
      const now = (): string => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        deleteFieldMappingEffect(firm.firmDatabase, existing.id, {
          clock: { now },
          actorUserId: userId,
          randomSource: cryptoRandomSource,
        }),
        { now },
      );
      return c.json({ mappingId: existing.id, deleted: true as const }, 200);
    },
  );

  // GET /api/v1/merge-fields — the dictionary a template is authored against.
  app.openapi(
    { ...mergeFieldsRoute, middleware: chokepointMiddleware(chokepoint, mergeFieldsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const catalog = await readCustomFieldCatalog(firm.firmDatabase);
      const dictionary = dictionaryForFirm(customFieldDictionaryEntries(catalog));
      return c.json(
        {
          revision: mergeFieldCatalogRevision(catalog),
          groups: MERGE_FIELD_GROUPS.map((group, order) => ({
            key: group.key,
            label: group.label,
            order,
          })),
          fields: dictionary.map((entry) => ({
            key: entry.key,
            source: entry.source,
            valueType: entry.valueType,
            defaultFormat: entry.defaultFormat,
            formats: [...legalFormatsFor(entry.valueType)],
            absence: entry.absence,
            sensitivity: entry.sensitivity,
            description: entry.description,
            label: entry.label,
            group: entry.group,
            subject: entry.subject,
            subjectLabel: mergeSubject(entry.subject)?.label ?? entry.subject,
            prominence: entry.prominence,
            synonyms: [...entry.synonyms],
            exampleRenderings: { ...entry.exampleRenderings },
            availability: availabilityFor(entry),
            availabilityNote: availabilityNoteFor(entry),
            status: entry.status,
            supersededBy: entry.supersededBy ?? null,
          })),
        },
        200,
      );
    },
  );
}

function parseManifestJson(json: string): FieldManifest {
  try {
    const parsed = JSON.parse(json) as Partial<FieldManifest>;
    return {
      fields: Array.isArray(parsed.fields) ? parsed.fields : [],
      totalOccurrences: typeof parsed.totalOccurrences === "number" ? parsed.totalOccurrences : 0,
      // Absent on a manifest stored before the field existed, which is a template that carried no
      // unconverted merge fields by construction — registration refused those outright at the time.
      unconvertedMergeFields: Array.isArray(parsed.unconvertedMergeFields)
        ? parsed.unconvertedMergeFields
        : [],
      // Likewise absent on a manifest stored before conditions, repeats, and calculations existed —
      // which is a template that carried none, since registration refused a block marker outright then.
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      computedFields: Array.isArray(parsed.computedFields) ? parsed.computedFields : [],
    };
  } catch {
    return {
      fields: [],
      totalOccurrences: 0,
      unconvertedMergeFields: [],
      blocks: [],
      computedFields: [],
    };
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
