import { CIVIL_DATE_PATTERN, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type {
  LedgerEntryId,
  TrustAccountId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  UserId,
} from "@magna-carta/identifiers/types";
import { isValidCalendarDate, LedgerValidationError } from "@magna-carta/ledger/validate";
import { currencyFromCode, money } from "@magna-carta/money/money";
import {
  composeTrustBankStatement,
  readTrustBankStatementLines,
  readTrustBankStatements,
} from "@magna-carta/trust/bank-statements";
import {
  composeTrustReconciliationMatch,
  composeTrustReconciliationUnmatch,
  readTrustMatchSuggestions,
} from "@magna-carta/trust/matching";
import {
  closeTrustReconciliation,
  openTrustReconciliation,
  readTrustReconciliations,
  readTrustThreeWayProof,
} from "@magna-carta/trust/reconciliation";
import {
  confirmTrustStatementImport,
  previewTrustStatementImport,
} from "@magna-carta/trust/statement-import";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { problemResponseForLedgerRefusal } from "../../ledger-refusal-problems.ts";

// The three-way reconciliation surface: recording what the bank said, tying its lines to what the
// firm recorded, and freezing the proof.
//
// Two things about this module are worth reading before changing it. FIRST, no endpoint here matches
// anything: the suggestions endpoint returns candidates and their reasons, and a match exists only
// because a member posted one naming both ends. SECOND, the close endpoint records a proof that did
// not balance exactly as readily as one that did — an unbalanced period is not an error condition
// here and must never become one, because a firm that cannot record a problem simply does not record
// the period.
//
// This module composes and commits; it decides nothing. The rules live one layer down in
// @magna-carta/trust and one layer below that in the migration's triggers, which are what actually
// refuse a match against a closed reconciliation or a line from another statement.

const READ = "trust:read" as const;
const MANAGE = "trust:manage" as const;

// A real calendar date, not a shape. A bare regex accepts 2026-02-31, which is stored (the period
// bounds are compared lexically), then parses to NaN in the match scorer, is offered no candidate,
// and sits unmatched forever with nothing saying why.
const civilDate = z
  .string()
  .regex(CIVIL_DATE_PATTERN)
  .refine(isValidCalendarDate, { message: "not a calendar date" });
const LineDirection = z.enum(["deposit", "withdrawal"]);

const StatementLine = z
  .object({
    postedOn: civilDate,
    direction: LineDirection,
    amountMinor: z.number().int().positive(),
    description: z.string().min(1),
    reference: z.string().min(1).nullable().optional(),
    counterpartyName: z.string().min(1).nullable().optional(),
  })
  .openapi("TrustBankStatementLineInput");

const RecordStatementRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    periodStart: civilDate,
    periodEnd: civilDate,
    // Signed, both of them. A trust bank account can be overdrawn by an item the firm never
    // recorded, and a contract that refused to carry that figure would refuse to carry the exact
    // condition this whole surface exists to surface.
    openingBalanceMinor: z.number().int(),
    closingBalanceMinor: z.number().int(),
    currency: z.literal("USD"),
    statementReference: z.string().min(1).nullable().optional(),
    supersedesStatementId: identifierField("trustBankStatement").nullable().optional(),
    lines: z.array(StatementLine).min(1),
  })
  .openapi("TrustRecordBankStatementRequest");

const StatementRecord = z
  .object({
    id: z.string(),
    trustAccountId: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
    openingBalanceMinor: z.number().int(),
    closingBalanceMinor: z.number().int(),
    currency: z.string(),
    statementReference: z.string().nullable(),
    source: z.enum(["entered", "imported"]),
    supersedesStatementId: z.string().nullable(),
    recordedBy: z.string(),
    recordedAt: z.string(),
  })
  .openapi("TrustBankStatementRecord");

const StatementsResponse = z
  .object({ statements: z.array(StatementRecord) })
  .openapi("TrustBankStatementsResponse");

const StatementLineRecord = z
  .object({
    id: z.string(),
    postedOn: z.string(),
    direction: LineDirection,
    amountMinor: z.number().int(),
    description: z.string(),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
    // Which row of the imported file this line came from, and null on a line a member typed.
    sourceRowNumber: z.number().int().nullable(),
  })
  .openapi("TrustBankStatementLineRecord");

const StatementLinesResponse = z
  .object({ lines: z.array(StatementLineRecord) })
  .openapi("TrustBankStatementLinesResponse");

const StatementAck = z
  .object({ trustBankStatementId: z.string(), linesRecorded: z.number().int() })
  .openapi("TrustBankStatementAck");

const DateFormat = z.enum(["iso", "month-day-year", "day-month-year"]);

// A statement file records at most MAX_TRUST_BANK_STATEMENT_LINES rows, and a statement that size
// is well under a megabyte of CSV. The cap is on the REQUEST rather than only on the row count
// because the parser reads the whole body character by character before any row ceiling can apply:
// without it a 40 MB file is fully parsed and mapped on the request path and only then refused for
// having too many rows, which costs as much as accepting it would have.
const MAX_STATEMENT_FILE_CHARACTERS = 2_000_000;

const ImportPreviewRequest = z
  .object({
    fileText: z.string().min(1).max(MAX_STATEMENT_FILE_CHARACTERS),
    // Stated, never detected: 03/04/2026 is two different days on two sides of an ocean, and a
    // reconciliation built on the wrong one is wrong in a way nobody notices.
    dateFormat: DateFormat.optional(),
    currency: z.literal("USD"),
  })
  .openapi("TrustStatementImportPreviewRequest");

const ImportPreviewRow = z
  .object({
    rowNumber: z.number().int(),
    postedOn: z.string(),
    direction: LineDirection,
    amountMinor: z.number().int(),
    description: z.string(),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
  })
  .openapi("TrustStatementImportPreviewRow");

const ImportPreviewRejection = z
  .object({ rowNumber: z.number().int(), reason: z.string() })
  .openapi("TrustStatementImportRejection");

const ImportPreviewResponse = z
  .object({
    columnMapping: z.record(z.string(), z.string()),
    rows: z.array(ImportPreviewRow),
    rejections: z.array(ImportPreviewRejection),
    depositTotalMinor: z.number().int(),
    withdrawalTotalMinor: z.number().int(),
    earliestPostedOn: z.string().nullable(),
    latestPostedOn: z.string().nullable(),
    // Quote this back when importing. A different file produces a different value and the import is
    // refused, so what is stored is always the file that was reviewed.
    fingerprint: z.string(),
  })
  .openapi("TrustStatementImportPreviewResponse");

const ImportRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    periodStart: civilDate,
    periodEnd: civilDate,
    openingBalanceMinor: z.number().int(),
    closingBalanceMinor: z.number().int(),
    currency: z.literal("USD"),
    statementReference: z.string().min(1).nullable().optional(),
    supersedesStatementId: identifierField("trustBankStatement").nullable().optional(),
    fileText: z.string().min(1).max(MAX_STATEMENT_FILE_CHARACTERS),
    dateFormat: DateFormat.optional(),
    confirmedFingerprint: z.string().min(1),
  })
  .openapi("TrustStatementImportRequest");

const ImportReport = z
  .object({
    trustBankStatementId: z.string(),
    linesRecorded: z.number().int(),
    rowsRejected: z.number().int(),
    depositTotalMinor: z.number().int(),
    withdrawalTotalMinor: z.number().int(),
  })
  .openapi("TrustStatementImportReport");

const OpenReconciliationRequest = z
  .object({
    statementId: identifierField("trustBankStatement"),
    supersedesReconciliationId: identifierField("trustReconciliation").nullable().optional(),
    note: z.string().min(1).nullable().optional(),
  })
  .openapi("TrustOpenReconciliationRequest");

// The shape, unregistered, and the named component built from it. A registered schema wrapped in
// `.nullable()` emits as a SECOND shape under the same component name, which the contract's
// component-collision rule refuses — so the nullable place uses the raw shape and only the
// non-nullable place carries the name.
const frozenProofShape = z.object({
  statementClosingMinor: z.number().int(),
  outstandingDepositsMinor: z.number().int(),
  outstandingDisbursementsMinor: z.number().int(),
  adjustedBankMinor: z.number().int(),
  bookBalanceMinor: z.number().int(),
  clientLedgerTotalMinor: z.number().int(),
  unmatchedLineCount: z.number().int(),
  unmatchedItemCount: z.number().int(),
  balanced: z.boolean(),
});

const FrozenProof = frozenProofShape.openapi("TrustFrozenProof");

const ReconciliationRecord = z
  .object({
    id: z.string(),
    trustAccountId: z.string(),
    statementId: z.string(),
    status: z.enum(["open", "closed"]),
    openedBy: z.string(),
    openedAt: z.string(),
    closedBy: z.string().nullable(),
    closedAt: z.string().nullable(),
    // What the proof said when somebody attested to it. Null while the reconciliation is open; once
    // present it never changes, and it is what the firm attested to rather than what is true now.
    frozenProof: frozenProofShape.nullable(),
    supersedesReconciliationId: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi("TrustReconciliationRecord");

const ReconciliationsResponse = z
  .object({ reconciliations: z.array(ReconciliationRecord) })
  .openapi("TrustReconciliationsResponse");

const BankItem = z
  .object({
    // The book side is a LEDGER ENTRY, not a movement: an earned-fee transfer out of trust records
    // no movement row at all, and an outstanding list built from movements would never show one.
    ledgerEntryId: z.string(),
    effectiveDate: z.string(),
    description: z.string(),
    // Signed from the account holder's side: positive put money into the bank account.
    bankDeltaMinor: z.number().int(),
    trustMovementId: z.string().nullable(),
    movementKind: z.enum(["deposit", "disbursement", "matter_transfer"]).nullable(),
    trustTransferId: z.string().nullable(),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
  })
  .openapi("TrustBankItem");

const Disagreement = z
  .object({
    leg: z.enum(["bank-to-book", "book-to-client"]),
    // The first named side minus the second, so the sign says which way it is out.
    differenceMinor: z.number().int(),
  })
  .openapi("TrustReconciliationDisagreement");

const ThreeWayProof = z
  .object({
    trustAccountId: z.string(),
    statementId: z.string(),
    asOfDate: z.string(),
    currency: z.string(),
    statementClosingMinor: z.number().int(),
    outstandingDeposits: z.array(BankItem),
    outstandingDepositsMinor: z.number().int(),
    outstandingDisbursements: z.array(BankItem),
    outstandingDisbursementsMinor: z.number().int(),
    adjustedBankMinor: z.number().int(),
    bookBalanceMinor: z.number().int(),
    clientLedgerTotalMinor: z.number().int(),
    unmatchedStatementLines: z.array(StatementLineRecord),
    balanced: z.boolean(),
    // Empty when the three legs agree. Otherwise it names WHICH comparison failed and by how much,
    // which is the difference between a firm knowing where to look and a firm knowing only that
    // something is wrong.
    disagreements: z.array(Disagreement),
  })
  .openapi("TrustThreeWayProof");

const ReconciliationDetail = z
  .object({ reconciliation: ReconciliationRecord, proof: ThreeWayProof })
  .openapi("TrustReconciliationDetail");

const MatchSuggestion = z
  .object({
    statementLineId: z.string(),
    ledgerEntryId: z.string(),
    // Facts a person can check against the two rows in front of them. There is no score: a
    // suggestion nobody can audit is one that gets confirmed without being read.
    signals: z.array(
      z.enum([
        "amount-equal",
        "same-day",
        "within-window",
        "reference-equal",
        "counterparty-similar",
      ]),
    ),
    dayGap: z.number().int(),
  })
  .openapi("TrustMatchSuggestion");

const SuggestionsResponse = z
  .object({
    unmatchedLines: z.array(StatementLineRecord),
    outstandingItems: z.array(BankItem),
    suggestions: z.array(MatchSuggestion),
  })
  .openapi("TrustMatchSuggestionsResponse");

const RecordMatchRequest = z
  .object({
    statementLineId: identifierField("trustBankStatementLine"),
    ledgerEntryId: identifierField("ledgerEntry"),
  })
  .openapi("TrustRecordMatchRequest");

const MatchAck = z
  .object({ trustReconciliationMatchId: z.string() })
  .openapi("TrustReconciliationMatchAck");

const ReconciliationAck = z
  .object({ trustReconciliationId: z.string() })
  .openapi("TrustReconciliationAck");

const CloseAck = z
  .object({
    trustReconciliationId: z.string(),
    frozenProof: FrozenProof,
    proof: ThreeWayProof,
  })
  .openapi("TrustReconciliationCloseAck");

const trustAccountQuery = z.object({ trustAccountId: identifierField("trustAccount") });
const statementParam = z.object({
  statementId: identifierPathParam("trustBankStatement", "statementId"),
});
const reconciliationParam = z.object({
  reconciliationId: identifierPathParam("trustReconciliation", "reconciliationId"),
});
const matchParam = z.object({
  reconciliationId: identifierPathParam("trustReconciliation", "reconciliationId"),
  matchId: identifierPathParam("trustReconciliationMatch", "matchId"),
});

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
    description:
      "The firm is unreachable, the member is deactivated, or the trust account, statement, reconciliation, or match is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the reconciliation is already closed, or the statement line or ledger entry is already matched",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, the statement or match the trust rules describe is refused, or the imported file no longer matches the one that was reviewed",
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

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    // A trust account belongs to an office and its statements span every matter it holds money for,
    // so the capability is firm-scoped exactly as the movement routes' is.
    resource: "firm",
    audited: true,
    // A retried request that recorded a statement or a match twice would put the firm's own proof
    // out by whatever it duplicated.
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

const recordStatementRoute = defineOpenAPIRoute(writeMeta("trust.recordBankStatement"), {
  method: "post",
  path: "/api/v1/trust/bank-statements",
  description:
    "Records one period of a trust bank account as the institution reported it, with its lines, in one atomic write. This is the only external input the trust subsystem has: an item the firm never recorded — a bank fee, a returned deposit, a forged check — exists nowhere in the platform until it arrives here. Balances are signed, because a trust bank account really can be overdrawn. A statement is never edited; a bank that reissues a period is recorded as a new statement naming the one it supersedes.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: RecordStatementRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The statement and its lines were recorded",
      content: { "application/json": { schema: StatementAck } },
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

const listStatementsRoute = defineOpenAPIRoute(readMeta("trust.listBankStatements"), {
  method: "get",
  path: "/api/v1/trust/bank-statements",
  description:
    "Lists the bank statements recorded for one trust account, most recent period first — what a member picks from when starting a reconciliation.",
  request: { query: trustAccountQuery },
  responses: {
    200: {
      description: "The recorded statements",
      content: { "application/json": { schema: StatementsResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const statementLinesRoute = defineOpenAPIRoute(readMeta("trust.bankStatementLines"), {
  method: "get",
  path: "/api/v1/trust/bank-statements/{statementId}/lines",
  description: "Returns one statement's lines in the order the bank posted them.",
  request: { params: statementParam },
  responses: {
    200: {
      description: "The statement's lines",
      content: { "application/json": { schema: StatementLinesResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

// The one route here that is a POST because a file rides its body rather than because it writes
// anything. It carries a required Idempotency-Key all the same: the idempotency gate binds to the
// METHOD across a money subsystem rather than to whether a particular handler happens to write, and
// paying one header on a preview is cheaper than an exception nobody would remember the reason for.
const previewImportRoute = defineOpenAPIRoute(
  {
    ...writeMeta("trust.previewStatementImport"),
    // Nothing is stored, so there is no state change to audit — the import route beside it is the
    // audited one.
    audited: false,
  },
  {
    method: "post",
    path: "/api/v1/trust/bank-statements/import/preview",
    description:
      "Reads a statement file the firm exported from its bank and reports what is in it: the column mapping it resolved, every row it could read and what each would become, every row it could not and why, and the totals. NOTHING IS STORED — running this is not a decision to import anything, and the report is often the reason to decide. The date convention is stated by the caller and never detected: a date this endpoint cannot read is a reported row, never a date reinterpreted under another convention.",
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: ImportPreviewRequest } }, required: true },
    },
    responses: {
      200: {
        description: "What the file contains",
        content: { "application/json": { schema: ImportPreviewResponse } },
      },
      400: errorResponses[400],
      401: readErrorResponses[401],
      403: readErrorResponses[403],
      404: readErrorResponses[404],
      422: readErrorResponses[422],
      429: readErrorResponses[429],
    },
  },
);

const importStatementRoute = defineOpenAPIRoute(writeMeta("trust.importBankStatement"), {
  method: "post",
  path: "/api/v1/trust/bank-statements/import",
  description:
    "Records a statement from a file that was previewed and confirmed. The file is re-read here rather than taken from the preview, and the fingerprint the preview returned must still match it — so a file that changed between being reviewed and being agreed to is refused rather than stored. The response reports what was actually recorded, including how many rows could not be read.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: ImportRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The statement was recorded from the confirmed file",
      content: { "application/json": { schema: ImportReport } },
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

const openReconciliationRoute = defineOpenAPIRoute(writeMeta("trust.openReconciliation"), {
  method: "post",
  path: "/api/v1/trust/reconciliations",
  description:
    "Opens a reconciliation of one recorded bank statement. The trust account is taken from the statement rather than from the caller, so a reconciliation about one account's statement and another account's ledger is not expressible.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: OpenReconciliationRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The reconciliation is open",
      content: {
        "application/json": { schema: ReconciliationAck },
      },
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

const listReconciliationsRoute = defineOpenAPIRoute(readMeta("trust.listReconciliations"), {
  method: "get",
  path: "/api/v1/trust/reconciliations",
  description:
    "Lists the reconciliations recorded for one trust account, most recently opened first. A closed one carries the proof it froze, which is what the firm attested to for that period rather than what is true now.",
  request: { query: trustAccountQuery },
  responses: {
    200: {
      description: "The reconciliations",
      content: { "application/json": { schema: ReconciliationsResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const reconciliationDetailRoute = defineOpenAPIRoute(readMeta("trust.getReconciliation"), {
  method: "get",
  path: "/api/v1/trust/reconciliations/{reconciliationId}",
  description:
    "Returns one reconciliation and its three-way proof as it stands NOW: the statement's closing balance adjusted for items the firm recorded that have not reached the bank, the trust bank account's book balance, and the sum of the client ledgers — each as of the statement's period end. When the three do not agree it names which leg is out and by how much; it never forces them into agreement. A closed reconciliation also carries the proof it froze, and the two may differ, which is the ledger having moved since somebody attested to the period.",
  request: { params: reconciliationParam },
  responses: {
    200: {
      description: "The reconciliation and its live proof",
      content: { "application/json": { schema: ReconciliationDetail } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const suggestionsRoute = defineOpenAPIRoute(readMeta("trust.reconciliationSuggestions"), {
  method: "get",
  path: "/api/v1/trust/reconciliations/{reconciliationId}/suggestions",
  description:
    "Returns the statement lines this reconciliation has not accounted for, the recorded items it has not accounted for, and the candidate pairings between them with the reasons each is a candidate. NOTHING IS MATCHED BY THIS ENDPOINT, and nothing in the platform matches on its own: a wrong automatic match makes the totals tie out while the ledger and the bank disagree about which events happened, which is the discrepancy a reconciliation exists to find.",
  request: { params: reconciliationParam },
  responses: {
    200: {
      description: "What is unaccounted for, and what might pair with what",
      content: { "application/json": { schema: SuggestionsResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const recordMatchRoute = defineOpenAPIRoute(writeMeta("trust.recordReconciliationMatch"), {
  method: "post",
  path: "/api/v1/trust/reconciliations/{reconciliationId}/matches",
  description:
    "Records a member's assertion that one statement line and one recorded ledger entry are the same event. Both ends are named by the caller. The book side is a ledger entry rather than a trust movement because an earned-fee transfer out of trust posts a bank-affecting entry and no movement record, and an item that could never be matched would sit outstanding forever.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: { content: { "application/json": { schema: RecordMatchRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The match was recorded",
      content: { "application/json": { schema: MatchAck } },
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

const withdrawMatchRoute = defineOpenAPIRoute(writeMeta("trust.withdrawReconciliationMatch"), {
  method: "post",
  path: "/api/v1/trust/reconciliations/{reconciliationId}/matches/{matchId}/withdrawal",
  description:
    "Takes back a match a member recorded. Appended rather than deleted — that somebody asserted the pairing and then took it back stays on the record — and the item becomes outstanding again.",
  request: {
    headers: idempotencyKeyHeader,
    params: matchParam,
  },
  responses: {
    201: {
      description: "The withdrawal was recorded",
      content: { "application/json": { schema: MatchAck } },
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

const closeReconciliationRoute = defineOpenAPIRoute(writeMeta("trust.closeReconciliation"), {
  method: "post",
  path: "/api/v1/trust/reconciliations/{reconciliationId}/close",
  description:
    "Closes a reconciliation and freezes what its proof said at that moment. Nothing else is written: no ledger entry, no movement, no correction to anything the proof disagreed with. A period that did NOT balance closes exactly as readily as one that did, recording that it did not tie out and by how much — a record of a problem is the point, and the frozen figures never change afterwards even if a backdated entry moves the live proof.",
  request: { headers: idempotencyKeyHeader, params: reconciliationParam },
  responses: {
    201: {
      description: "The reconciliation is closed and its proof frozen",
      content: { "application/json": { schema: CloseAck } },
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

// A refusal's HTTP status is a property of what the refusal MEANS, so the mapping lives in one place
// rather than at nine call sites that would drift.
function reconciliationErrorResponse(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (
    error.code === "unknown-trust-account" ||
    error.code === "unknown-trust-bank-statement" ||
    error.code === "unknown-trust-bank-statement-line" ||
    error.code === "unknown-trust-reconciliation" ||
    error.code === "unknown-trust-reconciliation-match"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (error.code === "reconciliation-closed") {
    return problemJson(c, {
      type: "trust-reconciliation-closed",
      title: "This reconciliation is closed",
      status: 409,
      detail: error.message,
    });
  }
  if (
    error.code === "statement-line-already-matched" ||
    error.code === "ledger-entry-already-matched" ||
    error.code === "match-already-withdrawn" ||
    error.code === "statement-already-superseded"
  ) {
    return problemJson(c, {
      type: "trust-reconciliation-already-accounted-for",
      title: "That has already been accounted for",
      status: 409,
      detail: error.message,
    });
  }
  if (
    error.code === "statement-import-columns-unrecognized" ||
    error.code === "statement-import-preview-mismatch" ||
    error.code === "statement-import-nothing-to-record"
  ) {
    return problemJson(c, {
      type: "trust-statement-import-refused",
      title: "This file cannot be imported as it stands",
      status: 422,
      detail: error.message,
    });
  }
  // Everything else the trust rules refuse about a statement, a match, or a reconciliation on their
  // own terms: a line outside its period, a currency the account does not hold, a statement with no
  // lines, an entry that is not an outstanding item on this account.
  return readReconciliationErrorResponse(c, error);
}

// The refusals a READ can actually raise: an unknown handle, and the trust rules' own. It is spelled
// out separately rather than routed through the write-path mapping because the read routes declare no
// 409 and could not honestly return one — a helper that could produce a status its own contract does
// not carry is a document that lies about the surface.
function readReconciliationErrorResponse(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (
    error.code === "unknown-trust-account" ||
    error.code === "unknown-trust-bank-statement" ||
    error.code === "unknown-trust-bank-statement-line" ||
    error.code === "unknown-trust-reconciliation" ||
    error.code === "unknown-trust-reconciliation-match"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (
    error.code === "statement-import-columns-unrecognized" ||
    error.code === "statement-import-preview-mismatch" ||
    error.code === "statement-import-nothing-to-record"
  ) {
    return problemJson(c, {
      type: "trust-statement-import-refused",
      title: "This file cannot be imported as it stands",
      status: 422,
      detail: error.message,
    });
  }
  // Both of the reconciliation's capped reads, under one type. Neither says the record is improper —
  // they say the period is larger than one proof can see all of, and a proof computed from a list
  // that stopped at its ceiling is short by exactly the items nobody saw. Falling through to the
  // catch-all below would tell a firm the trust rules refuse its reconciliation, which is the one
  // reading of the situation that is not true.
  if (
    error.code === "reconciliation-outstanding-items-truncated" ||
    error.code === "reconciliation-unmatched-lines-truncated"
  ) {
    return problemJson(c, {
      type: "trust-reconciliation-truncated",
      title: "This reconciliation is larger than one proof can account for",
      status: 422,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "trust-reconciliation-refused",
    title: "The trust rules refuse this",
    status: 422,
    detail: error.message,
  });
}

type ReconciliationApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The trust package reads no wall clock of its own, so every composer takes one. Built per request
// rather than once at module scope so a long-lived isolate cannot freeze "now".
const trustOptions = () => ({
  clock: {
    now: () => new Date().toISOString(),
    today: () => todayInUtc(),
  },
});

export function registerTrustReconciliationRoutes(
  app: ReconciliationApp,
  chokepoint: Chokepoint,
): void {
  async function commitWrite<Body>(
    c: Context,
    compose: (actor: UserId) => Promise<{ write: EffectWrite; body: Body }>,
  ) {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    let result;
    try {
      result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now: () => new Date().toISOString(),
        effect: async () => {
          const composed = await compose(userId);
          return {
            write: composed.write,
            responseCode: 201,
            responseBody: canonicalJsonStringify(composed.body),
          };
        },
      });
    } catch (caught) {
      if (caught instanceof TrustValidationError) return reconciliationErrorResponse(c, caught);
      // The ledger refuses on its own terms too, and its refusals are ordinary bad input here — a
      // date that is not a date, an entry that does not balance. A different error class from the
      // trust package's, so without this arm they reach the app error boundary as a 500.
      if (caught instanceof LedgerValidationError)
        return problemResponseForLedgerRefusal(c, caught);
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
      return problemResponseForIdempotencyConflict(c, result);
    }
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json(JSON.parse(result.responseBody ?? "{}") as Body, 201);
  }

  // A read's only refusals are unknown handles and the trust rules' own, and its 404 is the same
  // 404 the write path produces — but a read declares no 409, so it maps through the narrower
  // function rather than the write path's.
  async function readOrProblem<Body>(c: Context, read: () => Promise<Body>) {
    try {
      return c.json(await read(), 200);
    } catch (caught) {
      if (caught instanceof TrustValidationError) return readReconciliationErrorResponse(c, caught);
      throw caught;
    }
  }

  // POST /api/v1/trust/bank-statements — what the bank said
  app.openapi(
    { ...recordStatementRoute, middleware: chokepointMiddleware(chokepoint, recordStatementRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const currency = currencyFromCode(request.currency);
      return commitWrite<z.infer<typeof StatementAck>>(c, async (recordedBy) => {
        const composed = await composeTrustBankStatement(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId,
            periodStart: request.periodStart,
            periodEnd: request.periodEnd,
            openingBalance: money(request.openingBalanceMinor, currency),
            closingBalance: money(request.closingBalanceMinor, currency),
            statementReference: request.statementReference ?? null,
            source: "entered",
            supersedesStatementId: request.supersedesStatementId ?? null,
            lines: request.lines.map((line) => ({
              postedOn: line.postedOn,
              direction: line.direction,
              amount: money(line.amountMinor, currency),
              description: line.description,
              reference: line.reference ?? null,
              counterpartyName: line.counterpartyName ?? null,
            })),
            recordedBy,
          },
          trustOptions(),
        );
        return {
          write: composed.effect,
          body: {
            trustBankStatementId: composed.statementId,
            linesRecorded: composed.lineIds.length,
          },
        };
      });
    },
  );

  // GET /api/v1/trust/bank-statements — the statements on one account
  app.openapi(
    { ...listStatementsRoute, middleware: chokepointMiddleware(chokepoint, listStatementsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId } = c.req.valid("query");
      return readOrProblem(c, async () => ({
        statements: (
          await readTrustBankStatements(firm.firmDatabase, trustAccountId as TrustAccountId)
        ).map((statement) => ({
          id: statement.id,
          trustAccountId: statement.trustAccountId,
          periodStart: statement.periodStart,
          periodEnd: statement.periodEnd,
          openingBalanceMinor: statement.openingBalanceMinor,
          closingBalanceMinor: statement.closingBalanceMinor,
          currency: statement.currency,
          statementReference: statement.statementReference,
          source: statement.source,
          supersedesStatementId: statement.supersedesStatementId,
          recordedBy: statement.recordedBy,
          recordedAt: statement.recordedAt,
        })),
      }));
    },
  );

  // GET /api/v1/trust/bank-statements/{statementId}/lines
  app.openapi(
    { ...statementLinesRoute, middleware: chokepointMiddleware(chokepoint, statementLinesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { statementId } = c.req.valid("param");
      return readOrProblem(c, async () => ({
        lines: (
          await readTrustBankStatementLines(firm.firmDatabase, statementId as TrustBankStatementId)
        ).map(toLineRecord),
      }));
    },
  );

  // POST /api/v1/trust/bank-statements/import/preview — detection and reporting, always on
  app.openapi(
    { ...previewImportRoute, middleware: chokepointMiddleware(chokepoint, previewImportRoute) },
    (c) => {
      const request = c.req.valid("json");
      return readOrProblem(c, () => {
        const preview = previewTrustStatementImport(request.fileText, {
          dateFormat: request.dateFormat,
          currency: currencyFromCode(request.currency),
        });
        return Promise.resolve({
          columnMapping: preview.columnMapping,
          rows: [...preview.rows],
          rejections: [...preview.rejections],
          depositTotalMinor: preview.depositTotalMinor,
          withdrawalTotalMinor: preview.withdrawalTotalMinor,
          earliestPostedOn: preview.earliestPostedOn,
          latestPostedOn: preview.latestPostedOn,
          fingerprint: preview.fingerprint,
        });
      });
    },
  );

  // POST /api/v1/trust/bank-statements/import — and only because somebody asked for it
  app.openapi(
    { ...importStatementRoute, middleware: chokepointMiddleware(chokepoint, importStatementRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const currency = currencyFromCode(request.currency);
      return commitWrite<z.infer<typeof ImportReport>>(c, async (recordedBy) => {
        const confirmed = await confirmTrustStatementImport(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId,
            periodStart: request.periodStart,
            periodEnd: request.periodEnd,
            openingBalance: money(request.openingBalanceMinor, currency),
            closingBalance: money(request.closingBalanceMinor, currency),
            statementReference: request.statementReference ?? null,
            supersedesStatementId: request.supersedesStatementId ?? null,
            fileText: request.fileText,
            confirmedFingerprint: request.confirmedFingerprint,
            recordedBy,
          },
          { ...trustOptions(), dateFormat: request.dateFormat, currency },
        );
        return {
          write: confirmed.effect,
          body: {
            trustBankStatementId: confirmed.report.statementId,
            linesRecorded: confirmed.report.linesRecorded,
            rowsRejected: confirmed.report.rowsRejected,
            depositTotalMinor: confirmed.report.depositTotalMinor,
            withdrawalTotalMinor: confirmed.report.withdrawalTotalMinor,
          },
        };
      });
    },
  );

  // POST /api/v1/trust/reconciliations — open one
  app.openapi(
    {
      ...openReconciliationRoute,
      middleware: chokepointMiddleware(chokepoint, openReconciliationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitWrite<z.infer<typeof ReconciliationAck>>(c, async (openedBy) => {
        const opened = await openTrustReconciliation(
          firm.firmDatabase,
          {
            statementId: request.statementId,
            supersedesReconciliationId: request.supersedesReconciliationId ?? null,
            note: request.note ?? null,
            openedBy,
          },
          trustOptions(),
        );
        return {
          write: opened.effect,
          body: { trustReconciliationId: opened.reconciliationId },
        };
      });
    },
  );

  // GET /api/v1/trust/reconciliations
  app.openapi(
    {
      ...listReconciliationsRoute,
      middleware: chokepointMiddleware(chokepoint, listReconciliationsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId } = c.req.valid("query");
      return readOrProblem(c, async () => ({
        reconciliations: (
          await readTrustReconciliations(firm.firmDatabase, trustAccountId as TrustAccountId)
        ).map(toReconciliationRecord),
      }));
    },
  );

  // GET /api/v1/trust/reconciliations/{reconciliationId} — the proof as it stands now
  app.openapi(
    {
      ...reconciliationDetailRoute,
      middleware: chokepointMiddleware(chokepoint, reconciliationDetailRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reconciliationId } = c.req.valid("param");
      return readOrProblem(c, async () => {
        const { reconciliation, proof } = await readTrustThreeWayProof(
          firm.firmDatabase,
          reconciliationId as TrustReconciliationId,
        );
        return {
          reconciliation: toReconciliationRecord(reconciliation),
          proof: toProofRecord(proof),
        };
      });
    },
  );

  // GET /api/v1/trust/reconciliations/{reconciliationId}/suggestions — candidates, never matches
  app.openapi(
    { ...suggestionsRoute, middleware: chokepointMiddleware(chokepoint, suggestionsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reconciliationId } = c.req.valid("param");
      return readOrProblem(c, async () => {
        const suggested = await readTrustMatchSuggestions(
          firm.firmDatabase,
          reconciliationId as TrustReconciliationId,
        );
        return {
          unmatchedLines: suggested.unmatchedLines.map(toLineRecord),
          outstandingItems: suggested.outstandingItems.map(toBankItemRecord),
          suggestions: suggested.suggestions.map((suggestion) => ({
            statementLineId: suggestion.statementLineId,
            ledgerEntryId: suggestion.entryId,
            signals: [...suggestion.signals],
            dayGap: suggestion.dayGap,
          })),
        };
      });
    },
  );

  // POST /api/v1/trust/reconciliations/{reconciliationId}/matches — a person's assertion
  app.openapi(
    { ...recordMatchRoute, middleware: chokepointMiddleware(chokepoint, recordMatchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reconciliationId } = c.req.valid("param");
      const request = c.req.valid("json");
      return commitWrite<z.infer<typeof MatchAck>>(c, async (matchedBy) => {
        const composed = await composeTrustReconciliationMatch(
          firm.firmDatabase,
          {
            reconciliationId: reconciliationId as TrustReconciliationId,
            statementLineId: request.statementLineId as TrustBankStatementLineId,
            entryId: request.ledgerEntryId as LedgerEntryId,
            matchedBy,
          },
          trustOptions(),
        );
        return {
          write: composed.effect,
          body: { trustReconciliationMatchId: composed.matchId },
        };
      });
    },
  );

  // POST /api/v1/trust/reconciliations/{reconciliationId}/matches/{matchId}/withdrawal
  app.openapi(
    { ...withdrawMatchRoute, middleware: chokepointMiddleware(chokepoint, withdrawMatchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      // BOTH segments are used. The match row knows its own reconciliation, so the path's first
      // segment is not how the period is resolved — but a URL that asserts a containment the handler
      // never checks will answer 201 for a withdrawal in a period the caller never named, which is
      // how a client-side mix-up becomes a match withdrawn from the wrong period.
      const { reconciliationId, matchId } = c.req.valid("param");
      return commitWrite<z.infer<typeof MatchAck>>(c, async (withdrawnBy) => {
        const composed = await composeTrustReconciliationUnmatch(
          firm.firmDatabase,
          {
            matchId: matchId as TrustReconciliationMatchId,
            reconciliationId: reconciliationId as TrustReconciliationId,
            withdrawnBy,
          },
          trustOptions(),
        );
        return {
          write: composed.effect,
          body: { trustReconciliationMatchId: composed.matchId },
        };
      });
    },
  );

  // POST /api/v1/trust/reconciliations/{reconciliationId}/close — the freeze
  app.openapi(
    {
      ...closeReconciliationRoute,
      middleware: chokepointMiddleware(chokepoint, closeReconciliationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reconciliationId } = c.req.valid("param");
      return commitWrite<z.infer<typeof CloseAck>>(c, async (closedBy) => {
        const closed = await closeTrustReconciliation(
          firm.firmDatabase,
          reconciliationId as TrustReconciliationId,
          closedBy,
          trustOptions(),
        );
        return {
          write: closed.effect,
          body: {
            trustReconciliationId: closed.reconciliationId,
            frozenProof: closed.frozen,
            proof: toProofRecord(closed.proof),
          },
        };
      });
    },
  );
}

type LineSnapshot = Awaited<ReturnType<typeof readTrustBankStatementLines>>[number];
type ReconciliationSnapshot = Awaited<ReturnType<typeof readTrustReconciliations>>[number];
type ProofSnapshot = Awaited<ReturnType<typeof readTrustThreeWayProof>>["proof"];
type BankItemSnapshot = ProofSnapshot["outstandingDeposits"][number];

function toLineRecord(line: LineSnapshot): z.infer<typeof StatementLineRecord> {
  return {
    id: line.id,
    postedOn: line.postedOn,
    direction: line.direction,
    amountMinor: line.amountMinor,
    description: line.description,
    reference: line.reference,
    counterpartyName: line.counterpartyName,
    sourceRowNumber: line.sourceRowNumber,
  };
}

function toBankItemRecord(item: BankItemSnapshot): z.infer<typeof BankItem> {
  return {
    ledgerEntryId: item.entryId,
    effectiveDate: item.effectiveDate,
    description: item.description,
    bankDeltaMinor: item.bankDeltaMinor,
    trustMovementId: item.movementId,
    movementKind: item.movementKind,
    trustTransferId: item.transferId,
    reference: item.reference,
    counterpartyName: item.counterpartyName,
  };
}

function toReconciliationRecord(
  reconciliation: ReconciliationSnapshot,
): z.infer<typeof ReconciliationRecord> {
  return {
    id: reconciliation.id,
    trustAccountId: reconciliation.trustAccountId,
    statementId: reconciliation.statementId,
    status: reconciliation.status,
    openedBy: reconciliation.openedBy,
    openedAt: reconciliation.openedAt,
    closedBy: reconciliation.closedBy,
    closedAt: reconciliation.closedAt,
    frozenProof: reconciliation.frozenProof,
    supersedesReconciliationId: reconciliation.supersedesReconciliationId,
    note: reconciliation.note,
  };
}

function toProofRecord(proof: ProofSnapshot): z.infer<typeof ThreeWayProof> {
  return {
    trustAccountId: proof.trustAccountId,
    statementId: proof.statementId,
    asOfDate: proof.asOfDate,
    currency: proof.currency,
    statementClosingMinor: proof.statementClosingMinor,
    outstandingDeposits: proof.outstandingDeposits.map(toBankItemRecord),
    outstandingDepositsMinor: proof.outstandingDepositsMinor,
    outstandingDisbursements: proof.outstandingDisbursements.map(toBankItemRecord),
    outstandingDisbursementsMinor: proof.outstandingDisbursementsMinor,
    adjustedBankMinor: proof.adjustedBankMinor,
    bookBalanceMinor: proof.bookBalanceMinor,
    clientLedgerTotalMinor: proof.clientLedgerTotalMinor,
    unmatchedStatementLines: proof.unmatchedStatementLines.map(toLineRecord),
    balanced: proof.balanced,
    disagreements: proof.disagreements.map((disagreement) => ({
      leg: disagreement.leg,
      differenceMinor: disagreement.differenceMinor,
    })),
  };
}
