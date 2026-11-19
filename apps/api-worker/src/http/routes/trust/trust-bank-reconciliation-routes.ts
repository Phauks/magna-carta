import { z } from "@hono/zod-openapi";
import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  BankReconciliationAcknowledgement,
  BankReconciliationDetailResponse,
  BankReconciliationEditsRequest,
  BankReconciliationFileRequest,
  BankReconciliationInterestRequest,
  BankReconciliationListResponse,
  BankReconciliationNoteRequest,
  BankReconciliationRestoreRequest,
  BankReconciliationRevertRequest,
  BankReconciliationSaveRequest,
  StartBankReconciliationRequest,
  StartBankReconciliationResponse,
} from "@magna-carta/trust/bank-reconciliation-contract";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The bank reconciliation API's route definitions: paths, permissions, request and response
// shapes. The handlers that compose, commit and answer are in trust-bank-reconciliation.ts, which
// registers these through the chokepoint.

/** Where a period's files live in the firm's bucket, under its id. */
export const FILE_PREFIX = "trust-reconciliation-file/";

export const READ = "trust:read" as const;
export const MANAGE = "trust:manage" as const;

export const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

export const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the capability"),
  404: problem("The trust account, reconciliation or file is unknown"),
  409: problem(
    "The reconciliation changed or finished, or the Idempotency-Key is still in progress",
  ),
  422: problem("The trust rules refuse this"),
  429: problem("Rate limit exceeded"),
} as const;

export function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: true,
    // A retried tick would land twice in History.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

export function readMeta(operationId: string): RouteMeta {
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

export const options = () => ({
  clock: { now: () => new Date().toISOString(), today: () => todayInUtc() },
});

export const trustAccountQuery = z.object({ trustAccountId: identifierField("trustAccount") });
export const reconciliationParam = z.object({
  reconciliationId: identifierPathParam("trustBankReconciliation", "reconciliationId"),
});
export const interestParam = reconciliationParam.extend({
  interestId: identifierPathParam("trustBankReconciliationInterest", "interestId"),
});
export const fileParam = reconciliationParam.extend({
  fileId: identifierPathParam("trustBankReconciliationFile", "fileId"),
});

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
export const body = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true,
});

export const acknowledged = json(BankReconciliationAcknowledgement, "Saved");

export const listRoute = defineOpenAPIRoute(readMeta("trust.listBankReconciliations"), {
  method: "get",
  path: "/api/v1/trust/bank-reconciliations",
  description:
    "Every reconciliation on the account, newest first, with its figures, and where the next one starts.",
  request: { query: trustAccountQuery },
  responses: {
    200: json(BankReconciliationListResponse, "The reconciliations"),
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const startRoute = defineOpenAPIRoute(writeMeta("trust.startBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations",
  description:
    "Starts a reconciliation. The first one on an account takes its start date and balance from the statement; after that they carry over from the last finished one. One may be in progress per account.",
  request: { headers: idempotencyKeyHeader, body: body(StartBankReconciliationRequest) },
  responses: {
    201: json(StartBankReconciliationResponse, "Started"),
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const getRoute = defineOpenAPIRoute(readMeta("trust.getBankReconciliation"), {
  method: "get",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}",
  description:
    "One reconciliation: its book items with what is ticked, the figures, IOLTA interest, notes, files, History and restore points.",
  request: { params: reconciliationParam },
  responses: {
    200: json(BankReconciliationDetailResponse, "The reconciliation"),
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const editsRoute = defineOpenAPIRoute(writeMeta("trust.editBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/changes",
  description: "Ticks or unticks lines, or changes the end date or end balance, in order.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationEditsRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const revertRoute = defineOpenAPIRoute(writeMeta("trust.revertBankReconciliationChange"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/revert",
  description:
    "Undo or Redo the caller's own last change, or undo any one change from History. Each writes a new change; nothing is erased.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationRevertRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const saveRoute = defineOpenAPIRoute(writeMeta("trust.saveBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/restore-points",
  description: "Save: a named restore point at the latest change.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationSaveRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const restoreRoute = defineOpenAPIRoute(writeMeta("trust.restoreBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/restore",
  description:
    "Puts the ticks, end date and end balance back as they were at a restore point, saving the current place first. Notes and files are kept.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationRestoreRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const interestRoute = defineOpenAPIRoute(writeMeta("trust.addBankReconciliationInterest"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/interest",
  description:
    "Adds IOLTA interest the bank credited, or its sweep to the bar foundation, ticked. It belongs to no matter and never touches a client ledger.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationInterestRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const interestRemovalRoute = defineOpenAPIRoute(
  writeMeta("trust.removeBankReconciliationInterest"),
  {
    method: "post",
    path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/interest/{interestId}/removal",
    description: "Removes an IOLTA interest line added by mistake.",
    request: { headers: idempotencyKeyHeader, params: interestParam },
    responses: {
      201: acknowledged,
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      422: errors[422],
      429: errors[429],
    },
  },
);

export const noteRoute = defineOpenAPIRoute(writeMeta("trust.addBankReconciliationNote"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/notes",
  description:
    "Adds a note to a line, or marks it Needs review or resolved. Notes are never undone, and may be added after the reconciliation is finished.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationNoteRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const fileRoute = defineOpenAPIRoute(writeMeta("trust.attachBankReconciliationFile"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/files",
  description:
    "Keeps a file with the reconciliation: the bank statement, a deposit slip. PDF, PNG or JPEG, up to 25 MB.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationFileRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const fileRemovalRoute = defineOpenAPIRoute(
  writeMeta("trust.removeBankReconciliationFile"),
  {
    method: "post",
    path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/files/{fileId}/removal",
    description:
      "Takes a file off an in-progress reconciliation. The bytes are kept, as trust records are.",
    request: { headers: idempotencyKeyHeader, params: fileParam },
    responses: {
      201: acknowledged,
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      422: errors[422],
      429: errors[429],
    },
  },
);

export const fileReadRoute = defineOpenAPIRoute(readMeta("trust.bankReconciliationFile"), {
  method: "get",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/files/{fileId}",
  description: "A file kept with the reconciliation, as it was attached.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The file",
      content: {
        "application/pdf": { schema: z.string() },
        "image/png": { schema: z.string() },
        "image/jpeg": { schema: z.string() },
      },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export const finishRoute = defineOpenAPIRoute(writeMeta("trust.finishBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/finish",
  description:
    "Finishes the reconciliation: freezes its figures and the items it cleared. A difference is allowed and recorded as it stands. Refused if anyone changed it since it was last read.",
  request: { headers: idempotencyKeyHeader, params: reconciliationParam },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});
