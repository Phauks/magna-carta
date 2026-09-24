import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { commitEffectBatch, guarded } from "@magna-carta/data-access/effect-batch";
import {
  type IdempotentEffectResult,
  runIdempotentEffect,
} from "@magna-carta/data-access/run-idempotent-effect";
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
  readFieldMappingLibrary,
} from "@magna-carta/document-assembly/field-mapping-statements";
import { legalFormatsFor } from "@magna-carta/document-assembly/format";
import {
  contentControlLabel,
  type ConfirmedMergeFieldMapping,
} from "@magna-carta/document-assembly/normalize";
import {
  prepareFormTemplateVersion,
  type FormFieldReport,
} from "@magna-carta/document-assembly/pdf-form";
import { prepareTemplateVersion } from "@magna-carta/document-assembly/register";
import {
  composeTemplateArchive,
  composeTemplateRegistration,
  composeTemplateVersionRegistration,
  TEMPLATE_STAGING_PREFIX,
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
import {
  TEMPLATE_KINDS,
  type FieldManifest,
  type LegacyFormField,
  type MergeFieldDetection,
  type NormalizationWarning,
  type TemplateKind,
  type UnboundContentControl,
  type UnboundFormField,
} from "@magna-carta/document-assembly/types";
import { readFirmScanPolicy } from "@magna-carta/file-manager/scan-policy-settings";
import { computeVerdict, ScanFaultError, scanDetailFor } from "@magna-carta/file-manager/verdict";
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
import type { Bindings } from "../../../bindings.ts";
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
import { paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { presignerForEnv } from "../../../files/presigner-wiring.ts";
import { readAcroFormFields, scrubFormTemplate } from "../../../assemblies/pdf-form-engine.ts";

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

// What each kind of template is uploaded as. The presigned URL's signature covers the content type, so
// this is also what an upload is refused for sending anything else — and it is the reason the kind is
// chosen when the slot is minted rather than when the document is registered.
const TEMPLATE_CONTENT_TYPES: Readonly<Record<TemplateKind, string>> = {
  wordProcessing: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdfForm: "application/pdf",
};

const TemplateKindSchema = z.enum(TEMPLATE_KINDS as [TemplateKind, ...TemplateKind[]]).openapi({
  description:
    "What kind of document this template is. wordProcessing is a Word document with {{field}} " +
    "placeholders typed into it — the default, and what most templates are. pdfForm is a fillable " +
    "PDF your firm already has, such as a court form: its boxes are filled in by this system once you " +
    "confirm which merge field each one is filled from. Defaults to wordProcessing.",
});

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

// THE HUMAN CONFIRMATION, and the whole of a form template's binding. Nothing in this system decides
// what a box on a firm's form means: a merge field is filled into a box only because somebody said this
// box is that field, and this is where they say it. What is confirmed here is written to the firm's own
// mapping library in the same commit as the version it bound, so the next form that uses the same field
// name arrives already bound.
const fieldMappingsField = z
  .array(z.object({ fieldName: z.string().min(1), mergeKey: z.string().min(1) }))
  .max(2000)
  .optional()
  .openapi({
    description:
      "For a fillable-PDF template: which merge field each box on the form is filled from, by the " +
      "form's own field name. Nothing is guessed — a box you do not name here is left empty in every " +
      "document assembled from the template, and the response lists every one of them along with the " +
      "boxes whose names happen to match a merge field exactly, which you can confirm rather than " +
      "choose. Each entry is remembered for this firm, so a second form using the same field names " +
      "arrives already filled in. Ignored for a Word template, whose binding is the {{field}} an " +
      "author typed.",
  });

const RegisterTemplateRequest = z
  .object({
    uploadKey: z.string().min(1),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    matterTypeId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    kind: TemplateKindSchema.optional(),
    convertMergeFields: convertMergeFieldsField,
    stripMacros: stripMacrosField,
    fieldMappings: fieldMappingsField,
  })
  .openapi("RegisterTemplateRequest");

const RegisterTemplateVersionRequest = z
  .object({
    uploadKey: z.string().min(1),
    kind: TemplateKindSchema.optional(),
    convertMergeFields: convertMergeFieldsField,
    stripMacros: stripMacrosField,
    fieldMappings: fieldMappingsField,
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

// One LEGACY WORD FORM FIELD the version carries. Its own schema rather than a widened
// TemplateUnconvertedMergeField, because the two ask the reader for different decisions: an unconverted
// merge field can be bound by registering again with conversion asked for, and this cannot be bound at
// all. `fieldName` is Word's own bookmark for the field — an identifier for finding it in the document,
// never a merge key.
const LegacyFormFieldSchema = z
  .object({
    fieldName: z.string(),
    kind: z.string(),
    part: z.string(),
    occurrences: z.number(),
    helpText: z.string(),
    frozenText: z.string(),
  })
  .openapi("TemplateLegacyFormField");

// One CONTENT CONTROL the version carries that nothing will fill in — a `w:sdt` showing its unfilled
// placeholder, or one bound to data stored in the template's own package. Its own schema again, and for
// a reason beyond tidiness: `alias` and `tag` are names an AUTHOR gave the control, where a legacy form
// field's name is one Word minted, so a reader deciding what to do about it is looking at different
// evidence. Neither is a merge key — no human has confirmed what either means — and both are here so a
// person can find the control in Word.
const UnboundContentControlSchema = z
  .object({
    alias: z.string(),
    tag: z.string(),
    kind: z.string(),
    part: z.string(),
    occurrences: z.number(),
    showingPlaceholder: z.boolean(),
    dataBound: z.boolean(),
    frozenText: z.string(),
  })
  .openapi("TemplateUnboundContentControl");

// One box on a fillable-PDF template, as the registration reports it back. The whole field set is
// returned — bound and unbound together — because that is what an administrator confirms mappings
// against, and because a field set reported only in part is how a form ends up with a box nobody knew
// was there.
const FormFieldSchema = z
  .object({
    fieldName: z.string(),
    // text, checkbox, radio, choice, pushButton, signature, or unclassified — the last meaning the form
    // does not say what the box is, so nothing is filled into it.
    kind: z.string(),
    // 1-based page the box sits on, or null when the form declares a field no page shows.
    page: z.number().nullable(),
    // Whether the FORM says the box must be answered. Reported, never enforced: what makes an unfilled
    // field stop an assembly is the merge field's own setting, which is the same for both kinds of
    // template.
    required: z.boolean(),
    // The set answers a drop-down or a radio group accepts. Empty for a text box or a tick box.
    options: z.array(z.string()),
    // The merge field this box is filled from, or empty when nothing fills it.
    mergeKey: z.string(),
    // Whether the binding came from this firm's remembered mappings rather than from this request.
    boundFromLibrary: z.boolean(),
    // A merge field this box could be filled from, offered ONLY when the box's own name is exactly a
    // merge field this firm has. Nothing is ever proposed because it looked similar, and nothing is
    // ever filled in from a proposal — confirm it and it becomes a binding.
    proposedMergeKey: z.string(),
    // Why nothing fills this box in: no-confirmed-mapping, not-fillable (a button or a signature box),
    // or unclassified. Null for a box that is bound.
    unboundReason: z.string().nullable(),
  })
  .openapi("TemplateFormField");

// One box on a REGISTERED form template that nothing fills in. The counterpart of the two Word lists
// above, and the same failure they describe: a document that reads as finished with a blank in it.
const UnboundFormFieldSchema = z
  .object({
    fieldName: z.string(),
    kind: z.string(),
    page: z.number().nullable(),
    required: z.boolean(),
    reason: z.string(),
    proposedMergeKey: z.string(),
    frozenText: z.string(),
  })
  .openapi("TemplateUnboundFormField");

const RegisteredTemplateResponse = z
  .object({
    templateId: z.string(),
    versionId: z.string(),
    versionNumber: z.number(),
    kind: TemplateKindSchema,
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
    // The legacy Word form fields the stored version carries. Nothing binds these and no opt-in
    // converts them, so a non-empty list means documents assembled from this template print the
    // template's own fill-in-the-blank prompts where a person is meant to type.
    legacyFormFields: z.array(LegacyFormFieldSchema),
    // The content controls the stored version carries that nothing will fill in. A non-empty list means
    // documents assembled from this template print a prompt, or text left over from the document the
    // template was made from, where a person is meant to type.
    unboundContentControls: z.array(UnboundContentControlSchema),
    // For a fillable-PDF template: every box on the form, bound and unbound, so the whole field set is
    // in front of whoever is confirming what each one means. Empty for a Word template.
    formFields: z.array(FormFieldSchema),
    // The boxes on the form that nothing fills in. A non-empty list means every document assembled
    // from this template leaves those boxes blank for someone to complete by hand.
    unboundFormFields: z.array(UnboundFormFieldSchema),
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
    // For a fillable-PDF template: which boxes on the form this merge field fills. Empty for a Word
    // template, whose binding is the {{field}} an author typed and needs nothing further recorded.
    formFields: z.array(
      z.object({
        fieldName: z.string(),
        kind: z.string(),
        page: z.number().nullable(),
        required: z.boolean(),
        options: z.array(z.string()),
      }),
    ),
  })
  .openapi("TemplateFieldEntry");

const TemplateFieldsResponse = z
  .object({
    templateId: z.string(),
    versionId: z.string(),
    versionNumber: z.number(),
    kind: TemplateKindSchema,
    normalizerVersion: z.number(),
    fields: z.array(TemplateFieldEntry),
    // The Word merge fields this version carries unconverted, with the text each one prints. The field
    // inspector's other half: these are blanks that do not look like blanks.
    unconvertedMergeFields: z.array(UnconvertedMergeFieldSchema),
    // The other half again: fields the engine will never bind, whatever anyone opts in to.
    legacyFormFields: z.array(LegacyFormFieldSchema),
    // And the regions Word writes today that nothing fills in either.
    unboundContentControls: z.array(UnboundContentControlSchema),
    // For a fillable-PDF template: the boxes on the form no merge field fills in.
    unboundFormFields: z.array(UnboundFormFieldSchema),
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
    "client uploads the file to directly (bytes never transit the Worker). Pass kind=pdfForm to " +
    "upload a fillable PDF instead of a Word document; the returned URL's signature covers the " +
    "content type, so the upload is refused if it sends the other one. After uploading, register " +
    "the template with POST /api/v1/templates, or add a version with " +
    "POST /api/v1/templates/{templateId}/versions.",
  request: { query: z.object({ kind: TemplateKindSchema.optional() }) },
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
    503: {
      description: "The scan engine is deployed but did not answer; nothing was registered",
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
    503: {
      description: "The scan engine is deployed but did not answer; nothing was registered",
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
    "type would offer, and pass search to keep only the templates whose name or description contains " +
    "the text.",
  request: {
    query: z.object({
      cursor: z.string().optional(),
      status: z.enum(["active", "archived"]).optional(),
      matterTypeId: z.string().optional(),
      search: z.string().max(200).optional(),
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
  {
    ...manageMeta("deleteFieldMapping", true, "optional"),
    reversal: {
      kind: "none",
      reason:
        "A mapping is a statement the firm made about its own documents, withdrawn outright rather than archived. It is made again the next time a template registration meets the field, which is a new statement rather than this one restored.",
    },
  },
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
    kind: prepared.kind,
    macrosStripped: prepared.macrosStripped,
    macroPartsRemoved: prepared.removedMacroParts.length,
    mergeFieldsConverted: prepared.mergeFieldsConverted,
    mergeFieldsDetected: prepared.mergeFieldDetections,
    unconvertedMergeFields: prepared.manifest.unconvertedMergeFields,
    legacyFormFields: prepared.manifest.legacyFormFields,
    unboundContentControls: prepared.manifest.unboundContentControls,
    formFields: prepared.formFields.map(toFormFieldBody),
    unboundFormFields: prepared.manifest.unboundFormFields.map(toUnboundFormFieldBody),
    confirmedFieldMappings: prepared.confirmedMergeFieldMappings,
    warnings: prepared.warnings,
  };
}

// A page index is 0-based everywhere inside the engine and 1-based everywhere a person reads one. The
// conversion happens once, here, on the way out.
function displayPage(page: number | null): number | null {
  return page === null ? null : page + 1;
}

function toFormFieldBody(field: FormFieldReport) {
  return {
    fieldName: field.fieldName,
    kind: field.kind,
    page: displayPage(field.page),
    required: field.required,
    options: [...field.options],
    mergeKey: field.mergeKey,
    boundFromLibrary: field.boundFromLibrary,
    proposedMergeKey: field.proposedMergeKey,
    unboundReason: field.unboundReason,
  };
}

function toUnboundFormFieldBody(field: UnboundFormField) {
  return {
    fieldName: field.fieldName,
    kind: field.kind,
    page: displayPage(field.page),
    required: field.required,
    reason: field.reason,
    proposedMergeKey: field.proposedMergeKey,
    frozenText: field.frozenText,
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
  readonly kind: TemplateKind;
  readonly bytes: Uint8Array;
  readonly manifest: FieldManifest;
  readonly warnings: readonly NormalizationWarning[];
  readonly normalizerVersion: number;
  readonly removedMacroParts: readonly string[];
  readonly macrosStripped: boolean;
  readonly mergeFieldDetections: readonly MergeFieldDetection[];
  readonly mergeFieldsConverted: boolean;
  readonly legacyFormFields: readonly LegacyFormField[];
  readonly unboundContentControls: readonly UnboundContentControl[];
  readonly confirmedMergeFieldMappings: readonly ConfirmedMergeFieldMapping[];
  // Every box on a fillable-PDF template, bound and unbound. Empty for a Word template.
  readonly formFields: readonly FormFieldReport[];
  readonly contentSha256: string;
}

type PreparationOutcome =
  | { readonly ok: true; readonly prepared: PreparedUpload }
  | { readonly ok: false; readonly response: ProblemResponse<422> };

export interface RegistrationConsent {
  readonly kind: TemplateKind;
  readonly convertMergeFields: boolean;
  readonly stripMacros: boolean;
  // What the human confirmed each box on a fillable PDF means. Empty for a Word template, and empty for
  // a form template whose administrator confirmed nothing — which registers, and says in the response
  // that every box is blank.
  readonly fieldMappings: readonly ConfirmedMergeFieldMapping[];
}

// The three request fields that authorize what happens to the firm's own document, read once so a first
// version and a new version of an existing template can never read them differently.
function consentOf(request: {
  readonly kind?: TemplateKind;
  readonly convertMergeFields?: boolean;
  readonly stripMacros?: boolean;
  readonly fieldMappings?: readonly { readonly fieldName: string; readonly mergeKey: string }[];
}): RegistrationConsent {
  return {
    kind: request.kind ?? "wordProcessing",
    convertMergeFields: request.convertMergeFields === true,
    stripMacros: request.stripMacros === true,
    fieldMappings: (request.fieldMappings ?? []).map((mapping) => ({
      fieldName: mapping.fieldName,
      mergeKey: mapping.mergeKey,
    })),
  };
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

  // The firm's own field catalogue, read ONCE and folded into the dictionary every binding is checked
  // against — for both kinds of template, because a placeholder naming a field the firm does not have
  // and a confirmed mapping naming one are the same mistake in two constructs.
  const firmDictionary = dictionaryForFirm(
    customFieldDictionaryEntries(await readCustomFieldCatalog(firm.firmDatabase)),
  );

  if (consent.kind === "pdfForm") {
    return prepareStagedFormUpload(c, uploadedBytes, consent, firmDictionary);
  }

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

  const dictionary = firmDictionary;

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
          // The two constructs NOTHING binds ride the refusal as well, so a template rejected for an
          // authoring mistake somewhere else still tells the firm where its other holes are — rather
          // than saving that up for the attempt that finally passes, by which point the author has
          // stopped looking for surprises.
          ...preparation.legacyFormFields.map((field) => ({
            path: field.part,
            code: "legacy-form-field",
            detail: `${field.fieldName === "" ? `an unnamed Word ${field.kind} form field` : `"${field.fieldName}"`} appears ${field.occurrences} time${field.occurrences === 1 ? "" : "s"} and nothing fills it in${field.frozenText === "" ? "" : `, so the document prints "${field.frozenText}"`}.`,
          })),
          ...preparation.unboundContentControls.map((control) => ({
            path: control.part,
            code: "unbound-content-control",
            detail: `${contentControlLabel(control)} appears ${control.occurrences} time${control.occurrences === 1 ? "" : "s"} and nothing fills it in${control.frozenText === "" ? "" : `, so the document prints "${control.frozenText}"`}.`,
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
      formFields: [],
      contentSha256: await sha256Hex(preparation.preparation.bytes),
    },
  };
}

// The fillable-PDF arm. Everything expensive still runs ONCE, at registration, with a human looking at
// the result — reading the AcroForm field set, scrubbing the document, and deciding which box is bound
// to what — and nothing on the assembly path repeats any of it.
//
// The one structural difference from the word-processing arm is worth stating: a Word template's
// bindings arrive INSIDE the document, so registration reads them out of it. A form template's bindings
// arrive in the REQUEST, because the document carries only the form's own field names, and those are the
// firm's text. Nothing here turns a name into a merge field on its own.
async function prepareStagedFormUpload(
  c: TemplatesContext,
  uploadedBytes: Uint8Array,
  consent: RegistrationConsent,
  dictionary: ReturnType<typeof dictionaryForFirm>,
): Promise<PreparationOutcome> {
  const firm = requireChokepointFirmContext(c);
  const logger = createWorkersLogger(c.env.TELEMETRY);

  // The firm's remembered mappings, read WHOLE once and handed in — a court form with two hundred boxes
  // must not cost two hundred lookups, the same batching rule the merge context follows.
  const libraryMappings = await readFieldMappingLibrary(firm.firmDatabase);

  const preparation = await prepareFormTemplateVersion(
    uploadedBytes,
    readAcroFormFields,
    scrubFormTemplate,
    { dictionary, libraryMappings, confirmMappings: consent.fieldMappings },
  );

  if (!preparation.ok) {
    logger.count(documentTemplateNormalization.metricName, {
      outcome: "refused",
      placeholderForm: "acroForm",
    });
    return {
      ok: false,
      response: problemJson(c, {
        type:
          preparation.reason === "binding-names-unknown-field"
            ? "template-normalization-failed"
            : "template-not-activatable",
        title:
          preparation.reason === "binding-names-unknown-field"
            ? "A box on the form is filled from a field this firm does not have"
            : "The document cannot be registered as a form template",
        status: 422,
        detail: preparation.detail,
        // The whole field set rides the refusal: a registration turned away over one wrong binding still
        // shows every box on the form, so the correction is one edit rather than another upload.
        errors: preparation.formFields.map((field) => ({
          path: field.page === null ? "the form" : `page ${field.page + 1}`,
          code: field.unboundReason ?? "form-field",
          detail:
            field.mergeKey === ""
              ? `"${field.fieldName}" is a ${field.kind} box that nothing fills in${field.proposedMergeKey === "" ? "" : `; it is named exactly like the merge field ${field.proposedMergeKey}`}.`
              : `"${field.fieldName}" is filled from ${field.mergeKey}.`,
        })),
      }),
    };
  }

  logger.count(documentTemplateNormalization.metricName, {
    outcome: "accepted",
    placeholderForm: "acroForm",
  });

  return {
    ok: true,
    prepared: {
      kind: "pdfForm",
      bytes: preparation.preparation.bytes,
      manifest: preparation.preparation.manifest,
      warnings: preparation.preparation.warnings,
      // A form template has no normalization pass at all, so there is no transform version to record.
      // Zero is what the column already holds for every version registered before normalization was
      // versioned, and it says the same thing here: nothing rewrote this document's placeholders.
      normalizerVersion: 0,
      removedMacroParts: [],
      macrosStripped: false,
      mergeFieldDetections: [],
      mergeFieldsConverted: false,
      legacyFormFields: [],
      unboundContentControls: [],
      confirmedMergeFieldMappings: preparation.preparation.confirmedMergeFieldMappings,
      formFields: preparation.preparation.formFields,
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
  kind: TemplateKind,
  bytes: Uint8Array,
  now: string,
): Promise<{ statements: unknown[]; activated: boolean }> {
  const firm = requireChokepointFirmContext(c);
  const database = firm.firmDatabase;
  const { resolveScanPort } = await import("../../../files/scan-port-binding.ts");
  const raw = await resolveScanPort(c.env).scan(new Response(bytes as unknown as BodyInit).body!, {
    sizeBytes: bytes.byteLength,
    // The kind the preparation arm validated these bytes as — not the `?kind=` the presign used,
    // which nothing forces the registration body to match. Each arm rejects bytes of the wrong
    // format, so this is the type the engine is actually being handed. A single literal stood here
    // and named a Word document for every template, including a fillable PDF.
    //
    // Nothing downstream reads it today, so this changed no behaviour: the container passes the type
    // only to its heuristics, which ignore the parameter and dispatch on magic bytes, and the
    // prefilter that would consult it is built but deliberately unwired (containers/scan/src/lib.rs).
    // It is corrected because the value is a claim about the bytes and it was false, and because the
    // prefilter is meant to be wired — a truthful type is what makes that a no-op rather than a
    // misclassification arriving with it.
    sniffedContentType: TEMPLATE_CONTENT_TYPES[kind],
  });
  // A deployed engine that will not answer raises ScanFaultError — from the adapter on a 5xx, and
  // from computeVerdict on an `unavailable` report — and it is deliberately NOT caught here. This
  // runs inside the idempotent effect, whose callback owes a write and a response code rather than a
  // Response, so the refusal is built one level out in the handler: see refuseOnScanFault, which
  // answers it with the same retryable 503 scan-diagnose gives for the identical fault. Throwing is
  // what carries it there, and it is also the safe direction — no row commits, no version activates.
  const verdict = computeVerdict(raw, await readFirmScanPolicy(database));

  if (verdict.verdict === "flagged") {
    return {
      statements: [
        guarded(
          markTemplateVersionQuarantinedStatement(
            database,
            versionId,
            verdict.reason,
            raw.engineVersion,
          ),
          "template-version.verdict",
        ),
      ],
      activated: false,
    };
  }
  return {
    statements: [
      guarded(
        markTemplateVersionCleanStatement(
          database,
          versionId,
          verdict.verdict,
          raw.engineVersion,
          // The same badge a file version carries, from the same function, so the two paths cannot
          // disagree again about what a clean verdict over executable bytes is worth recording.
          scanDetailFor(verdict),
          now,
        ),
        "template-version.verdict",
      ),
      guarded(
        setCurrentTemplateVersionStatement(database, templateId, versionId, now),
        "document-template.current-version",
      ),
    ],
    activated: true,
  };
}

// A deployed engine that will not answer raises ScanFaultError out of `scanAndGateStatements`, which
// runs INSIDE the idempotent effect — and that callback owes a write plus a response code, never a
// Response. So the refusal is built one level out, here, where a Response is what a handler returns.
//
// The answer is the one routes/files/scan-diagnose.ts already gives for the identical fault: a member
// registering a template while the scan Container is down can only wait, and an Error ID would send
// them to support over something nobody can act on.
//
// NO ROW COMMITS — the effect throws before its write — but bytes are a different question. The
// prepared template is written to R2 above, inside the effect and ahead of the scan, and each
// execution mints a fresh versionId and key, so every refused attempt leaves another full copy under
// `templates/` that no row points at. Those copies are collected a day later by
// `assemblies/template-orphan-sweep.ts` on the daily cron, which is where the ordering argument for
// writing bytes first and the argument for a generous grace period both live.
//
// The staged upload is deliberately NOT deleted here, so a retry does not mean re-uploading the
// file. Nothing reaps it if the caller never comes back — the orphan sweep skips the staging prefix
// precisely because a staged object is not garbage, and the bucket carries no lifecycle rule for it
// yet (docs/deploy-queue.md carries the step).
function refuseOnScanFault(c: TemplatesContext, error: unknown): ProblemResponse<503> {
  if (!(error instanceof ScanFaultError)) throw error;
  return problemJson(c, {
    type: "service-unavailable",
    title: "The scan engine is unreachable",
    status: 503,
    detail:
      "The malware-scan engine did not answer, so this template has not been scanned and nothing was" +
      " registered. The upload is still staged; try again shortly.",
  });
}

export function registerTemplatesRoutes(app: TemplatesApp, chokepoint: Chokepoint): void {
  // POST /api/v1/templates/upload — mint a staging slot and a presigned PUT URL.
  app.openapi(
    { ...uploadRoute, middleware: chokepointMiddleware(chokepoint, uploadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const { bucketName } = resolveFirmBucket(c.env, firm.bucketName);
      const kind: TemplateKind = c.req.valid("query").kind ?? "wordProcessing";
      // The staging key is server-minted from the SESSION firm id, never from client input.
      const uploadKey = `${TEMPLATE_STAGING_PREFIX}${firmId}/${newIdentifier("documentTemplateVersion")}`;
      // A template belongs to the firm, not to a matter — it is the thing matters are filled from.
      const presigned = await presignerForEnv(c.env).presignPut(
        bucketName,
        uploadKey,
        TEMPLATE_CONTENT_TYPES[kind],
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

      const outcome = await prepareStagedUpload(c, request.uploadKey, consentOf(request));
      if (!outcome.ok) return outcome.response;

      const now = (): string => new Date().toISOString();
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);

      let result: IdempotentEffectResult;
      try {
        result = await runIdempotentEffect({
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
            // The bytes are written before the rows commit, because the failure directions are not
            // symmetric: a committed row pointing at bytes that were never written is a template that
            // fails at 4:55pm on a filing deadline, and a written object with no row is only wasted
            // storage. The ordering stays as it is, and the wasted storage is collected out of band
            // by `assemblies/template-orphan-sweep.ts` — a day later, so that this window, in which
            // the object is real and its row is not, can never look like garbage to it.
            await bucket.put(registration.r2Key, outcome.prepared.bytes as unknown as ArrayBuffer, {
              customMetadata: firmScopedObjectDimensions("document-template"),
            });
            const gate = await scanAndGateStatements(
              c,
              registration.versionId,
              registration.templateId,
              outcome.prepared.kind,
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
      } catch (error) {
        return refuseOnScanFault(c, error);
      }

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

      const outcome = await prepareStagedUpload(c, request.uploadKey, consentOf(request));
      if (!outcome.ok) return outcome.response;

      const now = (): string => new Date().toISOString();
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);

      let result: IdempotentEffectResult;
      try {
        result = await runIdempotentEffect({
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
              outcome.prepared.kind,
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
      } catch (error) {
        return refuseOnScanFault(c, error);
      }

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
        search: query.search,
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
          kind: version.kind,
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
              // Present only on a form template: which boxes this merge field fills, so the field
              // inspector can point at a page rather than only naming a key.
              formFields: (field.formFields ?? []).map((site) => ({
                fieldName: site.fieldName,
                kind: site.kind,
                page: displayPage(site.page),
                required: site.required,
                options: [...site.options],
              })),
            };
          }),
          unconvertedMergeFields: manifest.unconvertedMergeFields.map((field) => ({ ...field })),
          legacyFormFields: manifest.legacyFormFields.map((field) => ({ ...field })),
          unboundContentControls: manifest.unboundContentControls.map((control) => ({
            ...control,
          })),
          unboundFormFields: manifest.unboundFormFields.map(toUnboundFormFieldBody),
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
      // Absent on a manifest stored before legacy form fields were detected at all. Those templates
      // registered saying nothing about the construct, which is the defect the field exists to end;
      // re-registering such a template is what gets it reported, since a version is immutable.
      legacyFormFields: Array.isArray(parsed.legacyFormFields) ? parsed.legacyFormFields : [],
      // Likewise absent on a manifest stored before content controls were looked at, which is every
      // version registered before that pass existed rather than a version that carried none.
      unboundContentControls: Array.isArray(parsed.unboundContentControls)
        ? parsed.unboundContentControls
        : [],
      // Empty on every word-processing manifest, and absent altogether on one stored before form
      // templates existed — which is a word-processing template by construction.
      unboundFormFields: Array.isArray(parsed.unboundFormFields) ? parsed.unboundFormFields : [],
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
      legacyFormFields: [],
      unboundContentControls: [],
      unboundFormFields: [],
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
