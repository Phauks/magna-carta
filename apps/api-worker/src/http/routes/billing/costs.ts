import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import {
  captureCost,
  updateDraftCost,
  submitCost,
  approveCost,
  kickBackCost,
  voidCost,
  attachReceipt,
  detachReceipt,
} from "@magna-carta/costs/cost-entry-service";
import type { CostDraftPatch } from "@magna-carta/costs/cost-entry-statements";
import { CostValidationError } from "@magna-carta/costs/cost-validation";
import { approvalRequiredDefinition } from "@magna-carta/billing-core/review-gate";
import type { CostEntryId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  appendCursorPredicateOnColumn,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
} from "@magna-carta/data-access/cursor-pagination";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// Costs: the disbursement WIP store. A cost entry enters as draft (source='manual') and advances
// through the lifecycle defined in the costs service. create is the capture handler — source is
// always set server-side to 'manual'. update is draft-only: a billed or void row is frozen. The
// costs:approve permission gates approve + kick-back; submit and every other mutation (and all reads)
// require costs:track (submit only reaches the non-billing 'submitted' state). Integer-minor money throughout.

const TRACK = "costs:track" as const;
const APPROVE = "costs:approve" as const;

const CreateCostRequest = z
  .object({
    matterId: identifierField("matter"),
    vendorId: identifierField("directory").nullable().optional(),
    incurredDate: z.string().regex(CIVIL_DATE_PATTERN),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    disbursementClass: z.enum(["hard", "soft"]),
    billable: z.boolean(),
    utbmsExpenseCodeId: identifierField("utbmsCode").nullable().optional(),
    description: z.string(),
    recoveryCategory: z.string().optional(),
  })
  .openapi("CreateCostRequest");

const PatchCostRequest = z
  .object({
    vendorId: identifierField("directory").nullable().optional(),
    incurredDate: z.string().regex(CIVIL_DATE_PATTERN).optional(),
    amountMinor: z.number().int().positive().optional(),
    currency: z.literal("USD").optional(),
    disbursementClass: z.enum(["hard", "soft"]).optional(),
    billable: z.boolean().optional(),
    utbmsExpenseCodeId: identifierField("utbmsCode").nullable().optional(),
    description: z.string().optional(),
  })
  .openapi("PatchCostRequest");

const CostSummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    vendorId: z.string().nullable(),
    incurredDate: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    disbursementClass: z.enum(["hard", "soft"]),
    billable: z.boolean(),
    utbmsExpenseCodeId: z.string().nullable(),
    description: z.string(),
    status: z.enum(["draft", "submitted", "approved", "billed", "void"]),
    // The invoice that took this cost up, or null while nothing has. It is what lets a surface put
    // a billed cost one click from the bill that billed it: without it a reader who wants to see
    // what the client was actually charged has to go looking through the matter's whole register.
    // The CLAIM is the truth about who holds a cost; this mirror is set at finalization and is what
    // a read can carry without joining.
    invoiceId: z.string().nullable().optional(),
    // The vendor's name, resolved beside the cost. Null both when no vendor was recorded and when
    // the directory entry behind one is gone -- vendorId tells those two apart, and a screen that
    // needs to can say which. Never the identifier standing in for a name.
    vendorName: z.string().nullable().optional(),
    // The matter's own name and number, resolved beside the cost for the same reason the vendor's
    // is: a firm-wide period listing prints the matter on every row, and resolving it a row at a
    // time would be one lookup per disbursement to fill one column.
    matterNumber: z.string().nullable().optional(),
    matterTitle: z.string().nullable().optional(),
    source: z.enum(["manual", "grid", "recovery"]),
    recoveryCategory: z.string().nullable(),
    // When the cost was written down, as distinct from the day the money went out
    // (`incurredDate`). A disbursement captured three weeks after the fact is a different record
    // from one captured the day it was paid, and only these two dates together say so.
    createdAt: z.string(),
    // Who wrote it down. The identifier and the name are BOTH carried because they answer
    // different questions: the name is what a reader is shown, and a null name over a present
    // identifier means the member row is gone rather than that nobody recorded it. It is not a
    // permission fact — the costs design rules that a cost belongs to the matter and not to its
    // recorder, so no read or write is scoped by it.
    createdByUserId: z.string().nullable(),
    createdByName: z.string().nullable(),
    // Why a reviewer sent this cost back, or null. It is set only by the kick-back transition and
    // cleared by the next submission, so a non-null value means exactly one thing: this draft came
    // back and has not been sent again. Without it a returned draft is indistinguishable from one
    // that was never submitted, and the person who has to fix it is told nothing.
    kickBackReason: z.string().nullable(),
  })
  .openapi("CostSummary");

const CostListResponse = paginated(CostSummary).openapi("CostListResponse");

const CostAck = z.object({ costEntryId: z.string() }).openapi("CostAck");

const CostBatchAck = z.object({ costEntryIds: z.array(z.string()) }).openapi("CostBatchAck");

const CostBatchRequest = z
  .object({ rows: z.array(CreateCostRequest).min(1).max(200) })
  .openapi("CostBatchRequest");

const CostKickBackRequest = z.object({ reason: z.string().min(1) }).openapi("CostKickBackRequest");

const AttachReceiptRequest = z
  .object({ fileId: identifierField("file") })
  .openapi("AttachReceiptRequest");

const costParam = z.object({ id: identifierPathParam("costEntry", "id") });

const incurredDateField = z.string().regex(CIVIL_DATE_PATTERN);

const costStatusField = z.enum(["draft", "submitted", "approved", "billed", "void"]);

const listQuery = z.object({
  ...cursorQuery.shape,
  matterId: identifierField("matter").optional(),
  from: incurredDateField.optional().openapi({
    description:
      "The first incurred date the listing covers, inclusive. Either bound stands alone: a " +
      "listing with only `from` runs to the present, one with only `to` runs from the first cost " +
      "the firm ever recorded, and one with neither is the firm's whole record. This is the " +
      "screen's Date column filter, honoured here so it is true across every page rather than " +
      "over the page in hand.",
  }),
  to: incurredDateField.optional().openapi({
    description: "The last incurred date the listing covers, inclusive.",
  }),
  billable: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      description:
        "Narrows the listing to the costs that are billable, or to those that are not. " +
        "Omitted, it answers with both.",
    }),
  status: z
    .union([costStatusField, z.array(costStatusField)])
    .optional()
    .openapi({
      description:
        "Narrows the listing to one status, or to several given repeatedly " +
        "(`status=draft&status=submitted`): the screen's Status column filter, honoured here so " +
        "it holds across every page. Omitted, it answers with every status the record carries, " +
        "which is what a cost record is.",
    }),
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({
      description:
        "Matched against the description, the matter's title and number, and the payee's " +
        "name. The screen's search, honoured here so a word absent from the page in hand is " +
        "looked for across the whole record.",
    }),
});

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
    description: "The session member lacks the required capability",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the cost entry is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the entry is frozen (billed or void), or the lifecycle transition is illegal",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, a UTBMS expense code is required, or the amount is not a positive integer",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const writeErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
} as const;

const readErrorResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  422: authErrors[422],
  429: authErrors[429],
} as const;

function writeMeta(operationId: string, permission: typeof TRACK | typeof APPROVE): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const createMeta = writeMeta("costs.create", TRACK);
const updateMeta = writeMeta("costs.update", TRACK);
const batchMeta = writeMeta("costs.batch", TRACK);
const submitMeta = writeMeta("costs.submit", TRACK);
const approveMeta = writeMeta("costs.approve", APPROVE);
const kickBackMeta = writeMeta("costs.kickBack", APPROVE);
const voidMeta = writeMeta("costs.void", TRACK);
const attachReceiptMeta = writeMeta("costs.attachReceipt", TRACK);
const detachReceiptMeta = writeMeta("costs.detachReceipt", TRACK);

const listMeta: RouteMeta = {
  operationId: "costs.list",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getMeta: RouteMeta = {
  operationId: "costs.get",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/costs",
  description:
    "Captures a cost entry against a matter. The source is always set to 'manual'. The amount must be a positive integer in minor units.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateCostRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The cost entry was captured",
      content: { "application/json": { schema: CostAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/costs",
  description:
    "Lists cost entries, most recently incurred first, cursor-paged. Nothing named is the " +
    "firm's whole cost record; `matterId` narrows it to one matter, `from` and `to` bound the " +
    "incurred dates (each on its own or together), and `status`, `billable` and `search` narrow " +
    "further. Every narrowing is the server's, so the firm's Costs screen can send its column " +
    "filters here and have them hold across every page, and a cost reads back identically " +
    "whichever narrowing found it because every shape runs over one statement.",
  request: { query: listQuery },
  responses: {
    200: {
      description: "The cost entries",
      content: { "application/json": { schema: CostListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/costs/{id}",
  description: "Returns one cost entry's detail.",
  request: { params: costParam },
  responses: {
    200: {
      description: "The cost entry",
      content: { "application/json": { schema: CostSummary } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const updateRoute = defineOpenAPIRoute(updateMeta, {
  method: "patch",
  path: "/api/v1/costs/{id}",
  description:
    "Updates a draft cost entry. A billed or void entry is frozen and cannot be edited. A submitted or approved entry is not draft and returns 409.",
  request: {
    headers: idempotencyKeyHeader,
    params: costParam,
    body: { content: { "application/json": { schema: PatchCostRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The cost entry was updated",
      content: { "application/json": { schema: CostAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

const batchRoute = defineOpenAPIRoute(batchMeta, {
  method: "post",
  path: "/api/v1/costs/batch",
  description:
    "Captures a batch of cost entries from the grid in one request. All rows are written atomically — if any row is invalid the entire batch is refused.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CostBatchRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The batch was captured",
      content: { "application/json": { schema: CostBatchAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

function costTransitionRoute(
  meta: RouteMeta,
  action: string,
  description: string,
  withBody?: z.ZodTypeAny,
) {
  return defineOpenAPIRoute(meta, {
    method: "post",
    path: `/api/v1/costs/{id}/${action}`,
    description,
    request: {
      headers: idempotencyKeyHeader,
      params: costParam,
      ...(withBody
        ? { body: { content: { "application/json": { schema: withBody } }, required: true } }
        : {}),
    },
    responses: {
      200: {
        description: "The transition was applied",
        content: { "application/json": { schema: CostAck } },
      },
      400: writeErrorResponses[400],
      401: writeErrorResponses[401],
      403: writeErrorResponses[403],
      404: writeErrorResponses[404],
      409: writeErrorResponses[409],
      422: writeErrorResponses[422],
      429: writeErrorResponses[429],
    },
  });
}

const submitRoute = costTransitionRoute(
  submitMeta,
  "submit",
  "Submits a draft cost entry for review. Only legal when the firm's billing review gate is on.",
);
const approveRoute = costTransitionRoute(
  approveMeta,
  "approve",
  "Approves a submitted cost entry, making it eligible for billing.",
);
const kickBackRoute = defineOpenAPIRoute(kickBackMeta, {
  method: "post",
  path: "/api/v1/costs/{id}/kick-back",
  description: "Returns a submitted cost entry to draft with an audited reason.",
  request: {
    headers: idempotencyKeyHeader,
    params: costParam,
    body: { content: { "application/json": { schema: CostKickBackRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The transition was applied",
      content: { "application/json": { schema: CostAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});
const voidRoute = costTransitionRoute(
  voidMeta,
  "void",
  "Voids a cost entry. The row freezes — it can no longer be edited or billed.",
);

const attachReceiptRoute = defineOpenAPIRoute(attachReceiptMeta, {
  method: "post",
  path: "/api/v1/costs/{id}/receipt",
  description:
    "Attaches a receipt file to a cost entry. The file identifier is trusted as a matter-rooted document in the File Manager; a cross-existence check against the File Manager is a deferred follow-up.",
  request: {
    headers: idempotencyKeyHeader,
    params: costParam,
    body: { content: { "application/json": { schema: AttachReceiptRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The receipt was attached",
      content: { "application/json": { schema: CostAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

const detachReceiptRoute = defineOpenAPIRoute(
  { ...detachReceiptMeta, reversal: { kind: "inverse", by: "costs.attachReceipt" } },
  {
    method: "delete",
    path: "/api/v1/costs/{id}/receipt",
    description: "Removes the receipt file from a cost entry.",
    request: {
      headers: idempotencyKeyHeader,
      params: costParam,
    },
    responses: {
      200: {
        description: "The receipt was removed",
        content: { "application/json": { schema: CostAck } },
      },
      400: writeErrorResponses[400],
      401: writeErrorResponses[401],
      403: writeErrorResponses[403],
      404: writeErrorResponses[404],
      409: writeErrorResponses[409],
      422: writeErrorResponses[422],
      429: writeErrorResponses[429],
    },
  },
);

function costErrorResponse(
  c: Context,
  error: CostValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "not-found") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such cost entry.",
    });
  }
  if (
    error.code === "frozen-entry" ||
    error.code === "illegal-transition" ||
    error.code === "draft-only"
  ) {
    return problemJson(c, {
      type: "conflict",
      title: "The cost entry cannot change",
      status: 409,
      detail: error.message,
    });
  }
  // non-positive-amount | unsupported-currency | utbms-required | empty-patch
  return problemJson(c, {
    type: "validation",
    title: "Invalid cost-entry request",
    status: 422,
    detail: error.message,
  });
}

type CostApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// Row type read from the cost_entry table for the list / get handlers.
interface CostEntryRow {
  id: string;
  matter_id: string;
  vendor_id: string | null;
  incurred_date: string;
  amount_minor: number;
  currency: string;
  disbursement_class: "hard" | "soft";
  billable: number;
  utbms_expense_code_id: string | null;
  description: string;
  status: "draft" | "submitted" | "approved" | "billed" | "void";
  source: "manual" | "grid" | "recovery";
  recovery_category: string | null;
  invoice_id: string | null;
  created_at: string;
  created_by: string | null;
  kick_back_reason: string | null;
}

/*
 * The listing's statement, in three pieces both listing shapes share.
 *
 * The vendor's name, the matter's and the recorder's are resolved in the same statement rather
 * than a read per row: a matter with fifty disbursements would otherwise be fifty lookups to print
 * one column, and a month of the firm's costs would be a page of them. Two outer joins for the
 * vendor because a vendor is optional on a cost and may be either side of the directory; one for
 * the matter, which is required on a cost but is still an outer join, so a cost whose matter went
 * missing reads back as itself with an unnamed matter rather than vanishing from the firm's own
 * record; and one for the member who recorded it, outer for the same reason and for one more —
 * `created_by` is deliberately not a foreign key, because who wrote a disbursement down is a fact
 * about the past that has to survive that person leaving the firm.
 *
 * BOTH LISTING SHAPES AND THE SINGLE READ SHARE THESE THREE PIECES. A cost read alone and the same
 * cost read in a list are one record, so they are one statement; the detail read used to be a
 * hand-written column list that resolved none of the three names, which made "open this cost"
 * quietly answer with less than the row the reader opened it from.
 */
const LIST_COLUMNS = `cost_entry.id, cost_entry.matter_id, cost_entry.vendor_id,
     cost_entry.incurred_date, cost_entry.amount_minor, cost_entry.currency,
     cost_entry.disbursement_class, cost_entry.billable, cost_entry.utbms_expense_code_id,
     cost_entry.description, cost_entry.status, cost_entry.source,
     cost_entry.recovery_category, cost_entry.invoice_id,
     cost_entry.created_at, cost_entry.created_by, cost_entry.kick_back_reason,
     COALESCE(directory_person.display_name, directory_organization.display_name,
              directory_organization.legal_name) AS vendor_name,
     matter.matter_number AS matter_number, matter.title AS matter_title,
     enterer.display_name AS created_by_name`;

const LIST_FROM = `FROM cost_entry
     LEFT JOIN directory_person
            ON directory_person.id = cost_entry.vendor_id AND directory_person.deleted_at IS NULL
     LEFT JOIN directory_organization
            ON directory_organization.id = cost_entry.vendor_id AND directory_organization.deleted_at IS NULL
     LEFT JOIN matter ON matter.id = cost_entry.matter_id
     LEFT JOIN member enterer ON enterer.user_id = cost_entry.created_by`;

/*
 * The tiebreak is the identifier, not created_at. A keyset cursor needs a TOTAL order and
 * created_at is not one — two costs entered in the same batch share it — so paging over it would
 * skip or repeat rows at a page boundary. The visible consequence is that costs sharing an
 * incurred date appear in a stable arbitrary order rather than an unstable one; there was no order
 * among them before, only the appearance of one.
 */
const LIST_ORDER = "ORDER BY cost_entry.incurred_date DESC, cost_entry.id DESC";

/**
 * The listing's search, as one predicate over the joined statement.
 *
 * A LIKE scan rather than an index, bounded by the page the caller already asked for. The matter's
 * title and number are in it because "what did we lay out on the Whitfield file" is a question
 * about a case before it is a question about a phrase, and the payee's name because a bookkeeper
 * reconciling a vendor's statement asks by the vendor. The wildcards are the caller's text, not
 * their instruction: a description reading "50% deposit" must not match everything.
 */
function searchConditionFor(
  search: string | undefined,
): { condition: string; bindings: readonly unknown[] } | undefined {
  const term = search?.trim();
  if (term === undefined || term.length === 0) return undefined;
  const escaped = term.replaceAll(/[\\%_]/gu, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  return {
    condition:
      "(cost_entry.description LIKE ? ESCAPE '\\' " +
      "OR matter.title LIKE ? ESCAPE '\\' " +
      "OR matter.matter_number LIKE ? ESCAPE '\\' " +
      "OR directory_person.display_name LIKE ? ESCAPE '\\' " +
      "OR directory_organization.display_name LIKE ? ESCAPE '\\' " +
      "OR directory_organization.legal_name LIKE ? ESCAPE '\\')",
    bindings: [pattern, pattern, pattern, pattern, pattern, pattern],
  };
}

/** A listing row: the entry's own columns plus the names the statement resolved beside them. */
type CostListRow = CostEntryRow & {
  vendor_name: string | null;
  matter_number: string | null;
  matter_title: string | null;
  created_by_name: string | null;
};

function rowToSummary(row: CostEntryRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    vendorId: row.vendor_id,
    incurredDate: row.incurred_date,
    amountMinor: row.amount_minor,
    currency: row.currency,
    disbursementClass: row.disbursement_class,
    billable: row.billable === 1,
    utbmsExpenseCodeId: row.utbms_expense_code_id,
    description: row.description,
    status: row.status,
    source: row.source,
    recoveryCategory: row.recovery_category,
    invoiceId: row.invoice_id,
    createdAt: row.created_at,
    createdByUserId: row.created_by,
    kickBackReason: row.kick_back_reason,
  };
}

// The shared idempotent commit for a cost mutation, mapping validation errors to HTTP.
type CostEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<400>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

async function commitCostEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  id: CostEntryId,
  call: () => Promise<{ effect: EffectWrite }>,
): Promise<CostEffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { effect } = await call();
        return {
          write: effect,
          responseCode: 200,
          responseBody: canonicalJsonStringify({ costEntryId: id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof CostValidationError)
      return { ok: false, problem: costErrorResponse(c, caught) };
    // A guarded statement matched no row: the entry moved between this request's precondition read
    // and its commit, and the batch rolled back whole. The member is in exactly the position they
    // would be in had the read seen the winning state, so they get exactly that answer — the same
    // 409 the sequential refusal returns, rather than a second vocabulary for the same fact.
    if (caught instanceof GuardedWriteRefusedError) {
      return {
        ok: false,
        problem: costErrorResponse(
          c,
          new CostValidationError(
            "frozen-entry",
            "the entry changed while this request was in flight, so the change was not applied — reload and try again",
          ),
        ),
      };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  const body = JSON.parse(result.responseBody ?? "{}") as { costEntryId: string };
  return { ok: true, id: body.costEntryId, replayed: result.kind === "replayed" };
}

export function registerCostsRoutes(app: CostApp, chokepoint: Chokepoint): void {
  // POST /api/v1/costs/batch — bulk grid capture (registered before /{id}/* routes).
  app.openapi(
    { ...batchRoute, middleware: chokepointMiddleware(chokepoint, batchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { rows } = c.req.valid("json");

      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const statements: EffectWrite["statements"][number][] = [];
            const outboxMessages: EffectWrite["outboxMessages"][number][] = [];
            const ids: string[] = [];
            for (const row of rows) {
              const captured = await captureCost(
                firm.firmDatabase,
                {
                  matterId: row.matterId,
                  vendorId: row.vendorId ?? undefined,
                  incurredDate: row.incurredDate,
                  amountMinor: row.amountMinor,
                  currency: row.currency,
                  disbursementClass: row.disbursementClass,
                  billable: row.billable,
                  utbmsExpenseCodeId: row.utbmsExpenseCodeId ?? undefined,
                  description: row.description,
                  source: "grid",
                  recoveryCategory: row.recoveryCategory,
                },
                { clock: { now }, actorUserId: userId },
              );
              statements.push(...captured.effect.statements);
              outboxMessages.push(...captured.effect.outboxMessages);
              ids.push(captured.costEntryId);
            }
            return {
              write: { statements, outboxMessages },
              responseCode: 201,
              responseBody: canonicalJsonStringify({ costEntryIds: ids }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof CostValidationError) return costErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof CostBatchAck>, 201);
    },
  );

  // POST /api/v1/costs — capture a manual cost entry
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");

      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const captured = await captureCost(
              firm.firmDatabase,
              {
                matterId: request.matterId,
                vendorId: request.vendorId ?? undefined,
                incurredDate: request.incurredDate,
                amountMinor: request.amountMinor,
                currency: request.currency,
                disbursementClass: request.disbursementClass,
                billable: request.billable,
                utbmsExpenseCodeId: request.utbmsExpenseCodeId ?? undefined,
                description: request.description,
                source: "manual",
                recoveryCategory: request.recoveryCategory,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: captured.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ costEntryId: captured.costEntryId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof CostValidationError) return costErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof CostAck>, 201);
    },
  );

  // GET /api/v1/costs — list cost entries for a matter
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");

      // The two listing shapes read the same rows through the same statement and differ only in
      // what they select on: one matter entire, or a span of incurred dates across every matter.
      // Answering them from one statement is what keeps a cost row identical whichever surface a
      // reader found it on — the alternative is two SELECTs free to disagree about a column.
      const conditions: string[] = [];
      const bindings: unknown[] = [];

      /*
       * Every narrowing is optional and they compose. Nothing named is the firm's whole cost
       * record, most recently incurred first, walked a page at a time over the incurred-date
       * index — the read used to answer empty here "rather than a full-table scan", which made the
       * firm's Costs screen unable to open on its whole record and pushed a period control into
       * its header that duplicated the Date column. A column filter that only narrows the loaded
       * page is not a filter, so each bound and each choice is honoured here instead.
       *
       * NO CAPABILITY BEYOND costs:track GATES THE FIRM-WIDE READ, and that is a deliberate
       * reading rather than an omission. The per-matter listing on this same route already
       * answers for any matter a costs:track holder names, so the whole record reveals nothing
       * that iterating matters would not; a second gate here would be a lock on the front door of
       * a building with no walls. Time's firm-wide listing is gated because time is PERSONAL —
       * whose hours those are is the fact the gate protects — and a disbursement is the firm's own
       * money advanced for a matter, which is a different kind of record.
       */
      if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
        return problemJson(c, {
          type: "validation",
          title: "Unprocessable",
          status: 422,
          detail:
            "The period's first date is after its last. The span is not swapped for you, because a swap would answer a question nobody asked.",
        });
      }
      if (query.from !== undefined) {
        conditions.push("cost_entry.incurred_date >= ?");
        bindings.push(query.from);
      }
      if (query.to !== undefined) {
        conditions.push("cost_entry.incurred_date <= ?");
        bindings.push(query.to);
      }
      if (query.matterId !== undefined) {
        // An absent status means EVERY status. A matter's cost record is all of the cost on it;
        // this defaulted to "draft" and answered a narrower question than it was asked, silently,
        // so an approved or invoiced disbursement simply did not appear on the matter it was
        // advanced for and nothing in the contract said it would not.
        conditions.push("cost_entry.matter_id = ?");
        bindings.push(query.matterId);
      }
      if (query.billable !== undefined) {
        conditions.push("cost_entry.billable = ?");
        bindings.push(query.billable === "true" ? 1 : 0);
      }
      const search = searchConditionFor(query.search);
      if (search !== undefined) {
        conditions.push(search.condition);
        bindings.push(...search.bindings);
      }

      // A status given once arrives as a string and given repeatedly as an array; either is a list.
      const statuses =
        query.status === undefined
          ? []
          : Array.isArray(query.status)
            ? query.status
            : [query.status];
      if (statuses.length > 0) {
        conditions.push(`cost_entry.status IN (${statuses.map(() => "?").join(", ")})`);
        bindings.push(...statuses);
      }
      appendCursorPredicateOnColumn(conditions, bindings, decodeCursor(query.cursor), {
        sortColumn: "cost_entry.incurred_date",
        idColumn: "cost_entry.id",
        ascending: false,
      });
      // One more than the page, as the has-more probe.
      bindings.push(DEFAULT_PAGE_SIZE + 1);

      const { results } = await firm.firmDatabase
        .prepare(
          `SELECT ${LIST_COLUMNS} ${LIST_FROM} ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`} ${LIST_ORDER} LIMIT ?`,
        )
        .bind(...bindings)
        .all<CostListRow>();

      const hasMore = results.length > DEFAULT_PAGE_SIZE;
      const rows = hasMore ? results.slice(0, DEFAULT_PAGE_SIZE) : results;
      const last = rows.at(-1);
      return c.json(
        {
          // Minted over the SORT key. assemblePage mints over created_at, which is the right key
          // only for a read ordered by it.
          nextCursor:
            hasMore && last !== undefined ? encodeCursor(last.incurred_date, last.id) : null,
          data: rows.map((row) => ({
            ...rowToSummary(row),
            vendorName: row.vendor_name,
            matterNumber: row.matter_number,
            matterTitle: row.matter_title,
            createdByName: row.created_by_name,
          })),
        },
        200,
      );
    },
  );

  // GET /api/v1/costs/{id} — detail
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { results } = await firm.firmDatabase
        .prepare(`SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE cost_entry.id = ?1`)
        .bind(id)
        .all<CostListRow>();
      const row = results[0];
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such cost entry in this firm.",
        });
      }
      return c.json(
        {
          ...rowToSummary(row),
          vendorName: row.vendor_name,
          matterNumber: row.matter_number,
          matterTitle: row.matter_title,
          createdByName: row.created_by_name,
        },
        200,
      );
    },
  );

  // PATCH /api/v1/costs/{id} — update a draft cost entry
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patchBody = c.req.valid("json");
      const entryId = id as CostEntryId;

      // Pre-flight existence check: surface not-found (without auditing) before trying the effect.
      const existsRow = await firm.firmDatabase
        .prepare("SELECT id FROM cost_entry WHERE id = ?1")
        .bind(entryId)
        .first<{ id: string }>();
      if (existsRow === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such cost entry.",
        });
      }

      // Map the HTTP patch body to CostDraftPatch. billable arrives as boolean; the statement
      // layer stores it as 0 | 1.
      const patch: CostDraftPatch = {
        vendorId: patchBody.vendorId,
        incurredDate: patchBody.incurredDate,
        amountMinor: patchBody.amountMinor,
        currency: patchBody.currency,
        disbursementClass: patchBody.disbursementClass,
        billable: patchBody.billable === undefined ? undefined : patchBody.billable ? 1 : 0,
        utbmsExpenseCodeId: patchBody.utbmsExpenseCodeId,
        description: patchBody.description,
      };

      const outcome = await commitCostEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        updateDraftCost(firm.firmDatabase, entryId, patch, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ costEntryId: outcome.id } as z.infer<typeof CostAck>, 200);
    },
  );

  // POST /api/v1/costs/{id}/submit | /approve | /kick-back | /void — lifecycle transitions.
  // submit/approve/kickBack resolve the firm review gate; void is always legal from any non-frozen state.
  app.openapi(
    { ...submitRoute, middleware: chokepointMiddleware(chokepoint, submitRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as CostEntryId;
      const gateOn = await readFirmSetting(firm.firmDatabase, approvalRequiredDefinition);
      const outcome = await commitCostEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        submitCost(firm.firmDatabase, entryId, gateOn, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ costEntryId: outcome.id } as z.infer<typeof CostAck>, 200);
    },
  );

  app.openapi(
    { ...approveRoute, middleware: chokepointMiddleware(chokepoint, approveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as CostEntryId;
      const gateOn = await readFirmSetting(firm.firmDatabase, approvalRequiredDefinition);
      const outcome = await commitCostEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        approveCost(firm.firmDatabase, entryId, gateOn, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ costEntryId: outcome.id } as z.infer<typeof CostAck>, 200);
    },
  );

  app.openapi(
    { ...kickBackRoute, middleware: chokepointMiddleware(chokepoint, kickBackRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as CostEntryId;
      const { reason } = c.req.valid("json");
      const gateOn = await readFirmSetting(firm.firmDatabase, approvalRequiredDefinition);
      const outcome = await commitCostEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        kickBackCost(
          firm.firmDatabase,
          entryId,
          gateOn,
          {
            clock: { now: () => new Date().toISOString() },
            actorUserId: userId,
          },
          reason,
        ),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ costEntryId: outcome.id } as z.infer<typeof CostAck>, 200);
    },
  );

  app.openapi(
    { ...voidRoute, middleware: chokepointMiddleware(chokepoint, voidRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as CostEntryId;
      // void is reachable from any non-terminal state regardless of the review gate, so no setting read is needed
      const outcome = await commitCostEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        voidCost(firm.firmDatabase, entryId, false, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ costEntryId: outcome.id } as z.infer<typeof CostAck>, 200);
    },
  );

  // POST /api/v1/costs/{id}/receipt — attach a receipt file to a cost entry
  app.openapi(
    { ...attachReceiptRoute, middleware: chokepointMiddleware(chokepoint, attachReceiptRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { fileId } = c.req.valid("json");
      const entryId = id as CostEntryId;

      const outcome = await commitCostEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        attachReceipt(firm.firmDatabase, entryId, fileId, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ costEntryId: outcome.id } as z.infer<typeof CostAck>, 200);
    },
  );

  // DELETE /api/v1/costs/{id}/receipt — remove the receipt file from a cost entry
  app.openapi(
    { ...detachReceiptRoute, middleware: chokepointMiddleware(chokepoint, detachReceiptRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as CostEntryId;

      const outcome = await commitCostEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        detachReceipt(firm.firmDatabase, entryId, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ costEntryId: outcome.id } as z.infer<typeof CostAck>, 200);
    },
  );
}
