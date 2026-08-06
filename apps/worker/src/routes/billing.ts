import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  composeAccountRoleConfiguration,
  isAccountRole,
  readAccountRoleMap,
} from "@magna-carta/billing/account-roles";
import { BillingValidationError } from "@magna-carta/billing/billing-validation";
import {
  addClaimsToDraft,
  createInvoiceDraft,
  removeClaim,
  updateDraftLine,
  voidDraft,
} from "@magna-carta/billing/draft";
import { finalizeInvoice } from "@magna-carta/billing/finalize";
import {
  listInvoices,
  readAccountsReceivableAging,
  readInvoiceDetail,
  readMatterReceivable,
  readUnbilledWorkInProgress,
} from "@magna-carta/billing/queries";
import { ACCOUNT_ROLES } from "@magna-carta/billing/types";
import { approvalRequiredDefinition } from "@magna-carta/billing-core/review-gate";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import { isValidCalendarDate, LedgerValidationError } from "@magna-carta/ledger/validate";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { isNumberAllocationConflict } from "@magna-carta/sequence-numbering/counter-statements";
import { INVOICE_NUMBERING_TABLES } from "@magna-carta/billing/numbering";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { problemResponseForLedgerRefusal } from "../ledger-refusal-problems.ts";

// Billing: the firm's own bill. A DRAFT is a working document and everything on these routes is
// editable; FINALIZATION is the transition to evidence, and after it the invoice, its lines, and its
// claims are frozen by database trigger. There is deliberately no un-finalize endpoint and no edit
// endpoint that reaches a finalized invoice: a bill that should not have been issued is corrected by
// a credit note, which is a second permanent record rather than the erasure of the first.
//
// This module composes and commits; it decides nothing. The rules live one layer down in
// @magna-carta/billing, and one layer below that in the invoice_matter_balance bounds CHECK and the
// freeze triggers, which are what actually abort a batch. What belongs here is the mapping from a
// refusal to an HTTP status, the bounded retry around a lost number draw, and the resolution of
// names the domain will not invent for itself — which member is on the session, and what letterhead
// the bill is issued on.

const READ = "billing:read" as const;
const DRAFT = "billing:draft" as const;
const FINALIZE = "billing:finalize" as const;
const CONFIGURE = "billing:configure" as const;

// A real calendar date, not a shape. The bare regex accepts 2026-02-30 and next week alike; both
// reach the ledger's own check at the finalize posting, and the aging read turns an unparseable
// as-of date into NaN, which fails every bucket comparison and reports the whole receivable as 90+.
const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, { message: "not a calendar date" });

const CreateInvoiceRequest = z
  .object({
    // The Directory handle for the client this bill is for. One client per invoice: every line's
    // matter is validated against it, and a matter belonging to another client is refused by name.
    clientEntityId: z.string().min(1),
    currency: z.literal("USD"),
    billingPeriodStart: civilDate.nullable().optional(),
    billingPeriodEnd: civilDate.nullable().optional(),
    notes: z.string().nullable().optional(),
    locationId: identifierField("location").nullable().optional(),
  })
  .openapi("BillingCreateInvoiceRequest");

const ClaimRequest = z
  .object({
    sourceKind: z.enum(["time_entry", "cost_entry"]),
    sourceId: z.string().min(1),
  })
  .openapi("BillingClaimRequest");

const AddClaimsRequest = z
  .object({ claims: z.array(ClaimRequest).min(1) })
  .openapi("BillingAddClaimsRequest");

const UpdateLineRequest = z
  .object({
    description: z.string().min(1).optional(),
    // Hours at the rate scale. Trimming a line is bill review; the time entry it was composed from
    // is the timekeeper's own record and is not touched.
    quantityE4: z.number().int().nullable().optional(),
    rateE4: z.number().int().nullable().optional(),
    amountMinor: z.number().int().optional(),
    taxTreatment: z.enum(["taxable", "exempt"]).optional(),
  })
  .openapi("BillingUpdateLineRequest");

const VoidDraftRequest = z.object({ reason: z.string().min(1) }).openapi("BillingVoidDraftRequest");

const FinalizeRequest = z
  .object({
    issueDate: civilDate,
    dueDate: civilDate,
    // Absent means the firm-wide sequence. A multi-office firm issuing on two letterheads passes its
    // office scope and gets an independent, gapless sequence per letterhead.
    numberScopeKey: z.string().min(1).optional(),
    // Deliberate consent to START a sequence under a scope key this firm has never used. Without it
    // an unrecognized key is refused, because the key is free text that selects which counter the
    // number is drawn from: `nyc` where the firm has always sent `NYC` would otherwise mint a second
    // sequence in silence, and the next bill out the door would be numbered `nyc-00001` while
    // `NYC-00042` was the real next number.
    createNumberScope: z.boolean().optional(),
    // The presentation snapshot. Copied onto the invoice at this moment and never read live again:
    // a later edit to an office address must not silently alter a document already given to a client.
    locationId: identifierField("location").nullable().optional(),
    letterheadAddressBlock: z.string().nullable().optional(),
    letterheadFooter: z.string().nullable().optional(),
    remitTo: z.string().nullable().optional(),
    clientBillingName: z.string().nullable().optional(),
  })
  .openapi("BillingFinalizeRequest");

const AccountRoleAssignment = z
  .object({
    role: z.enum(ACCOUNT_ROLES),
    ledgerAccountId: identifierField("ledgerAccount"),
  })
  .openapi("BillingAccountRoleAssignment");

const AccountRoleRequest = z
  .object({ assignments: z.array(AccountRoleAssignment).min(1) })
  .openapi("BillingAccountRoleRequest");

const AccountRoleMapResponse = z
  .object({ assignments: z.array(AccountRoleAssignment) })
  .openapi("BillingAccountRoleMapResponse");

const InvoiceAck = z
  .object({ invoiceId: z.string(), status: z.enum(["draft", "final", "void"]) })
  .openapi("BillingInvoiceAck");

const ClaimAck = z
  .object({ invoiceId: z.string(), claimIds: z.array(z.string()), lineIds: z.array(z.string()) })
  .openapi("BillingClaimAck");

const FinalizeAck = z
  .object({
    invoiceId: z.string(),
    invoiceNumber: z.string(),
    totalMinor: z.number().int(),
    currency: z.string(),
    ledgerEntryId: z.string(),
  })
  .openapi("BillingFinalizeAck");

const InvoiceListItem = z
  .object({
    id: z.string(),
    clientEntityId: z.string(),
    currency: z.string(),
    status: z.enum(["draft", "final", "void"]),
    invoiceNumber: z.string().nullable(),
    issueDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    totalMinor: z.number().int(),
    appliedMinor: z.number().int(),
    unpaidMinor: z.number().int(),
    createdAt: z.string(),
  })
  .openapi("BillingInvoiceListItem");

const InvoiceListResponse = z
  .object({ data: z.array(InvoiceListItem), nextCursor: z.string().nullable() })
  .openapi("BillingInvoiceListResponse");

const InvoiceDetailResponse = InvoiceListItem.extend({
  lines: z.array(
    z.object({
      id: z.string(),
      lineIndex: z.number().int(),
      matterId: z.string(),
      kind: z.string(),
      description: z.string(),
      amountMinor: z.number().int(),
    }),
  ),
  matterBalances: z.array(
    z.object({
      matterId: z.string(),
      totalMinor: z.number().int(),
      appliedMinor: z.number().int(),
      unpaidMinor: z.number().int(),
    }),
  ),
}).openapi("BillingInvoiceDetailResponse");

const UnbilledResponse = z
  .object({
    matterId: z.string(),
    timeEntryCount: z.number().int(),
    timeAmountMinor: z.number().int(),
    costEntryCount: z.number().int(),
    costAmountMinor: z.number().int(),
    // What this matter still owes across every finalized invoice that bills it.
    receivableTotalMinor: z.number().int(),
    receivableAppliedMinor: z.number().int(),
    receivableUnpaidMinor: z.number().int(),
  })
  .openapi("BillingUnbilledResponse");

const AgingResponse = z
  .object({
    asOfDate: z.string(),
    buckets: z.array(
      z.object({
        label: z.string(),
        invoiceCount: z.number().int(),
        unpaidMinor: z.number().int(),
      }),
    ),
  })
  .openapi("BillingAgingResponse");

const invoiceParam = z.object({ invoiceId: identifierPathParam("invoice", "invoiceId") });
const lineParam = z.object({
  invoiceId: identifierPathParam("invoice", "invoiceId"),
  lineId: identifierPathParam("invoiceLine", "lineId"),
});
const claimParam = z.object({
  invoiceId: identifierPathParam("invoice", "invoiceId"),
  claimId: identifierPathParam("invoiceWipClaim", "claimId"),
});
const matterParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const listQuery = z.object({
  clientEntityId: z.string().min(1).optional(),
  status: z.enum(["draft", "final", "void"]).optional(),
  cursor: z.string().optional(),
});
const agingQuery = z.object({ asOfDate: civilDate.optional() });

const errorResponses = {
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
    description: "The firm is unreachable, the member is deactivated, or the invoice is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the invoice is no longer a draft, or another draft already holds this work",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, a ledger account role the posting needs is unmapped, or the billing rules refuse the change",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const readErrorResponses = {
  401: errorResponses[401],
  403: errorResponses[403],
  404: errorResponses[404],
  422: errorResponses[422],
  429: errorResponses[429],
} as const;

const mutationResponses = {
  400: errorResponses[400],
  401: errorResponses[401],
  403: errorResponses[403],
  404: errorResponses[404],
  409: errorResponses[409],
  422: errorResponses[422],
  429: errorResponses[429],
} as const;

type BillingPermission = typeof READ | typeof DRAFT | typeof FINALIZE | typeof CONFIGURE;

function writeMeta(operationId: string, permission: BillingPermission): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    // One invoice may bill several of a client's matters, so the matter is not its tenancy root.
    resource: "firm",
    audited: true,
    // Money mutations are never replayable: a retried finalize that drew a second number would
    // consume a number the sequence can never give back, and a retried claim would double-bill.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function readMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const createInvoiceRoute = defineOpenAPIRoute(writeMeta("billing.createInvoice", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices",
  description:
    "Opens a draft invoice for one client. A draft is a working document: nothing has been asserted to anybody, no number has been drawn, and no work is locked. It becomes a financial record only when it is finalized.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateInvoiceRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The draft invoice was opened",
      content: { "application/json": { schema: InvoiceAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const addClaimsRoute = defineOpenAPIRoute(writeMeta("billing.addClaims", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/claims",
  description:
    "Pulls unbilled time and cost entries onto a draft, composing a line from each entry's own snapshot. The entries are CLAIMED, not locked: they stay editable, and they become billed only when the invoice is finalized. An entry another draft already holds is refused, and so is a matter belonging to a different client.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: AddClaimsRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The work was claimed and its lines composed",
      content: { "application/json": { schema: ClaimAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const releaseClaimRoute = defineOpenAPIRoute(writeMeta("billing.releaseClaim", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/claims/{claimId}/release",
  description:
    "Takes one claimed entry back off a draft, returning it to unbilled work-in-progress and removing the line that presented it. The claim record itself remains, released, so that this entry was once on this draft stays answerable.",
  request: { headers: idempotencyKeyHeader, params: claimParam },
  responses: {
    201: {
      description: "The claim was released",
      content: { "application/json": { schema: InvoiceAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const updateLineRoute = defineOpenAPIRoute(writeMeta("billing.updateLine", DRAFT), {
  method: "patch",
  path: "/api/v1/billing/invoices/{invoiceId}/lines/{lineId}",
  description:
    "Edits one line of a draft — its wording, its quantity, its rate, or its amount. This is bill review, and it changes what the CLIENT is told; the time entry the line was composed from is the timekeeper's contemporaneous record of what was done and is left exactly as it was.",
  request: {
    headers: idempotencyKeyHeader,
    params: lineParam,
    body: { content: { "application/json": { schema: UpdateLineRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The line was updated",
      content: { "application/json": { schema: InvoiceAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const voidDraftRoute = defineOpenAPIRoute(writeMeta("billing.voidDraft", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/void",
  description:
    "Throws a draft away, releasing every entry it held back to unbilled work-in-progress. Only a draft can be voided: a finalized invoice is corrected by a credit note, never erased.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: VoidDraftRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The draft was voided and its work released",
      content: { "application/json": { schema: InvoiceAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const finalizeRoute = defineOpenAPIRoute(writeMeta("billing.finalizeInvoice", FINALIZE), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/finalization",
  description:
    "Turns a draft into an evidentiary financial record, in ONE atomic write: the next number in the sequence is drawn, the letterhead and client details are copied onto the invoice, every claimed entry locks as billed, the per-matter balances are created with the ceiling that makes over-application impossible, and the accounts-receivable entry posts. Nothing about the invoice can be edited afterwards. If any part fails, no number is consumed, no work is locked, and nothing is posted. A firm that has not told the platform which of its ledger accounts play the billing roles is refused here, by name, rather than posted somewhere plausible.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: FinalizeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The invoice was finalized and the receivable posted",
      content: { "application/json": { schema: FinalizeAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const setAccountRolesRoute = defineOpenAPIRoute(writeMeta("billing.setAccountRoles", CONFIGURE), {
  method: "put",
  path: "/api/v1/billing/account-roles",
  description:
    "Tells the platform which of the firm's ledger accounts plays each part in a billing posting — the receivable, fee income, advanced client costs, cost recovery, tax payable, and the rest. Until a role is mapped, any invoice whose lines need it refuses to finalize. Re-pointing a role changes where FUTURE postings land and never restates one already made.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: AccountRoleRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The account-role map was updated",
      content: { "application/json": { schema: AccountRoleMapResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const accountRolesRoute = defineOpenAPIRoute(
  { ...readMeta("billing.accountRoles"), permission: CONFIGURE },
  {
    method: "get",
    path: "/api/v1/billing/account-roles",
    description:
      "Returns which ledger account currently plays each billing posting role. A role that is absent is a role no invoice needing it can be finalized against.",
    responses: {
      200: {
        description: "The account-role map",
        content: { "application/json": { schema: AccountRoleMapResponse } },
      },
      401: readErrorResponses[401],
      403: readErrorResponses[403],
      404: readErrorResponses[404],
      422: readErrorResponses[422],
      429: readErrorResponses[429],
    },
  },
);

const listInvoicesRoute = defineOpenAPIRoute(readMeta("billing.listInvoices"), {
  method: "get",
  path: "/api/v1/billing/invoices",
  description:
    "Lists invoices newest first, with each one's total, what has been applied to it, and what is still unpaid. The unpaid figure is derived from the per-matter balances rather than stored, so it can never drift from them.",
  request: { query: listQuery },
  responses: {
    200: {
      description: "A page of invoices",
      content: { "application/json": { schema: InvoiceListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const invoiceDetailRoute = defineOpenAPIRoute(readMeta("billing.invoiceDetail"), {
  method: "get",
  path: "/api/v1/billing/invoices/{invoiceId}",
  description:
    "Returns one invoice with its lines in presentation order and its balance per matter. A finalized invoice reads back entirely from its own rows — the letterhead, the client name, and every line's wording were copied at finalization, so it renders the same years later however much the underlying records have changed since.",
  request: { params: invoiceParam },
  responses: {
    200: {
      description: "The invoice",
      content: { "application/json": { schema: InvoiceDetailResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const unbilledRoute = defineOpenAPIRoute(readMeta("billing.matterUnbilled"), {
  method: "get",
  path: "/api/v1/billing/matters/{matterId}/unbilled",
  description:
    "What is still billable on one matter — the time and costs no draft holds and no invoice has billed — together with what the matter already owes across its finalized invoices.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The matter's unbilled work and its receivable",
      content: { "application/json": { schema: UnbilledResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const agingRoute = defineOpenAPIRoute(readMeta("billing.receivablesAging"), {
  method: "get",
  path: "/api/v1/billing/receivables/aging",
  description:
    "The firm's unpaid receivables bucketed by how far past due they are. Overdue is worked out at the moment you ask rather than stored, so a bill settled this morning is never reported as late.",
  request: { query: agingQuery },
  responses: {
    200: {
      description: "The aging buckets",
      content: { "application/json": { schema: AgingResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

// A refusal's HTTP status is a property of what the refusal MEANS, so the mapping lives in one place
// rather than at nine call sites that would drift.
function billingErrorResponse(
  c: Context,
  error: BillingValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (
    error.code === "unknown-invoice" ||
    error.code === "unknown-invoice-line" ||
    error.code === "unknown-invoice-claim"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (error.code === "invoice-not-draft" || error.code === "invoice-not-final") {
    return problemJson(c, {
      type: "billing-invoice-not-editable",
      title: "This invoice is no longer a working document",
      status: 409,
      detail: error.message,
    });
  }
  if (error.code === "work-in-progress-already-claimed") {
    return problemJson(c, {
      type: "billing-work-already-claimed",
      title: "Another draft already holds this work",
      status: 409,
      detail: error.message,
    });
  }
  // Not a permission failure and not a bad request: the firm has not told the platform where this
  // posting belongs, and inventing an account would put real money in the wrong place.
  if (error.code === "account-role-unmapped") {
    return problemJson(c, {
      type: "billing-account-role-unmapped",
      title: "A ledger account this posting needs has not been configured",
      status: 422,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "billing-refused",
    title: "The billing rules refuse this change",
    status: 422,
    detail: error.message,
  });
}

type BillingApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The commit's outcome, kept separate from the HTTP reply so each route can name its own success
// status literal — a PATCH answers 200 and a create answers 201, and a helper that returned both
// would widen every handler's type past what its route contract declares.
type BillingRefusal = ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422>;

type BillingOutcome<Body> =
  | { readonly kind: "refused"; readonly response: BillingRefusal }
  | { readonly kind: "committed"; readonly body: Body };

// How many times a lost number draw is retried before the request gives up. A draw loses when a
// concurrent finalize consumed the value it read; the loser's whole batch rolls back, including its
// in-batch counter increment, so the counter is advanced out of band and the next attempt renders
// the next number.
const MAXIMUM_FINALIZE_ATTEMPTS = 5;

// The firm's review gate, read once per finalize: it decides which lifecycle moves into `billed` are
// legal for the entries this invoice claimed. The rule itself lives in @magna-carta/billing-core, so
// time, costs, and billing all run on one state machine.
async function readApprovalRequired(database: SqlDatabase): Promise<boolean> {
  return (await readFirmSetting(database, approvalRequiredDefinition)) ?? false;
}

export function registerBillingRoutes(app: BillingApp, chokepoint: Chokepoint): void {
  // The shared idempotent commit: one batch carrying the business statements, the idempotency
  // record, and the outbox messages. Everything a billing mutation does commits together or not at
  // all — which for finalization is the whole point.
  async function runBillingEffect<Body>(
    c: Context,
    responseCode: 200 | 201,
    compose: (actor: UserId) => Promise<{ write: EffectWrite; body: Body }>,
  ): Promise<BillingOutcome<Body>> {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const now = () => new Date().toISOString();
    let result;
    try {
      result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const composed = await compose(userId);
          return {
            write: composed.write,
            responseCode,
            responseBody: canonicalJsonStringify(composed.body),
          };
        },
      });
    } catch (caught) {
      if (caught instanceof BillingValidationError) {
        return { kind: "refused", response: billingErrorResponse(c, caught) };
      }
      // The ledger refuses on its own terms too — a future or malformed issue date on a finalize
      // reaches validateEntry, not this package's rules. A different error class, so without this
      // arm it reaches the app error boundary and a member gets a 500 for a typo.
      if (caught instanceof LedgerValidationError) {
        return { kind: "refused", response: problemResponseForLedgerRefusal(c, caught) };
      }
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
      return { kind: "refused", response: problemResponseForIdempotencyConflict(c, result) };
    }
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return { kind: "committed", body: JSON.parse(result.responseBody ?? "{}") as Body };
  }

  // Wall-clock and randomness are ambient at the runtime edge and injected everywhere below it: the
  // domain package holds no clock, so this is where one is supplied.
  const clockOptions = () => ({
    clock: {
      now: () => new Date().toISOString(),
      today: () => new Date().toISOString().slice(0, 10),
    },
  });

  // POST /api/v1/billing/invoices — open a working document
  app.openapi(
    { ...createInvoiceRoute, middleware: chokepointMiddleware(chokepoint, createInvoiceRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof InvoiceAck>>(c, 201, (createdBy) => {
        const draft = createInvoiceDraft(
          firm.firmDatabase,
          {
            clientEntityId: request.clientEntityId,
            currency: request.currency,
            billingPeriodStart: request.billingPeriodStart ?? null,
            billingPeriodEnd: request.billingPeriodEnd ?? null,
            notes: request.notes ?? null,
            locationId: request.locationId ?? null,
            createdBy,
          },
          clockOptions(),
        );
        return Promise.resolve({
          write: draft.effect,
          body: { invoiceId: draft.invoiceId, status: "draft" as const },
        });
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/claims — pull work onto the draft
  app.openapi(
    { ...addClaimsRoute, middleware: chokepointMiddleware(chokepoint, addClaimsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof ClaimAck>>(c, 201, async () => {
        const claimed = await addClaimsToDraft(
          firm.firmDatabase,
          invoiceId,
          request.claims,
          clockOptions(),
        );
        return {
          write: claimed.effect,
          body: {
            invoiceId,
            claimIds: [...claimed.claimIds],
            lineIds: [...claimed.lineIds],
          },
        };
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/claims/{claimId}/release
  app.openapi(
    { ...releaseClaimRoute, middleware: chokepointMiddleware(chokepoint, releaseClaimRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId, claimId } = c.req.valid("param");
      const outcome = await runBillingEffect<z.infer<typeof InvoiceAck>>(c, 201, async () => ({
        write: await removeClaim(firm.firmDatabase, claimId, clockOptions()),
        body: { invoiceId, status: "draft" as const },
      }));
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // PATCH /api/v1/billing/invoices/{invoiceId}/lines/{lineId} — bill review
  app.openapi(
    { ...updateLineRoute, middleware: chokepointMiddleware(chokepoint, updateLineRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId, lineId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof InvoiceAck>>(c, 200, async () => ({
        write: await updateDraftLine(firm.firmDatabase, lineId, request),
        body: { invoiceId, status: "draft" as const },
      }));
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 200);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/void
  app.openapi(
    { ...voidDraftRoute, middleware: chokepointMiddleware(chokepoint, voidDraftRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof InvoiceAck>>(
        c,
        201,
        async (voidedBy) => ({
          write: await voidDraft(
            firm.firmDatabase,
            invoiceId,
            request.reason,
            voidedBy,
            clockOptions(),
          ),
          body: { invoiceId, status: "void" as const },
        }),
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/finalization — the one batch
  app.openapi(
    { ...finalizeRoute, middleware: chokepointMiddleware(chokepoint, finalizeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const approvalRequired = await readApprovalRequired(firm.firmDatabase);

      // The bounded retry wraps the WHOLE idempotent commit, not just the composition: a lost draw
      // rolls the batch back, so the retry has to re-read the counter and re-compose from scratch.
      let lastError: unknown;
      for (let attempt = 0; attempt < MAXIMUM_FINALIZE_ATTEMPTS; attempt += 1) {
        let outcome: BillingOutcome<z.infer<typeof FinalizeAck>>;
        try {
          outcome = await runBillingEffect<z.infer<typeof FinalizeAck>>(c, 201, async (actor) => {
            const finalized = await finalizeInvoice(
              firm.firmDatabase,
              {
                invoiceId,
                issueDate: request.issueDate,
                dueDate: request.dueDate,
                finalizedBy: actor,
                numberScopeKey: request.numberScopeKey,
                createNumberScope: request.createNumberScope ?? false,
                locationId: request.locationId ?? null,
                letterheadAddressBlock: request.letterheadAddressBlock ?? null,
                letterheadFooter: request.letterheadFooter ?? null,
                remitTo: request.remitTo ?? null,
                clientBillingName: request.clientBillingName ?? null,
              },
              { ...clockOptions(), approvalRequired },
            );
            return {
              write: finalized.effect,
              body: {
                invoiceId,
                invoiceNumber: finalized.invoiceNumber,
                totalMinor: finalized.totalMinor,
                currency: "USD",
                ledgerEntryId: finalized.ledgerEntryId,
              },
            };
          });
        } catch (caught) {
          if (!isNumberAllocationConflict(caught, INVOICE_NUMBERING_TABLES)) throw caught;
          lastError = caught;
          continue;
        }
        if (outcome.kind === "refused") return outcome.response;
        return c.json(outcome.body, 201);
      }
      throw new Error(
        `invoice number allocation did not converge after ${MAXIMUM_FINALIZE_ATTEMPTS} attempts: ${String(lastError)}`,
      );
    },
  );

  // PUT /api/v1/billing/account-roles — the chart-of-accounts seam
  app.openapi(
    { ...setAccountRolesRoute, middleware: chokepointMiddleware(chokepoint, setAccountRolesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof AccountRoleMapResponse>>(c, 200, () => {
        const assignments = request.assignments.filter((assignment) =>
          isAccountRole(assignment.role),
        );
        return Promise.resolve({
          write: composeAccountRoleConfiguration(firm.firmDatabase, assignments, clockOptions()),
          body: { assignments },
        });
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 200);
    },
  );

  app.openapi(
    { ...accountRolesRoute, middleware: chokepointMiddleware(chokepoint, accountRolesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const map = await readAccountRoleMap(firm.firmDatabase);
      return c.json(
        {
          assignments: [...map].map(([role, ledgerAccountId]) => ({ role, ledgerAccountId })),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...listInvoicesRoute, middleware: chokepointMiddleware(chokepoint, listInvoicesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const page = await listInvoices(firm.firmDatabase, query);
      return c.json({ data: page.data, nextCursor: page.nextCursor } as never, 200);
    },
  );

  app.openapi(
    { ...invoiceDetailRoute, middleware: chokepointMiddleware(chokepoint, invoiceDetailRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const detail = await readInvoiceDetail(firm.firmDatabase, invoiceId);
      if (!detail) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: `no such invoice: ${invoiceId}`,
        });
      }
      return c.json(detail as never, 200);
    },
  );

  app.openapi(
    { ...unbilledRoute, middleware: chokepointMiddleware(chokepoint, unbilledRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const unbilled = await readUnbilledWorkInProgress(firm.firmDatabase, matterId);
      const receivable = await readMatterReceivable(firm.firmDatabase, matterId);
      return c.json(
        {
          ...unbilled,
          receivableTotalMinor: receivable.totalMinor,
          receivableAppliedMinor: receivable.appliedMinor,
          receivableUnpaidMinor: receivable.unpaidMinor,
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...agingRoute, middleware: chokepointMiddleware(chokepoint, agingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { asOfDate } = c.req.valid("query");
      const resolvedAsOfDate = asOfDate ?? new Date().toISOString().slice(0, 10);
      const buckets = await readAccountsReceivableAging(firm.firmDatabase, resolvedAsOfDate);
      return c.json({ asOfDate: resolvedAsOfDate, buckets } as never, 200);
    },
  );
}
