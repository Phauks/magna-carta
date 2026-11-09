import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  archiveCustomField,
  defineCustomField,
  hardDeleteCustomField,
  renameCustomField,
  reorderCustomField,
  setCustomFieldRequired,
  unarchiveCustomField,
} from "@magna-carta/custom-fields/custom-field-service";
import {
  archivePicklistOption,
  createPicklistOption,
  hardDeletePicklistOption,
  renamePicklistOption,
  reorderPicklistOption,
} from "@magna-carta/custom-fields/picklist-option-service";
import {
  clearCustomFieldValue,
  setCustomFieldValue,
  type CustomFieldValueInput,
} from "@magna-carta/custom-fields/custom-field-value-service";
import { applyConvert, previewConvert } from "@magna-carta/custom-fields/convert";
import { effectiveNumberScale } from "@magna-carta/custom-fields/number-scale";
import { purgeCustomField } from "@magna-carta/custom-fields/purge";
import {
  readCurrentValues,
  readValueHistory,
  resolveCustomField,
} from "@magna-carta/custom-fields/reads";
import {
  CustomFieldError,
  CUSTOM_FIELD_KINDS,
  CUSTOM_FIELD_TARGETS,
  type CustomFieldKind,
} from "@magna-carta/custom-fields/types";
import { CustomFieldIdempotencyConflictError } from "@magna-carta/custom-fields/run-custom-field-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The custom-fields HTTP surface over the @magna-carta/custom-fields domain package: firm-defined
// typed fields on matter, entity (directory contact), and matter-asset records, their picklist
// options, the temporal field values, the
// non-destructive Convert (preview + apply), and the compliance purge seam. The custom-fields domain
// services own validation, the field/option/firm caps, and idempotency (each mutation rides
// runCustomFieldEffect internally); these handlers hand the service the firm-scoped per-firm database,
// the real clock, a crypto random source, and the authenticated actor — none of which is ever client
// input — and map domain refusals to RFC 9457 problems by code. Every mutation requires
// customFields:manage and an Idempotency-Key; the reads are open to any authenticated firm member.

// ---- shared helpers ----

// The write options every custom-field mutation reads: the real clock, the authenticated actor, the
// production Web Crypto random source, and the chokepoint's idempotency context (its firm-scoped
// derived key + request fingerprint) so a retried mutation deduplicates instead of duplicating.
function writeOptions(
  actorUserId: AppVariables["chokepointUserId"],
  idempotency: ReturnType<typeof requireChokepointIdempotency>,
) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId,
    randomSource: cryptoRandomSource,
    idempotency,
  };
}

// Maps a custom-field domain refusal to its problem response. Codes — never messages — drive the
// mapping; an unrecognized throw propagates to the standard error pipeline (a 500).
// CustomFieldIdempotencyConflictError is checked first: it surfaces an in-progress commit race (→ 409)
// or a key reused with a different payload (→ 422) through the shared idempotency-conflict mapping.
// unknown-field is a 404; a field/option still referenced by values is a 409; purge is a
// not-yet-enabled 409; every remaining refusal (a bad reference handle, a cap breach, a parked-value
// block, a protect refusal) is a 422 invalid request.
function customFieldErrorResponse(
  c: Context,
  error: CustomFieldIdempotencyConflictError | CustomFieldError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error instanceof CustomFieldIdempotencyConflictError) {
    return problemResponseForIdempotencyConflict(c, error);
  }
  switch (error.code) {
    case "unknown-field":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: error.message,
      });
    case "field-in-use":
    case "option-in-use":
      return problemJson(c, {
        type: "conflict",
        title: "In use",
        status: 409,
        detail: error.message,
      });
    case "purge-not-yet-enabled":
      return problemJson(c, {
        type: "conflict",
        title: "Not yet enabled",
        status: 409,
        detail: error.message,
      });
    default:
      // reference-kind-handle-mismatch, reference-kind-not-convertible, value-kind-mismatch,
      // value-not-a-scaled-integer, value-text-too-long, unknown-picklist-option,
      // picklist-option-archived, field-archived, number-scale-out-of-range,
      // too-many-fields-for-scope/-firm, too-many-options-for-field, convert-has-parked-values,
      // convert-too-many-values, cannot-protect-reference-or-picklist-kind,
      // kind-immutable-during-convert — a malformed/refused request.
      return problemJson(c, {
        type: "validation",
        title: "Invalid custom-field request",
        status: 422,
        detail: error.message,
      });
  }
}

// Reads a field's kind and number_scale to scale a currency/number value input into the integer
// value_number stores. A currency field with no explicit number_scale falls back to the money
// minor-unit scale (cents). Returns null when the field does not exist (the service then raises the
// unknown-field refusal on its own read).
async function fieldNumberScale(
  database: SqlDatabase,
  fieldId: string,
): Promise<{ kind: CustomFieldKind; numberScale: number | null } | null> {
  const { results } = await database
    .prepare("SELECT kind, number_scale AS numberScale FROM custom_field WHERE id = ?1")
    .bind(fieldId)
    .all<{ kind: CustomFieldKind; numberScale: number | null }>();
  return results[0] ?? null;
}

// Turns the validated value-write body into the domain CustomFieldValueInput, scaling a number/currency
// decimal by 10^number_scale into the integer value_number stores — the one place that scaling happens
// (the domain package validates the integer it receives and never re-scales it). Every other kind, and
// a field the read did not find, passes through untouched for the value service to refuse.
async function valueInputForWrite(
  database: SqlDatabase,
  fieldId: string,
  value: z.infer<typeof CustomFieldValueBody>,
): Promise<CustomFieldValueInput> {
  if (value.kind !== "number") {
    return value;
  }
  const field = await fieldNumberScale(database, fieldId);
  if (field === null || (field.kind !== "currency" && field.kind !== "number")) {
    return value;
  }
  const scale = effectiveNumberScale(field.kind, field.numberScale);
  return { kind: "number", number: Math.round(value.number * 10 ** scale) };
}

// ---- request/response contracts ----

const customFieldKind = z.enum(CUSTOM_FIELD_KINDS);

const DefineFieldRequest = z
  .object({
    name: z.string().min(1),
    kind: customFieldKind,
    // Derived from the domain vocabulary, never restated: a target this schema accepted and no read
    // recognised would be a field a firm can define and never use.
    target: z.enum(CUSTOM_FIELD_TARGETS),
    attachmentId: z.string().nullable(),
    numberScale: z.number().int().nullable().optional(),
    required: z.boolean().optional(),
  })
  .openapi("DefineCustomFieldRequest");

const FieldAck = z.object({ id: z.string() }).openapi("CustomFieldAck");
const OptionAck = z.object({ id: z.string() }).openapi("PicklistOptionAck");
const OkAck = z.object({ ok: z.boolean() }).openapi("CustomFieldOkAck");

const RenameFieldRequest = z
  .object({ name: z.string().min(1) })
  .openapi("RenameCustomFieldRequest");
const SetRequiredRequest = z
  .object({ required: z.boolean() })
  .openapi("SetCustomFieldRequiredRequest");
const ReorderRequest = z
  .object({ position: z.number().int() })
  .openapi("ReorderCustomFieldRequest");

const ConvertPreviewRequest = z
  .object({ toKind: customFieldKind })
  .openapi("ConvertCustomFieldPreviewRequest");
const ConvertPreviewResponse = z
  .object({
    clean: z.number().int(),
    needsRule: z.number().int(),
    parked: z.array(z.object({ targetRowId: z.string() })),
  })
  .openapi("ConvertCustomFieldPreviewResponse");
const ConvertApplyRequest = z
  .object({ toKind: customFieldKind, parkedDisposition: z.enum(["park", "block"]) })
  .openapi("ConvertCustomFieldApplyRequest");

const PurgeRequest = z.object({ reason: z.string().min(1) }).openapi("PurgeCustomFieldRequest");

const CreateOptionRequest = z
  .object({ name: z.string().min(1) })
  .openapi("CreatePicklistOptionRequest");
const RenameOptionRequest = z
  .object({ name: z.string().min(1) })
  .openapi("RenamePicklistOptionRequest");
const ReorderOptionRequest = z
  .object({ position: z.number().int() })
  .openapi("ReorderPicklistOptionRequest");

// The discriminated value input the value-write accepts. A number/currency input is a plain decimal
// here; the handler scales it by the field's number_scale into the integer value_number stores.
const CustomFieldValueBody = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string() }),
    z.object({ kind: z.literal("number"), number: z.number() }),
    z.object({ kind: z.literal("date"), date: z.string() }),
    z.object({ kind: z.literal("picklist"), optionId: z.string() }),
    z.object({
      kind: z.literal("reference"),
      referenceId: z.string(),
      referenceKind: z.enum(["matter-reference", "contact-reference"]),
    }),
  ])
  .openapi("CustomFieldValueInput");

const SetValueRequest = z
  .object({
    fieldId: identifierField("customField"),
    targetRowId: z.string().min(1),
    value: CustomFieldValueBody,
  })
  .openapi("SetCustomFieldValueRequest");
const ValueAck = z.object({ id: z.string() }).openapi("CustomFieldValueAck");
const ClearValueRequest = z
  .object({ fieldId: identifierField("customField"), targetRowId: z.string().min(1) })
  .openapi("ClearCustomFieldValueRequest");

const ResolvedFieldResponse = z
  .object({
    status: z.enum(["active", "archived", "absent"]),
    field: z
      .object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        target: z.string(),
        attachmentId: z.string().nullable(),
        archived: z.number().int(),
      })
      .nullable(),
  })
  .openapi("ResolvedCustomFieldResponse");

const ValueRow = z
  .object({
    id: z.string(),
    fieldId: z.string(),
    valueText: z.string().nullable(),
    valueNumber: z.number().nullable(),
    valueDate: z.string().nullable(),
    valueOptionId: z.string().nullable(),
    valueReferenceId: z.string().nullable(),
    validFrom: z.string(),
    validTo: z.string().nullable(),
  })
  .openapi("CustomFieldValueRow");
const ValueListResponse = z
  .object({ data: z.array(ValueRow) })
  .openapi("CustomFieldValueListResponse");

// The history gets its own envelope rather than sharing the one above. A record's CURRENT values are
// one row per field configured for that target, so the firm's own field catalog bounds them; its
// HISTORY is append-only and bounded by nothing, so it pages.
const ValueHistoryResponse = paginated(ValueRow).openapi("CustomFieldValueHistoryResponse");

const fieldParam = z.object({ fieldId: identifierPathParam("customField", "fieldId") });
const optionParam = z.object({ optionId: identifierPathParam("picklistOption", "optionId") });
const fieldRecordParam = z.object({
  fieldId: identifierPathParam("customField", "fieldId"),
  targetRowId: z
    .string()
    .min(1)
    .openapi({ param: { name: "targetRowId", in: "path" } }),
});
const recordParam = z.object({
  targetRowId: z
    .string()
    .min(1)
    .openapi({ param: { name: "targetRowId", in: "path" } }),
});

// ---- shared error responses ----

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the field is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is still in progress, or the field/option is in use",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// The full write-error response map every mutation declares. Plain object (not `as const`): a
// const-asserted spread would deep-freeze the content-schema literal in a way that breaks
// zod-openapi's match of the handler's typed problem responses to these status codes.
const writeErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
};

// The read-error response map: no idempotency key, no write conflict.
const readErrorResponses = {
  401: authErrors[401],
  404: authErrors[404],
  429: authErrors[429],
};

// ---- route metas ----

const MANAGE = "customFields:manage" as const;

function mutationMeta(action: string): RouteMeta {
  return {
    operationId: `customFields.${action}`,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function readMeta(action: string): RouteMeta {
  return {
    operationId: `customFields.${action}`,
    surface: "app",
    authenticated: true,
    permission: null,
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

// A read-shaped POST (the convert preview — its target kind rides the body, no write, no audit):
// names customFields:manage because previewing a field's conversion is a management read, and the
// registration guard requires any authenticated POST to name a capability.
function readPostMeta(action: string): RouteMeta {
  return { ...readMeta(action), permission: MANAGE };
}

// ---- field routes ----

const defineFieldRoute = defineOpenAPIRoute(mutationMeta("defineField"), {
  method: "post",
  path: "/api/v1/custom-fields/fields",
  description:
    "Defines a custom field on a record axis: a matter, a directory contact, or a matter asset. " +
    "attachmentId narrows it within that axis — a matter type, a contact category, or an asset " +
    "class — and null applies the field to every record on the axis.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: DefineFieldRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The created field",
      content: { "application/json": { schema: FieldAck } },
    },
    ...writeErrorResponses,
  },
});

const renameFieldRoute = defineOpenAPIRoute(mutationMeta("renameField"), {
  method: "patch",
  path: "/api/v1/custom-fields/fields/{fieldId}/name",
  description: "Renames a custom field.",
  request: {
    headers: idempotencyKeyHeader,
    params: fieldParam,
    body: { content: { "application/json": { schema: RenameFieldRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The field was renamed",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

const setRequiredRoute = defineOpenAPIRoute(mutationMeta("setRequired"), {
  method: "patch",
  path: "/api/v1/custom-fields/fields/{fieldId}/required",
  description: "Sets whether a custom field is required.",
  request: {
    headers: idempotencyKeyHeader,
    params: fieldParam,
    body: { content: { "application/json": { schema: SetRequiredRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The field's required flag was set",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

const reorderFieldRoute = defineOpenAPIRoute(mutationMeta("reorderField"), {
  method: "patch",
  path: "/api/v1/custom-fields/fields/{fieldId}/position",
  description: "Sets a custom field's display position.",
  request: {
    headers: idempotencyKeyHeader,
    params: fieldParam,
    body: { content: { "application/json": { schema: ReorderRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The field was repositioned",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

const archiveFieldRoute = defineOpenAPIRoute(mutationMeta("archiveField"), {
  method: "post",
  path: "/api/v1/custom-fields/fields/{fieldId}/archive",
  description: "Archives a custom field (it stops appearing on forms; its values endure).",
  request: { headers: idempotencyKeyHeader, params: fieldParam },
  responses: {
    200: {
      description: "The field was archived",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

const unarchiveFieldRoute = defineOpenAPIRoute(mutationMeta("unarchiveField"), {
  method: "post",
  path: "/api/v1/custom-fields/fields/{fieldId}/unarchive",
  description: "Restores an archived custom field.",
  request: { headers: idempotencyKeyHeader, params: fieldParam },
  responses: {
    200: {
      description: "The field was restored",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

const hardDeleteFieldRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("hardDeleteField"),
    reversal: {
      kind: "none",
      reason:
        "A field is hard-deleted only when it holds no values, so there is nothing to restore. Defining the field again mints a new one; a field with values is archived instead.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/custom-fields/fields/{fieldId}",
    description:
      "Hard-deletes a custom field that holds no values (with its picklist options). Refuses a field " +
      "that has stored values — archive it instead.",
    request: { headers: idempotencyKeyHeader, params: fieldParam },
    responses: {
      200: {
        description: "The field was deleted",
        content: { "application/json": { schema: OkAck } },
      },
      ...writeErrorResponses,
    },
  },
);

const purgeFieldRoute = defineOpenAPIRoute(
  { ...mutationMeta("purgeField"), permission: "customFields:purge" },
  {
    method: "post",
    path: "/api/v1/custom-fields/fields/{fieldId}/purge",
    description:
      "Compliance erasure: irreversibly removes a custom field and all of its values, current and " +
      "historical. The executing pass is not yet enabled, so this refuses.",
    request: {
      headers: idempotencyKeyHeader,
      params: fieldParam,
      body: { content: { "application/json": { schema: PurgeRequest } }, required: true },
    },
    responses: {
      200: {
        description: "The field was purged",
        content: { "application/json": { schema: OkAck } },
      },
      ...writeErrorResponses,
    },
  },
);

const resolveFieldRoute = defineOpenAPIRoute(readMeta("resolveField"), {
  method: "get",
  path: "/api/v1/custom-fields/fields/{fieldId}",
  description: "Resolves a custom-field handle to its definition (active, archived, or absent).",
  request: { params: fieldParam },
  responses: {
    200: {
      description: "The resolved field",
      content: { "application/json": { schema: ResolvedFieldResponse } },
    },
    ...readErrorResponses,
  },
});

// ---- convert routes ----

const convertPreviewRoute = defineOpenAPIRoute(readPostMeta("previewConvert"), {
  method: "post",
  path: "/api/v1/custom-fields/fields/{fieldId}/convert/preview",
  description:
    "Previews a kind change without writing: counts how each current value would land (clean, " +
    "needs-rule, or parked). A read-shaped POST — the target kind rides the body.",
  request: {
    params: fieldParam,
    body: { content: { "application/json": { schema: ConvertPreviewRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The conversion preview counts",
      content: { "application/json": { schema: ConvertPreviewResponse } },
    },
    // The shared custom-field error mapping can surface a 404 (unknown field), a 422 (an invalid
    // target kind), or a 409 (in-use) — every status it can return is declared so the handler's
    // typed problem responses match a declared response.
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const convertApplyRoute = defineOpenAPIRoute(mutationMeta("applyConvert"), {
  method: "post",
  path: "/api/v1/custom-fields/fields/{fieldId}/convert",
  description:
    "Retypes a custom field non-destructively: each original value moves to history, clean values " +
    "gain a coerced current row, and parked values are left cleared (reversibly). With " +
    "parkedDisposition 'block' the whole change is refused when any value cannot be coerced.",
  request: {
    headers: idempotencyKeyHeader,
    params: fieldParam,
    body: { content: { "application/json": { schema: ConvertApplyRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The field was retyped",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

// ---- picklist-option routes ----

const createOptionRoute = defineOpenAPIRoute(mutationMeta("createOption"), {
  method: "post",
  path: "/api/v1/custom-fields/fields/{fieldId}/options",
  description: "Creates a picklist option on a custom field.",
  request: {
    headers: idempotencyKeyHeader,
    params: fieldParam,
    body: { content: { "application/json": { schema: CreateOptionRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The created option",
      content: { "application/json": { schema: OptionAck } },
    },
    ...writeErrorResponses,
  },
});

const renameOptionRoute = defineOpenAPIRoute(mutationMeta("renameOption"), {
  method: "patch",
  path: "/api/v1/custom-fields/options/{optionId}/name",
  description: "Renames a picklist option.",
  request: {
    headers: idempotencyKeyHeader,
    params: optionParam,
    body: { content: { "application/json": { schema: RenameOptionRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The option was renamed",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

const reorderOptionRoute = defineOpenAPIRoute(mutationMeta("reorderOption"), {
  method: "patch",
  path: "/api/v1/custom-fields/options/{optionId}/position",
  description: "Sets a picklist option's display position.",
  request: {
    headers: idempotencyKeyHeader,
    params: optionParam,
    body: { content: { "application/json": { schema: ReorderOptionRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The option was repositioned",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

const archiveOptionRoute = defineOpenAPIRoute(mutationMeta("archiveOption"), {
  method: "post",
  path: "/api/v1/custom-fields/options/{optionId}/archive",
  description: "Archives a picklist option (it stops appearing as a choice; stored values endure).",
  request: { headers: idempotencyKeyHeader, params: optionParam },
  responses: {
    200: {
      description: "The option was archived",
      content: { "application/json": { schema: OkAck } },
    },
    ...writeErrorResponses,
  },
});

const hardDeleteOptionRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("hardDeleteOption"),
    reversal: {
      kind: "none",
      reason:
        "An option is hard-deleted only when nothing references it, so there is nothing to restore. Creating it again mints a new one; a referenced option is archived instead.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/custom-fields/options/{optionId}",
    description:
      "Hard-deletes a picklist option that holds no stored values. Refuses one still referenced — " +
      "archive it instead.",
    request: { headers: idempotencyKeyHeader, params: optionParam },
    responses: {
      200: {
        description: "The option was deleted",
        content: { "application/json": { schema: OkAck } },
      },
      ...writeErrorResponses,
    },
  },
);

// ---- value routes ----

const setValueRoute = defineOpenAPIRoute(mutationMeta("setValue"), {
  method: "put",
  path: "/api/v1/custom-fields/values",
  description:
    "Sets or replaces a custom field's value on a record (the prior value, if any, moves to history). " +
    "A number/currency input is a plain decimal; it is scaled by the field's number_scale into the " +
    "integer the value column stores.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SetValueRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The value was set",
      content: { "application/json": { schema: ValueAck } },
    },
    ...writeErrorResponses,
  },
});

const clearValueRoute = defineOpenAPIRoute(
  { ...mutationMeta("clearValue"), reversal: { kind: "inverse", by: "customFields.setValue" } },
  {
    method: "delete",
    path: "/api/v1/custom-fields/values",
    description: "Clears a custom field's current value on a record (its history endures).",
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: ClearValueRequest } }, required: true },
    },
    responses: {
      200: {
        description: "The value was cleared",
        content: { "application/json": { schema: OkAck } },
      },
      ...writeErrorResponses,
    },
  },
);

const recordValuesRoute = defineOpenAPIRoute(readMeta("listRecordValues"), {
  method: "get",
  path: "/api/v1/custom-fields/records/{targetRowId}/values",
  description: "Returns a record's current custom-field values.",
  request: { params: recordParam },
  responses: {
    200: {
      description: "The record's current values",
      content: { "application/json": { schema: ValueListResponse } },
    },
    ...readErrorResponses,
  },
});

const valueHistoryRoute = defineOpenAPIRoute(readMeta("valueHistory"), {
  method: "get",
  path: "/api/v1/custom-fields/fields/{fieldId}/records/{targetRowId}/history",
  description:
    "Returns the value history of one custom field on one record, oldest first. CURSOR-PAGED: this " +
    "table is append-only, so a value the firm edits often has a history bounded by nothing, and " +
    "this read carried no bound at all.",
  request: { params: fieldRecordParam, query: cursorQuery },
  responses: {
    200: {
      description: "One page of the value history",
      content: { "application/json": { schema: ValueHistoryResponse } },
    },
    ...readErrorResponses,
  },
});

type CustomFieldsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerCustomFieldsRoutes(app: CustomFieldsApp, chokepoint: Chokepoint): void {
  // POST /api/v1/custom-fields/fields — define
  app.openapi(
    { ...defineFieldRoute, middleware: chokepointMiddleware(chokepoint, defineFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const body = c.req.valid("json");
      try {
        const result = await defineCustomField(
          firm.firmDatabase,
          {
            name: body.name,
            kind: body.kind,
            target: body.target,
            attachmentId: body.attachmentId,
            numberScale: body.numberScale ?? null,
            required: body.required,
          },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ id: result.customFieldId } as z.infer<typeof FieldAck>, 201);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // PATCH /api/v1/custom-fields/fields/{fieldId}/name — rename
  app.openapi(
    { ...renameFieldRoute, middleware: chokepointMiddleware(chokepoint, renameFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      const { name } = c.req.valid("json");
      try {
        const result = await renameCustomField(
          firm.firmDatabase,
          { fieldId, name },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // PATCH /api/v1/custom-fields/fields/{fieldId}/required — set required
  app.openapi(
    { ...setRequiredRoute, middleware: chokepointMiddleware(chokepoint, setRequiredRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      const { required } = c.req.valid("json");
      try {
        const result = await setCustomFieldRequired(
          firm.firmDatabase,
          { fieldId, required },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // PATCH /api/v1/custom-fields/fields/{fieldId}/position — reorder
  app.openapi(
    { ...reorderFieldRoute, middleware: chokepointMiddleware(chokepoint, reorderFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      const { position } = c.req.valid("json");
      try {
        const result = await reorderCustomField(
          firm.firmDatabase,
          { fieldId, position },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // POST /api/v1/custom-fields/fields/{fieldId}/archive
  app.openapi(
    { ...archiveFieldRoute, middleware: chokepointMiddleware(chokepoint, archiveFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      try {
        const result = await archiveCustomField(
          firm.firmDatabase,
          { fieldId },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // POST /api/v1/custom-fields/fields/{fieldId}/unarchive
  app.openapi(
    { ...unarchiveFieldRoute, middleware: chokepointMiddleware(chokepoint, unarchiveFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      try {
        const result = await unarchiveCustomField(
          firm.firmDatabase,
          { fieldId },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // DELETE /api/v1/custom-fields/fields/{fieldId} — hard delete (no values)
  app.openapi(
    { ...hardDeleteFieldRoute, middleware: chokepointMiddleware(chokepoint, hardDeleteFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      try {
        const result = await hardDeleteCustomField(
          firm.firmDatabase,
          { fieldId },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // POST /api/v1/custom-fields/fields/{fieldId}/purge — compliance erasure (refuses for now)
  app.openapi(
    { ...purgeFieldRoute, middleware: chokepointMiddleware(chokepoint, purgeFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      try {
        await purgeCustomField(
          firm.firmDatabase,
          { fieldId, reason },
          writeOptions(userId, idempotency),
        );
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/custom-fields/fields/{fieldId} — resolve handle to definition
  app.openapi(
    { ...resolveFieldRoute, middleware: chokepointMiddleware(chokepoint, resolveFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { fieldId } = c.req.valid("param");
      const resolved = await resolveCustomField(firm.firmDatabase, fieldId);
      return c.json(resolved as unknown as z.infer<typeof ResolvedFieldResponse>, 200);
    },
  );

  // POST /api/v1/custom-fields/fields/{fieldId}/convert/preview — read-shaped
  app.openapi(
    { ...convertPreviewRoute, middleware: chokepointMiddleware(chokepoint, convertPreviewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { fieldId } = c.req.valid("param");
      const { toKind } = c.req.valid("json");
      try {
        const preview = await previewConvert(firm.firmDatabase, { fieldId, toKind });
        return c.json(preview as z.infer<typeof ConvertPreviewResponse>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // POST /api/v1/custom-fields/fields/{fieldId}/convert — apply
  app.openapi(
    { ...convertApplyRoute, middleware: chokepointMiddleware(chokepoint, convertApplyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      const { toKind, parkedDisposition } = c.req.valid("json");
      try {
        const result = await applyConvert(
          firm.firmDatabase,
          { fieldId, toKind, parkedDisposition },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // POST /api/v1/custom-fields/fields/{fieldId}/options — create option
  app.openapi(
    { ...createOptionRoute, middleware: chokepointMiddleware(chokepoint, createOptionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { fieldId } = c.req.valid("param");
      const { name } = c.req.valid("json");
      try {
        const result = await createPicklistOption(
          firm.firmDatabase,
          { fieldId, name },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ id: result.optionId } as z.infer<typeof OptionAck>, 201);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // PATCH /api/v1/custom-fields/options/{optionId}/name — rename option
  app.openapi(
    { ...renameOptionRoute, middleware: chokepointMiddleware(chokepoint, renameOptionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { optionId } = c.req.valid("param");
      const { name } = c.req.valid("json");
      try {
        const result = await renamePicklistOption(
          firm.firmDatabase,
          { optionId, name },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // PATCH /api/v1/custom-fields/options/{optionId}/position — reorder option
  app.openapi(
    { ...reorderOptionRoute, middleware: chokepointMiddleware(chokepoint, reorderOptionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { optionId } = c.req.valid("param");
      const { position } = c.req.valid("json");
      try {
        const result = await reorderPicklistOption(
          firm.firmDatabase,
          { optionId, position },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // POST /api/v1/custom-fields/options/{optionId}/archive — archive option
  app.openapi(
    { ...archiveOptionRoute, middleware: chokepointMiddleware(chokepoint, archiveOptionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { optionId } = c.req.valid("param");
      try {
        const result = await archivePicklistOption(
          firm.firmDatabase,
          { optionId },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // DELETE /api/v1/custom-fields/options/{optionId} — hard delete option (no values)
  app.openapi(
    {
      ...hardDeleteOptionRoute,
      middleware: chokepointMiddleware(chokepoint, hardDeleteOptionRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { optionId } = c.req.valid("param");
      try {
        const result = await hardDeletePicklistOption(
          firm.firmDatabase,
          { optionId },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // PUT /api/v1/custom-fields/values — set/replace a value
  app.openapi(
    { ...setValueRoute, middleware: chokepointMiddleware(chokepoint, setValueRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const body = c.req.valid("json");
      try {
        const value = await valueInputForWrite(firm.firmDatabase, body.fieldId, body.value);
        const result = await setCustomFieldValue(
          firm.firmDatabase,
          { fieldId: body.fieldId, targetRowId: body.targetRowId, value },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ id: result.customFieldValueId } as z.infer<typeof ValueAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // DELETE /api/v1/custom-fields/values — clear a value
  app.openapi(
    { ...clearValueRoute, middleware: chokepointMiddleware(chokepoint, clearValueRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const body = c.req.valid("json");
      try {
        const result = await clearCustomFieldValue(
          firm.firmDatabase,
          { fieldId: body.fieldId, targetRowId: body.targetRowId },
          writeOptions(userId, idempotency),
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ ok: true } as z.infer<typeof OkAck>, 200);
      } catch (caught) {
        if (
          caught instanceof CustomFieldIdempotencyConflictError ||
          caught instanceof CustomFieldError
        )
          return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/custom-fields/records/{targetRowId}/values — a record's current values
  app.openapi(
    { ...recordValuesRoute, middleware: chokepointMiddleware(chokepoint, recordValuesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { targetRowId } = c.req.valid("param");
      const data = await readCurrentValues(firm.firmDatabase, targetRowId);
      return c.json({ data } as unknown as z.infer<typeof ValueListResponse>, 200);
    },
  );

  // GET /api/v1/custom-fields/fields/{fieldId}/records/{targetRowId}/history — one field's history
  app.openapi(
    { ...valueHistoryRoute, middleware: chokepointMiddleware(chokepoint, valueHistoryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { fieldId, targetRowId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readValueHistory(
        firm.firmDatabase,
        fieldId,
        targetRowId,
        cursor === undefined ? {} : { cursor },
      );
      return c.json(page as unknown as z.infer<typeof ValueHistoryResponse>, 200);
    },
  );
}
