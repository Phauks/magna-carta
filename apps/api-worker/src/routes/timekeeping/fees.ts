import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import {
  approveFee,
  captureFee,
  deleteDraftFee,
  kickBackFee,
  submitFee,
  updateDraftFee,
  voidFee,
} from "@magna-carta/fees/fee-entry-service";
import type { FeeDraftPatch } from "@magna-carta/fees/fee-entry-statements";
import { FeeValidationError } from "@magna-carta/fees/fee-validation";
import { approvalRequiredDefinition } from "@magna-carta/billing-core/review-gate";
import type { FeeEntryId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  appendCursorPredicateOnColumn,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
} from "@magna-carta/data-access/cursor-pagination";
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { cursorQuery, paginated } from "../../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

/*
 * Fees: the recorded-charge WIP store — the third thing a matter accrues, beside its hours and its
 * disbursements.
 *
 * A FEE IS TYPED, NEVER COMPUTED. Nothing here reads a time entry, a rate or an arrangement: an
 * hourly matter's fee value is the time ledger's and reaches a bill as a consolidated line at
 * compose time, and a flat-fee arrangement's amount is the arrangement's. What this store holds is
 * the charge somebody decided on, which was neither and so had nowhere to live.
 *
 * THE PERMISSIONS ARE BILLING'S, not a `fees:` namespace minted for one table. Reading a fee is
 * reading unbilled work in progress, which is what `billing:read` already names; recording one is
 * the same act as drafting the bill it will land on. Approval rides `billing:finalize`, on the
 * reasoning the costs slice used for its own split: the reviewer who may turn work into an
 * evidentiary record is the reviewer who may clear it for billing.
 *
 * AND THAT DECIDES THE RESOURCE, WHICH IS NOT WHAT THIS RECORD LOOKS LIKE. Every fee is a charge on
 * exactly one matter, so `matter` reads as the obvious binding and is wrong: the permission registry
 * binds the whole `billing` namespace to `firm`, and the conformance suite refuses a route that
 * disagrees. It is right that it does — the binding describes what the PERMISSION governs, not what
 * the row happens to name, and a member holding `billing:read` may read unbilled work across every
 * matter, which is exactly the firm-wide period listing below. A `matter` binding would claim these
 * routes are scoped per file when nothing about them is.
 */
const FEE_RESOURCE = "firm" as const;

const READ = "billing:read" as const;
const RECORD = "billing:draft" as const;
const APPROVE = "billing:finalize" as const;

const serviceDateField = z.string().regex(CIVIL_DATE_PATTERN);

const CreateFeeRequest = z
  .object({
    matterId: identifierField("matter"),
    serviceDate: serviceDateField,
    timekeeperUserId: z.string().nullable().optional(),
    description: z.string(),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    billable: z.boolean(),
    memo: z.string().nullable().optional(),
  })
  .openapi("CreateFeeRequest");

const PatchFeeRequest = z
  .object({
    serviceDate: serviceDateField.optional(),
    timekeeperUserId: z.string().nullable().optional(),
    description: z.string().optional(),
    amountMinor: z.number().int().positive().optional(),
    currency: z.literal("USD").optional(),
    billable: z.boolean().optional(),
    memo: z.string().nullable().optional(),
  })
  .openapi("PatchFeeRequest");

const FeeSummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    // The date the charge is FOR — the day the work was done. A different fact from `createdAt`,
    // the day somebody wrote it down, and only the two together say whether a charge was captured
    // as it happened or reconstructed weeks later.
    serviceDate: z.string(),
    timekeeperUserId: z.string().nullable(),
    // Resolved beside the record by a member outer join, never a lookup per row. Null over a
    // present identifier means the member row is gone rather than that nobody was named.
    timekeeperName: z.string().nullable(),
    description: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    billable: z.boolean(),
    status: z.enum(["draft", "submitted", "approved", "billed", "void"]),
    // Why a reviewer sent it back, or null. Set by the kick-back transition and cleared by the next
    // submission, so a non-null value means exactly "this draft came back and has not been sent
    // again" — the only thing telling a returned draft from one nobody has submitted.
    kickBackReason: z.string().nullable(),
    // The bill that took it up, or null while nothing has. What puts a billed fee one click from
    // what the client was actually told.
    invoiceId: z.string().nullable(),
    // For the firm alone. It never reaches a bill, a print sheet or the client portal.
    memo: z.string().nullable(),
    createdAt: z.string(),
    createdByUserId: z.string().nullable(),
    createdByName: z.string().nullable(),
    // The matter's own name and number, resolved beside the record for the same reason the
    // timekeeper's is: the firm-wide period prints the matter on every row.
    matterNumber: z.string().nullable(),
    matterTitle: z.string().nullable(),
  })
  .openapi("FeeSummary");

const FeeListResponse = paginated(FeeSummary).openapi("FeeListResponse");

const FeeAck = z.object({ feeEntryId: z.string() }).openapi("FeeAck");

const FeeKickBackRequest = z.object({ reason: z.string().min(1) }).openapi("FeeKickBackRequest");

const feeParam = z.object({ id: identifierPathParam("feeEntry", "id") });

const feeStatusField = z.enum(["draft", "submitted", "approved", "billed", "void"]);

const listQuery = z.object({
  ...cursorQuery.shape,
  matterId: identifierField("matter").optional(),
  from: serviceDateField.optional().openapi({
    description:
      "The first service date the listing covers, inclusive. Either bound stands alone: a " +
      "listing with only `from` runs to the present, one with only `to` runs from the first fee " +
      "the firm ever recorded, and one with neither is the firm's whole record. This is the " +
      "screen's Date column filter, honoured here so it is true across every page rather than " +
      "over the page in hand.",
  }),
  to: serviceDateField.optional().openapi({
    description: "The last service date the listing covers, inclusive.",
  }),
  billable: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      description:
        "Narrows a listing to the fees that are billable, or to those that are not. Omitted, it " +
        "answers with both.",
    }),
  status: z
    .union([feeStatusField, z.array(feeStatusField)])
    .optional()
    .openapi({
      description:
        "Narrows to one status, or to several given repeatedly (`status=draft&status=submitted`): " +
        "the screen's Status column filter, honoured here so it holds across every page.",
    }),
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({
      description:
        "Matched against the description, the matter's title and number, and the timekeeper's " +
        "name. The screen's search, honoured here so a word absent from the page in hand is " +
        "looked for across the whole record.",
    }),
});

// Each route file states its own, because the descriptions are the route's: a reader of the
// generated contract is told what 404 means HERE, not what it means in general.
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
    description: "The firm is unreachable, the member is deactivated, or the fee entry is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the entry is frozen (billed or void), the entry is not a draft, or the lifecycle transition is illegal",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, the period's first date is after its last, or the amount is not a positive integer",
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

function writeMeta(operationId: string, permission: typeof RECORD | typeof APPROVE): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    resource: FEE_RESOURCE,
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const createMeta = writeMeta("fees.create", RECORD);
const updateMeta = writeMeta("fees.update", RECORD);
const submitMeta = writeMeta("fees.submit", RECORD);
const approveMeta = writeMeta("fees.approve", APPROVE);
const kickBackMeta = writeMeta("fees.kickBack", APPROVE);
const voidMeta = writeMeta("fees.void", RECORD);
const deleteDraftMeta: RouteMeta = {
  ...writeMeta("fees.deleteDraft", RECORD),
  /*
   * Nothing puts it back, and that is the point of the verb rather than a gap in it.
   *
   * A fee that entered review — submitted, approved, billed or voided — has a record somebody may be
   * asked to account for, so it is VOIDED and stays on the ledger as evidence of what was withdrawn;
   * this route refuses one with a 409. What it removes is a draft nobody else has seen, which has no
   * such record to preserve. Leaving a tombstone for a charge that was never made would put a row on
   * the books that means nothing, and the way back is simply to record the fee again.
   */
  reversal: {
    kind: "none",
    reason:
      "A draft that never entered review has no record to preserve, so it is removed rather than tombstoned. Anything that has been submitted, approved, billed or voided is refused here and voided instead, which is the act that keeps it on the ledger. The way back is to record the fee again.",
  },
};

const listMeta: RouteMeta = {
  operationId: "fees.list",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: FEE_RESOURCE,
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getMeta: RouteMeta = {
  operationId: "fees.get",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: FEE_RESOURCE,
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/fees",
  description:
    "Records a flat charge for professional services against a matter. The amount is stored " +
    "exactly as given, in minor units, and is never computed from time entries.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateFeeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The fee entry was recorded",
      content: { "application/json": { schema: FeeAck } },
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
  path: "/api/v1/fees",
  description:
    "Lists fee entries, most recent service date first, cursor-paged. Nothing named is the " +
    "firm's whole record; `matterId` narrows it to one matter, `from` and `to` bound the service " +
    "dates (each on its own or together), and `status`, `billable` and `search` narrow further. " +
    "Every narrowing is the server's, so the firm's Fees screen can send its column filters here " +
    "and have them hold across every page.",
  request: { query: listQuery },
  responses: {
    200: {
      description: "One page of fee entries",
      content: { "application/json": { schema: FeeListResponse } },
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
  path: "/api/v1/fees/{id}",
  description: "Reads one fee entry, with the same resolved names the listing carries.",
  request: { params: feeParam },
  responses: {
    200: {
      description: "The fee entry",
      content: { "application/json": { schema: FeeSummary } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const updateRoute = defineOpenAPIRoute(updateMeta, {
  method: "patch",
  path: "/api/v1/fees/{id}",
  description:
    "Updates a draft fee entry. A billed or void entry is frozen and cannot be edited. A " +
    "submitted or approved entry is not draft and returns 409.",
  request: {
    headers: idempotencyKeyHeader,
    params: feeParam,
    body: { content: { "application/json": { schema: PatchFeeRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The fee entry was updated",
      content: { "application/json": { schema: FeeAck } },
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

function feeTransitionRoute(meta: RouteMeta, action: string, description: string) {
  return defineOpenAPIRoute(meta, {
    method: "post",
    path: `/api/v1/fees/{id}/${action}`,
    description,
    request: { headers: idempotencyKeyHeader, params: feeParam },
    responses: {
      200: {
        description: "The transition was applied",
        content: { "application/json": { schema: FeeAck } },
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

const submitRoute = feeTransitionRoute(
  submitMeta,
  "submit",
  "Submits a draft fee entry for review. Only legal when the firm's billing review gate is on.",
);
const approveRoute = feeTransitionRoute(
  approveMeta,
  "approve",
  "Approves a submitted fee entry, making it eligible for billing.",
);
const voidRoute = feeTransitionRoute(
  voidMeta,
  "void",
  "Voids a fee entry. The row freezes — it can no longer be edited or billed, and stays on the ledger as the record of what was withdrawn.",
);

const kickBackRoute = defineOpenAPIRoute(kickBackMeta, {
  method: "post",
  path: "/api/v1/fees/{id}/kick-back",
  description:
    "Returns a submitted fee entry to draft with an audited reason. The reason is stored on the " +
    "entry and cleared by the next submission.",
  request: {
    headers: idempotencyKeyHeader,
    params: feeParam,
    body: { content: { "application/json": { schema: FeeKickBackRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The transition was applied",
      content: { "application/json": { schema: FeeAck } },
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

const deleteDraftRoute = defineOpenAPIRoute(deleteDraftMeta, {
  method: "delete",
  path: "/api/v1/fees/{id}",
  description:
    "Deletes a draft fee entry that never entered review. Anything that has been submitted, " +
    "approved, billed or voided has a record to preserve and is voided instead, so this returns " +
    "409 for one.",
  request: { headers: idempotencyKeyHeader, params: feeParam },
  responses: {
    200: {
      description: "The draft was deleted",
      content: { "application/json": { schema: FeeAck } },
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

type FeeApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

/** A listing row: the entry's own columns plus the names the statement resolved beside them. */
interface FeeListRow {
  id: string;
  matter_id: string;
  service_date: string;
  timekeeper_user_id: string | null;
  description: string;
  amount_minor: number;
  currency: string;
  billable: number;
  status: "draft" | "submitted" | "approved" | "billed" | "void";
  kick_back_reason: string | null;
  invoice_id: string | null;
  memo: string | null;
  created_at: string;
  created_by: string | null;
  timekeeper_name: string | null;
  created_by_name: string | null;
  matter_number: string | null;
  matter_title: string | null;
}

/*
 * The listing's statement, in three pieces every shape shares.
 *
 * ONE STATEMENT, THREE SHAPES: the per-matter listing, the firm-wide span, and the single-entry
 * read. The cost route learned this the expensive way — its detail read was a hand-written column
 * list that resolved none of the names, so opening one cost answered with less than the row it was
 * opened from — and this route starts where that ended.
 *
 * Every name is resolved here rather than by a read per row. All three joins are outer: a record
 * whose member or matter went missing reads back as itself with an unnamed one, rather than
 * vanishing from the firm's own ledger. Neither `timekeeper_user_id` nor `created_by` is a foreign
 * key, deliberately — whose work was charged, and who wrote it down, are facts about the past that
 * outlive the membership.
 */
const LIST_COLUMNS = `fee_entry.id, fee_entry.matter_id, fee_entry.service_date,
     fee_entry.timekeeper_user_id, fee_entry.description, fee_entry.amount_minor,
     fee_entry.currency, fee_entry.billable, fee_entry.status, fee_entry.kick_back_reason,
     fee_entry.invoice_id, fee_entry.memo, fee_entry.created_at, fee_entry.created_by,
     timekeeper.display_name AS timekeeper_name,
     enterer.display_name AS created_by_name,
     matter.matter_number AS matter_number, matter.title AS matter_title`;

const LIST_FROM = `FROM fee_entry
     LEFT JOIN member timekeeper ON timekeeper.user_id = fee_entry.timekeeper_user_id
     LEFT JOIN member enterer ON enterer.user_id = fee_entry.created_by
     LEFT JOIN matter ON matter.id = fee_entry.matter_id`;

/*
 * The tiebreak is the identifier, not created_at. A keyset cursor needs a TOTAL order and
 * created_at is not one — two fees recorded in the same batch share it — so paging over it would
 * skip or repeat rows at a page boundary. The visible consequence is that fees sharing a service
 * date appear in a stable arbitrary order rather than an unstable one; there was no order among
 * them before, only the appearance of one.
 */
const LIST_ORDER = "ORDER BY fee_entry.service_date DESC, fee_entry.id DESC";

/**
 * The listing's search, as one predicate over the joined statement.
 *
 * A LIKE scan rather than an index, bounded by the page the caller already asked for. The matter's
 * title and number are in it because "what did we charge on the Whitfield file" is a question
 * about a case before it is a question about a phrase, and the timekeeper's name because a
 * bookkeeper reconciling a month asks whose charges these were. The wildcards are the caller's
 * text, not their instruction: a description reading "50% retainer" must not match everything.
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
      "(fee_entry.description LIKE ? ESCAPE '\\' " +
      "OR matter.title LIKE ? ESCAPE '\\' " +
      "OR matter.matter_number LIKE ? ESCAPE '\\' " +
      "OR timekeeper.display_name LIKE ? ESCAPE '\\')",
    bindings: [pattern, pattern, pattern, pattern],
  };
}

function rowToSummary(row: FeeListRow): z.infer<typeof FeeSummary> {
  return {
    id: row.id,
    matterId: row.matter_id,
    serviceDate: row.service_date,
    timekeeperUserId: row.timekeeper_user_id,
    timekeeperName: row.timekeeper_name,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    billable: row.billable === 1,
    status: row.status,
    kickBackReason: row.kick_back_reason,
    invoiceId: row.invoice_id,
    memo: row.memo,
    createdAt: row.created_at,
    createdByUserId: row.created_by,
    createdByName: row.created_by_name,
    matterNumber: row.matter_number,
    matterTitle: row.matter_title,
  };
}

function feeErrorResponse(
  c: Context,
  error: FeeValidationError,
): ProblemResponse<400> | ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "not-found") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (
    error.code === "draft-only" ||
    error.code === "frozen-entry" ||
    error.code === "illegal-transition"
  ) {
    return problemJson(c, {
      type: "conflict",
      title: "The fee entry cannot change",
      status: 409,
      detail: error.message,
    });
  }
  // non-positive-amount | unsupported-currency | empty-patch
  return problemJson(c, {
    type: "validation",
    title: "Invalid fee-entry request",
    status: 422,
    detail: error.message,
  });
}

// The shared idempotent commit for a fee mutation, mapping validation errors to HTTP.
type FeeEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<400>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

async function commitFeeEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  id: FeeEntryId,
  call: () => Promise<{ effect: EffectWrite }>,
): Promise<FeeEffectOutcome> {
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
          responseBody: canonicalJsonStringify({ feeEntryId: id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof FeeValidationError)
      return { ok: false, problem: feeErrorResponse(c, caught) };
    // A guarded statement matched no row: the entry moved between this request's precondition read
    // and its commit, and the batch rolled back whole. The member is in exactly the position they
    // would be in had the read seen the winning state, so they get exactly that answer — the same
    // 409 the sequential refusal returns, rather than a second vocabulary for the same fact.
    if (caught instanceof GuardedWriteRefusedError) {
      return {
        ok: false,
        problem: feeErrorResponse(
          c,
          new FeeValidationError(
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
  const body = JSON.parse(result.responseBody ?? "{}") as { feeEntryId: string };
  return { ok: true, id: body.feeEntryId, replayed: result.kind === "replayed" };
}

export function registerFeesRoutes(app: FeeApp, chokepoint: Chokepoint): void {
  // POST /api/v1/fees — record a fee
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
            const captured = await captureFee(
              firm.firmDatabase,
              {
                matterId: request.matterId,
                serviceDate: request.serviceDate,
                timekeeperUserId: request.timekeeperUserId ?? undefined,
                description: request.description,
                amountMinor: request.amountMinor,
                currency: request.currency,
                billable: request.billable,
                memo: request.memo ?? undefined,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: captured.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ feeEntryId: captured.feeEntryId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof FeeValidationError) return feeErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof FeeAck>, 201);
    },
  );

  // GET /api/v1/fees — the per-matter listing and the firm-wide span, over one statement
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      /*
       * Every narrowing is optional and they compose. Nothing named is the firm's whole fee record,
       * newest service date first, walked a page at a time over the service-date index — the read
       * used to answer empty here "rather than a full-table scan", which made the firm's Fees
       * screen unable to open on its whole record and pushed a period control into its header
       * that duplicated the Date column. A column filter that only narrows the loaded page is
       * not a filter, so each bound and each choice is honoured here instead.
       */
      const conditions: string[] = [];
      const bindings: unknown[] = [];

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
        conditions.push("fee_entry.service_date >= ?");
        bindings.push(query.from);
      }
      if (query.to !== undefined) {
        conditions.push("fee_entry.service_date <= ?");
        bindings.push(query.to);
      }
      if (query.matterId !== undefined) {
        // An absent status means EVERY status: a matter's fee record is all of the fees on it.
        conditions.push("fee_entry.matter_id = ?");
        bindings.push(query.matterId);
      }
      const search = searchConditionFor(query.search);
      if (search !== undefined) {
        conditions.push(search.condition);
        bindings.push(...search.bindings);
      }

      if (query.billable !== undefined) {
        conditions.push("fee_entry.billable = ?");
        bindings.push(query.billable === "true" ? 1 : 0);
      }
      // A status given once arrives as a string and given repeatedly as an array; either is a list.
      const statuses =
        query.status === undefined
          ? []
          : Array.isArray(query.status)
            ? query.status
            : [query.status];
      if (statuses.length > 0) {
        conditions.push(`fee_entry.status IN (${statuses.map(() => "?").join(", ")})`);
        bindings.push(...statuses);
      }
      appendCursorPredicateOnColumn(conditions, bindings, decodeCursor(query.cursor), {
        sortColumn: "fee_entry.service_date",
        idColumn: "fee_entry.id",
        ascending: false,
      });
      // One more than the page, as the has-more probe.
      bindings.push(DEFAULT_PAGE_SIZE + 1);

      const { results } = await firm.firmDatabase
        .prepare(
          `SELECT ${LIST_COLUMNS} ${LIST_FROM} ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`} ${LIST_ORDER} LIMIT ?`,
        )
        .bind(...bindings)
        .all<FeeListRow>();

      const hasMore = results.length > DEFAULT_PAGE_SIZE;
      const rows = hasMore ? results.slice(0, DEFAULT_PAGE_SIZE) : results;
      const last = rows.at(-1);
      return c.json(
        {
          // Minted over the SORT key. assemblePage mints over created_at, which is the right key
          // only for a read ordered by it.
          nextCursor:
            hasMore && last !== undefined ? encodeCursor(last.service_date, last.id) : null,
          data: rows.map(rowToSummary),
        },
        200,
      );
    },
  );

  // GET /api/v1/fees/{id} — the same statement, one row
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { results } = await firm.firmDatabase
        .prepare(`SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE fee_entry.id = ?1`)
        .bind(id)
        .all<FeeListRow>();
      const row = results[0];
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such fee entry in this firm.",
        });
      }
      return c.json(rowToSummary(row), 200);
    },
  );

  // PATCH /api/v1/fees/{id} — draft-only edit
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      const entryId = id as FeeEntryId;
      const now = () => new Date().toISOString();

      const patch: FeeDraftPatch = {
        ...(request.serviceDate === undefined ? {} : { serviceDate: request.serviceDate }),
        ...(request.timekeeperUserId === undefined
          ? {}
          : { timekeeperUserId: request.timekeeperUserId }),
        ...(request.description === undefined ? {} : { description: request.description }),
        ...(request.amountMinor === undefined ? {} : { amountMinor: request.amountMinor }),
        ...(request.currency === undefined ? {} : { currency: request.currency }),
        ...(request.billable === undefined ? {} : { billable: request.billable ? 1 : 0 }),
        ...(request.memo === undefined ? {} : { memo: request.memo }),
      };

      const outcome = await commitFeeEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        updateDraftFee(firm.firmDatabase, entryId, patch, {
          clock: { now },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      return c.json({ feeEntryId: outcome.id }, 200);
    },
  );

  // DELETE /api/v1/fees/{id} — remove a draft that never entered review
  app.openapi(
    { ...deleteDraftRoute, middleware: chokepointMiddleware(chokepoint, deleteDraftRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as FeeEntryId;
      const now = () => new Date().toISOString();

      const outcome = await commitFeeEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        deleteDraftFee(firm.firmDatabase, entryId, { clock: { now }, actorUserId: userId }),
      );
      if (!outcome.ok) return outcome.problem;
      return c.json({ feeEntryId: outcome.id }, 200);
    },
  );

  // POST /api/v1/fees/{id}/submit | /approve | /kick-back | /void — lifecycle transitions.
  // submit/approve/kickBack resolve the firm review gate; void is legal from any non-frozen state.
  const transitions: {
    route: ReturnType<typeof feeTransitionRoute>;
    run: (
      database: BatchDatabase,
      entryId: FeeEntryId,
      gateOn: boolean,
      userId: string,
      now: () => string,
    ) => Promise<{ effect: EffectWrite }>;
  }[] = [
    {
      route: submitRoute,
      run: (database, entryId, gateOn, userId, now) =>
        submitFee(database, entryId, gateOn, { clock: { now }, actorUserId: userId as never }),
    },
    {
      route: approveRoute,
      run: (database, entryId, gateOn, userId, now) =>
        approveFee(database, entryId, gateOn, { clock: { now }, actorUserId: userId as never }),
    },
    {
      route: voidRoute,
      run: (database, entryId, gateOn, userId, now) =>
        voidFee(database, entryId, gateOn, { clock: { now }, actorUserId: userId as never }),
    },
  ];

  for (const { route, run } of transitions) {
    app.openapi({ ...route, middleware: chokepointMiddleware(chokepoint, route) }, async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as FeeEntryId;
      const now = () => new Date().toISOString();
      const gateOn = await readFirmSetting(firm.firmDatabase, approvalRequiredDefinition);

      const outcome = await commitFeeEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        run(firm.firmDatabase, entryId, gateOn, userId, now),
      );
      if (!outcome.ok) return outcome.problem;
      return c.json({ feeEntryId: outcome.id }, 200);
    });
  }

  app.openapi(
    { ...kickBackRoute, middleware: chokepointMiddleware(chokepoint, kickBackRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      const entryId = id as FeeEntryId;
      const now = () => new Date().toISOString();
      const gateOn = await readFirmSetting(firm.firmDatabase, approvalRequiredDefinition);

      const outcome = await commitFeeEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        kickBackFee(
          firm.firmDatabase,
          entryId,
          gateOn,
          { clock: { now }, actorUserId: userId },
          reason,
        ),
      );
      if (!outcome.ok) return outcome.problem;
      return c.json({ feeEntryId: outcome.id }, 200);
    },
  );
}
