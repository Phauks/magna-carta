/*
 * The Trust surfaces' response shapes and calls: the matter's Trust section and the firm's own
 * Trust screen read and write through this one file. Mirrors the trust routes in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * EVERY READ AND WRITE NAMES A TRUST ACCOUNT. A firm holds one or more trust accounts, each bound
 * to an office; a matter's ledger is read against one of them, a deposit is posted into one, a
 * payment out is proposed against one, and a transfer moves money inside one. So the account
 * listing is the first read every trust surface makes, and it is declared here beside the calls
 * that take the identifier it hands out. The report screen reads the same listing through this
 * file rather than keeping a copy of it.
 *
 * EVERY FIELD THE CONTRACT SERVES IS DECLARED HERE. A type that names a subset is a screen that
 * cannot see what the server sent: the ledger reads these interfaces to decide what it can render,
 * and a field missing here renders as a gap on a record that has one. Field names stay as served.
 *
 * EVERY WRITE TAKES AN IDEMPOTENCY KEY, minted by the caller on the gesture that opens the form
 * and reused on every retry of that one submission: a retried deposit that posted twice would be a
 * second real movement of a client's money, and the server refuses the call outright without one.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** The capabilities the trust routes name, spelled once so a refusal can name the right one. */
export const TRUST_PERMISSIONS = {
  /** Read trust accounts, a matter's ledger, balances, holds, statements and reconciliations. */
  read: "trust:read",
  /** Open trust accounts and compose movements: deposits, payments out, transfers. */
  manage: "trust:manage",
  /** Release money out of a client ledger where the firm's posture requires authority. */
  authorize: "trust:authorize",
  /** Open and fund the bank-charge cushion, and record a service charge against it. */
  firmFunds: "trust:firmFunds",
} as const;

// ---- the firm's trust accounts ------------------------------------------------------------------

/** One of the firm's trust accounts, as the listing serves it. */
export interface TrustAccountListing {
  id: string;
  name: string;
  /** The office the account is bound to; its jurisdiction is derived from that office. */
  locationId: string;
  /** The governing jurisdiction, or null where the office recorded none: movements refuse until it does. */
  jurisdiction: string | null;
  bankName: string | null;
  accountNumberLastFour: string | null;
  currency: string;
  /** Whether the account is a pooled interest-bearing (IOLTA-style) account. */
  iolta: boolean;
  status: "open" | "closed";
  openedOn: string;
  closedAt: string | null;
  /** The holding office's IANA zone, resolved: the zone a chosen day ends in for this account. */
  timeZone: string;
}

interface TrustAccountPage {
  data: TrustAccountListing[];
  nextCursor: string | null;
}

/*
 * A picker wants the whole roster, and the listing pages. Walking every page is right for a
 * firm's trust accounts — a handful, a few dozen at the most — and the walk is capped so a
 * cursor that never ends cannot hold the screen: past the cap the roster is returned short and
 * `capped` says so, which is the difference between "these are all" and "we stopped".
 */
const MOST_PAGES_WALKED = 10;

export interface TrustAccountRoster {
  readonly accounts: readonly TrustAccountListing[];
  readonly capped: boolean;
}

export async function listTrustAccounts(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<TrustAccountRoster>> {
  const accounts: TrustAccountListing[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < MOST_PAGES_WALKED; pages += 1) {
    const path: string =
      cursor === null
        ? "/api/v1/trust/accounts"
        : `/api/v1/trust/accounts?cursor=${encodeURIComponent(cursor)}`;
    const outcome: ApiOutcome<TrustAccountPage> = await requestJson(fetchImpl, path);
    if (outcome.kind !== "ok") return outcome;
    accounts.push(...outcome.value.data);
    cursor = outcome.value.nextCursor;
    if (cursor === null) return { kind: "ok", value: { accounts, capped: false } };
  }
  return { kind: "ok", value: { accounts, capped: true } };
}

/** How an account reads in a picker: its name, and the bank and last four where recorded. */
export function trustAccountLabel(account: TrustAccountListing): string {
  const parts = [account.name];
  if (account.bankName !== null) parts.push(account.bankName);
  if (account.accountNumberLastFour !== null) parts.push(`ending ${account.accountNumberLastFour}`);
  if (account.status === "closed") parts.push("closed");
  return parts.join(" · ");
}

/**
 * One trust account's position as it stands today: the bank's book balance, what the client ledgers
 * come to, what is under hold, the firm's own cushion where one is open, and what is waiting.
 * Every figure is computed from dated rows at the moment of asking, never a stored total.
 */
export interface TrustAccountPosition {
  trustAccountId: string;
  currency: string;
  /** The civil day the figures are as of, in the account's zone. */
  asOfDate: string;
  /** The trust bank account's book balance: every posted entry netted. */
  bookBalanceMinor: number;
  /** The sum of every client ledger on the account: what the firm holds for other people. */
  clientLedgerTotalMinor: number;
  /** The part of the client total under disputed-funds holds. */
  heldMinor: number;
  /** The bank-charge cushion's balance, or null where the carve-out was never opened. */
  firmFundsMinor: number | null;
  /** How many matter ledgers the account carries, zero-balance ones included. */
  matterLedgerCount: number;
  /** How many requests on the account nobody has decided yet. */
  pendingRequestCount: number;
}

export function readTrustAccountPosition(
  fetchImpl: typeof fetch,
  trustAccountId: string,
): Promise<ApiOutcome<TrustAccountPosition>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/accounts/${encodeURIComponent(trustAccountId)}/position`,
  );
}

/** What opening a trust account states. The jurisdiction is the office's, never the caller's. */
export interface OpenTrustAccountRequest {
  name: string;
  locationId: string;
  bankName?: string | null;
  /** The last four digits of the account number: all the platform stores of it. */
  accountNumberLastFour?: string | null;
  /** Pooled interest-bearing (IOLTA-style). Defaults to true on the server when absent. */
  iolta?: boolean;
  /** YYYY-MM-DD, the day the account was opened at the institution. */
  openedOn: string;
  currency: "USD";
}

/** Opens a trust account bound to one of the firm's offices. Answers with the account as listed. */
export function openTrustAccount(
  fetchImpl: typeof fetch,
  request: OpenTrustAccountRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustAccountListing>> {
  return requestJson(fetchImpl, "/api/v1/trust/accounts", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

// ---- a matter's ledger ---------------------------------------------------------------------------

/** What a movement IS: money in, money out, or money moved between two of one client's matters. */
export type TrustMovementKind = "deposit" | "disbursement" | "matter_transfer";

/** How the money moved. `internal` is a transfer's own method: nothing left the account. */
export type TrustMovementMethod =
  | "check"
  | "cash"
  | "wire"
  | "electronic_transfer"
  | "card"
  | "internal";

/** The methods a deposit or a payment out may state: `internal` is set by the server on a transfer. */
export type TrustBankMovementMethod = Exclude<TrustMovementMethod, "internal">;

/**
 * On what footing a payment out was authorized. `sole_trust_manager` says plainly that the firm
 * had nobody else who could approve, so the submitter authorized their own payment;
 * `policy_exempt` says the firm's policy did not require a second person for the amount. Both are
 * facts a reader must not have to infer from noticing that two user handles match.
 */
export type TrustAuthorizationBasis = "second_person" | "sole_trust_manager" | "policy_exempt";

/** One movement on a matter's trust ledger, as the ledger read serves it. */
export interface TrustMovementRecord {
  id: string;
  kind: TrustMovementKind;
  /** The node the movement is stored against. On a transfer this is the node the money LEFT. */
  trustLedgerNodeId: string;
  /** On a transfer, the node the money reached. Null on a deposit and a disbursement. */
  counterpartyTrustLedgerNodeId: string | null;
  /** Whole minor units, always positive: the direction is the kind's, never the sign's. */
  amountMinor: number;
  currency: string;
  ledgerEntryId: string;
  method: TrustMovementMethod;
  reference: string | null;
  /** Who paid in or was paid out. Null on a transfer, where the other matter is the counterparty. */
  counterpartyName: string | null;
  purpose: string;
  /** The user identifier of whoever wrote the movement down. */
  recordedBy: string;
  /** The user identifier of whoever released it, where a release took one. */
  authorizedBy: string | null;
  /** The disbursement request this movement was approved from. Present only on a disbursement. */
  disbursementRequestId: string | null;
  authorizationBasis: TrustAuthorizationBasis | null;
  effectiveDate: string;
  recordedAt: string;
}

/**
 * One matter's trust ledger: its stored balance, the amount under disputed-funds holds, what is
 * available, and every movement that touched it in effective-date order. A transfer between two
 * matters appears on both.
 */
export interface TrustMatterLedger {
  /** This matter's own node, which is what tells a transfer's direction. */
  trustLedgerNodeId: string;
  balanceMinor: number;
  heldMinor: number;
  availableMinor: number;
  movements: TrustMovementRecord[];
}

/**
 * The matter's trust ledger against one of the firm's trust accounts.
 *
 * A matter that has never received money into this account holds NO ledger there — the leaf is
 * created by its first deposit — and the read answers 404 for it. That is a fact about the matter
 * rather than a failure of the read, and a caller renders it as "no ledger yet" rather than as an
 * error screen.
 */
export function readMatterTrustLedger(
  fetchImpl: typeof fetch,
  matterId: string,
  trustAccountId: string,
): Promise<ApiOutcome<TrustMatterLedger>> {
  const query = new URLSearchParams({ trustAccountId });
  return requestJson(
    fetchImpl,
    `/api/v1/trust/matters/${encodeURIComponent(matterId)}/ledger?${query.toString()}`,
  );
}

/** Whether a failed ledger read means the matter simply holds no ledger in that account yet. */
export function isNoLedgerYet(outcome: ApiOutcome<TrustMatterLedger>): boolean {
  return outcome.kind === "problem" && outcome.problem.status === 404;
}

// ---- movements: money in, money out, money between matters --------------------------------------

/** What the deposit route acknowledges. */
export interface TrustMovementAck {
  trustMovementId: string;
  ledgerEntryId: string;
  trustLedgerNodeId: string;
  counterpartyTrustLedgerNodeId: string | null;
}

export interface TrustDepositRequest {
  trustAccountId: string;
  matterId: string;
  amountMinor: number;
  currency: "USD";
  /** YYYY-MM-DD, the day the money reached the account. */
  effectiveDate: string;
  /** The ledger entry's own line. */
  description: string;
  method: TrustBankMovementMethod;
  reference?: string | null;
  /** Who the money came from. */
  source: string;
  /** Why the client's money was received. */
  purpose: string;
}

/** Records client money received into a matter's trust ledger; the ledger is created on the first. */
export function recordTrustDeposit(
  fetchImpl: typeof fetch,
  request: TrustDepositRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustMovementAck>> {
  return requestJson(fetchImpl, "/api/v1/trust/deposits", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export interface TrustDisbursementProposal {
  trustAccountId: string;
  matterId: string;
  amountMinor: number;
  currency: "USD";
  effectiveDate: string;
  description: string;
  method: TrustBankMovementMethod;
  reference?: string | null;
  /** Who is paid. */
  payee: string;
  purpose: string;
}

/** A member who may settle a request the proposer could not release alone. */
export interface TrustEligibleApprover {
  userId: string;
  displayName: string;
}

/**
 * What proposing a payment out acknowledges: either the money moved (`approved`, with the movement
 * it posted) or a request now waits on somebody who holds the authority (`pending`, naming them).
 */
export interface TrustDisbursementProposalAck {
  trustDisbursementRequestId: string;
  status: "pending" | "approved";
  authorizationBasis: TrustAuthorizationBasis | null;
  trustMovementId: string | null;
  ledgerEntryId: string | null;
  trustLedgerNodeId: string;
  /** Who can settle it if this member could not. Empty on a release: nobody is waiting on anybody. */
  eligibleApprovers: TrustEligibleApprover[];
}

/** Proposes a payment of client money out of a matter's ledger, releasing it where the posture allows. */
export function proposeTrustDisbursement(
  fetchImpl: typeof fetch,
  request: TrustDisbursementProposal,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustDisbursementProposalAck>> {
  return requestJson(fetchImpl, "/api/v1/trust/disbursement-requests", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export interface TrustMatterTransferRequest {
  trustAccountId: string;
  fromMatterId: string;
  /** Must belong to the same client as `fromMatterId`; the server refuses any other. */
  toMatterId: string;
  amountMinor: number;
  currency: "USD";
  effectiveDate: string;
  description: string;
  purpose: string;
}

/** Moves trust funds between two matters of the SAME client. No bank movement happens. */
export function transferTrustBetweenMatters(
  fetchImpl: typeof fetch,
  request: TrustMatterTransferRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustMovementAck>> {
  return requestJson(fetchImpl, "/api/v1/trust/matter-transfers", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

// ---- the approval queue --------------------------------------------------------------------------

/**
 * What a pending request IS: a payment out of a client ledger, or earned fees taken against a
 * finalized bill, that nobody has decided yet.
 */
export type TrustRequestKind = "disbursement" | "earned_fee_application";

/** One request on the queue an approving member works from, oldest first. */
export interface TrustPendingRequest {
  id: string;
  kind: TrustRequestKind;
  trustLedgerNodeId: string;
  amountMinor: number;
  currency: string;
  method: TrustBankMovementMethod;
  reference: string | null;
  payee: string;
  purpose: string;
  description: string;
  effectiveDate: string;
  /** The user identifier of the member who proposed it. */
  requestedBy: string;
  requestedAt: string;
  /** The matter whose ledger the money would leave. Null only on a node that is not a matter leaf. */
  matterId: string | null;
  matterNumber: string | null;
  matterTitle: string | null;
}

/** The requests on one trust account that nobody has decided yet, oldest first. */
export function listPendingTrustRequests(
  fetchImpl: typeof fetch,
  trustAccountId: string,
): Promise<ApiOutcome<{ requests: TrustPendingRequest[] }>> {
  const query = new URLSearchParams({ trustAccountId });
  return requestJson(fetchImpl, `/api/v1/trust/disbursement-requests?${query.toString()}`);
}

export interface TrustApprovalAck {
  trustDisbursementRequestId: string;
  authorizationBasis: TrustAuthorizationBasis;
  trustMovementId: string;
  ledgerEntryId: string;
  trustLedgerNodeId: string;
}

/** Approves a pending request and posts the movement, in one write. The approver is never the proposer. */
export function approveTrustRequest(
  fetchImpl: typeof fetch,
  requestId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustApprovalAck>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/disbursement-requests/${encodeURIComponent(requestId)}/approval`,
    { method: "POST", idempotencyKey },
  );
}

export interface TrustDecisionAck {
  trustDisbursementRequestId: string;
  decision: "rejected" | "withdrawn";
}

/** Refuses a pending request with a reason. Somebody other than the proposer; nothing reaches the ledger. */
export function rejectTrustRequest(
  fetchImpl: typeof fetch,
  requestId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustDecisionAck>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/disbursement-requests/${encodeURIComponent(requestId)}/rejection`,
    { method: "POST", body: { reason }, idempotencyKey },
  );
}

/** Takes back a pending request the calling member proposed. Recorded, never deleted. */
export function withdrawTrustRequest(
  fetchImpl: typeof fetch,
  requestId: string,
  reason: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustDecisionAck>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/disbursement-requests/${encodeURIComponent(requestId)}/withdrawal`,
    { method: "POST", body: { reason }, idempotencyKey },
  );
}

// ---- the firm's authorization posture ------------------------------------------------------------

/** Whether money leaving a client ledger takes a second person: never, above an amount, or always. */
export type TrustAuthorizationPolicyKind = "off" | "threshold" | "always";

/** One immutable version of the firm's posture. The shipped default has a null id and no author. */
export interface TrustAuthorizationPolicyVersion {
  id: string | null;
  version: number;
  policy: TrustAuthorizationPolicyKind;
  /** Present on a `threshold` posture: a second person above this amount, strictly. */
  thresholdAmountMinor: number | null;
  /** Whether whoever lets money go must hold the authority capability. */
  requireAuthorizedApprover: boolean;
  setBy: string | null;
  setAt: string | null;
}

export interface TrustAuthorizationPolicy {
  current: TrustAuthorizationPolicyVersion;
  history: TrustAuthorizationPolicyVersion[];
}

export function readTrustAuthorizationPolicy(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<TrustAuthorizationPolicy>> {
  return requestJson(fetchImpl, "/api/v1/trust/authorization-policy");
}

export interface TrustAuthorizationPolicyChange {
  policy: TrustAuthorizationPolicyKind;
  thresholdAmountMinor?: number | null;
  requireAuthorizedApprover: boolean;
}

/** Writes a new version of the posture. Governs new requests only; requires the authority capability. */
export function changeTrustAuthorizationPolicy(
  fetchImpl: typeof fetch,
  request: TrustAuthorizationPolicyChange,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustAuthorizationPolicyVersion>> {
  return requestJson(fetchImpl, "/api/v1/trust/authorization-policy", {
    method: "PUT",
    body: request,
    idempotencyKey,
  });
}

// ---- statements and reconciliations, as read ---------------------------------------------------

/** One period of a trust bank account as the institution reported it. */
export interface TrustBankStatement {
  id: string;
  trustAccountId: string;
  periodStart: string;
  periodEnd: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  currency: string;
  statementReference: string | null;
  source: "entered" | "imported";
  supersedesStatementId: string | null;
  recordedBy: string;
  recordedAt: string;
}

/** The statements recorded for one trust account, most recent period first. */
export function listTrustBankStatements(
  fetchImpl: typeof fetch,
  trustAccountId: string,
): Promise<ApiOutcome<{ statements: TrustBankStatement[] }>> {
  const query = new URLSearchParams({ trustAccountId });
  return requestJson(fetchImpl, `/api/v1/trust/bank-statements?${query.toString()}`);
}

/** One line of a statement as the bank posted it. */
export interface TrustBankStatementLine {
  id: string;
  postedOn: string;
  direction: "deposit" | "withdrawal";
  amountMinor: number;
  description: string;
  reference: string | null;
  counterpartyName: string | null;
  /** The row of the imported file this line came from; null on a line a member entered. */
  sourceRowNumber: number | null;
}

/** One statement's lines in the order the bank posted them. */
export function listTrustBankStatementLines(
  fetchImpl: typeof fetch,
  statementId: string,
): Promise<ApiOutcome<{ lines: TrustBankStatementLine[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/bank-statements/${encodeURIComponent(statementId)}/lines`,
  );
}

/** A line a member enters by hand. */
export interface TrustBankStatementLineEntry {
  postedOn: string;
  direction: "deposit" | "withdrawal";
  amountMinor: number;
  description: string;
  reference?: string | null;
  counterpartyName?: string | null;
}

export interface TrustBankStatementEntry {
  trustAccountId: string;
  periodStart: string;
  periodEnd: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  currency: "USD";
  statementReference?: string | null;
  /** A statement this one replaces, where the bank reissued a period. */
  supersedesStatementId?: string | null;
  lines: TrustBankStatementLineEntry[];
}

/** Records one period of the account as the bank reported it, with its lines, in one write. */
export function recordTrustBankStatement(
  fetchImpl: typeof fetch,
  request: TrustBankStatementEntry,
  idempotencyKey: string,
): Promise<ApiOutcome<{ trustBankStatementId: string; linesRecorded: number }>> {
  return requestJson(fetchImpl, "/api/v1/trust/bank-statements", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export type TrustStatementDateFormat = "iso" | "month-day-year" | "day-month-year";

/** A row the preview could read, and what it would become. */
export interface TrustStatementImportRow {
  rowNumber: number;
  postedOn: string;
  direction: "deposit" | "withdrawal";
  amountMinor: number;
  description: string;
  reference: string | null;
  counterpartyName: string | null;
}

/**
 * What a statement file holds, as the preview read it. Nothing is stored by the preview: the
 * fingerprint is what the import quotes back, so a file that changed in between is refused.
 */
export interface TrustStatementImportPreview {
  /** Which column the reader took each field from, keyed by field. */
  columnMapping: Record<string, unknown>;
  rows: TrustStatementImportRow[];
  rejections: { rowNumber: number; reason: string }[];
  depositTotalMinor: number;
  withdrawalTotalMinor: number;
  earliestPostedOn: string | null;
  latestPostedOn: string | null;
  fingerprint: string;
}

export function previewTrustStatementImport(
  fetchImpl: typeof fetch,
  request: { fileText: string; dateFormat?: TrustStatementDateFormat; currency: "USD" },
  idempotencyKey: string,
): Promise<ApiOutcome<TrustStatementImportPreview>> {
  return requestJson(fetchImpl, "/api/v1/trust/bank-statements/import/preview", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export interface TrustStatementImportRequest {
  trustAccountId: string;
  periodStart: string;
  periodEnd: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  currency: "USD";
  statementReference?: string | null;
  supersedesStatementId?: string | null;
  fileText: string;
  dateFormat?: TrustStatementDateFormat;
  /** The preview's fingerprint, quoted back: the file must still read the same. */
  confirmedFingerprint: string;
}

export interface TrustStatementImportAck {
  trustBankStatementId: string;
  linesRecorded: number;
  rowsRejected: number;
  depositTotalMinor: number;
  withdrawalTotalMinor: number;
}

/** Records a statement from a file that was previewed and confirmed. */
export function importTrustBankStatement(
  fetchImpl: typeof fetch,
  request: TrustStatementImportRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustStatementImportAck>> {
  return requestJson(fetchImpl, "/api/v1/trust/bank-statements/import", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** What a closed reconciliation froze: the three-way proof as it stood at the moment of closing. */
export interface TrustFrozenProof {
  statementClosingMinor: number;
  outstandingDepositsMinor: number;
  outstandingDisbursementsMinor: number;
  adjustedBankMinor: number;
  bookBalanceMinor: number;
  clientLedgerTotalMinor: number;
  unmatchedLineCount: number;
  unmatchedItemCount: number;
  balanced: boolean;
}

export interface TrustReconciliation {
  id: string;
  trustAccountId: string;
  statementId: string;
  status: "open" | "closed";
  openedBy: string;
  openedAt: string;
  closedBy: string | null;
  closedAt: string | null;
  /** Present once closed: what the firm attested to for that period, not what is true now. */
  frozenProof: TrustFrozenProof | null;
  supersedesReconciliationId: string | null;
  note: string | null;
}

/** The reconciliations recorded for one trust account, most recently opened first. */
export function listTrustReconciliations(
  fetchImpl: typeof fetch,
  trustAccountId: string,
): Promise<ApiOutcome<{ reconciliations: TrustReconciliation[] }>> {
  const query = new URLSearchParams({ trustAccountId });
  return requestJson(fetchImpl, `/api/v1/trust/reconciliations?${query.toString()}`);
}

/** Opens a reconciliation of one recorded statement. The account is the statement's, never stated. */
export function openTrustReconciliation(
  fetchImpl: typeof fetch,
  request: {
    statementId: string;
    supersedesReconciliationId?: string | null;
    note?: string | null;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ trustReconciliationId: string }>> {
  return requestJson(fetchImpl, "/api/v1/trust/reconciliations", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** A recorded entry that moved the bank balance and that no statement line clears. */
export interface TrustBankItem {
  ledgerEntryId: string;
  effectiveDate: string;
  description: string;
  /** Signed: positive into the bank, negative out of it. */
  bankDeltaMinor: number;
  trustMovementId: string | null;
  movementKind: TrustMovementKind | null;
  /** Present on an earned-fee transfer out of trust, which posts an entry and no movement. */
  trustTransferId: string | null;
  reference: string | null;
  counterpartyName: string | null;
}

/** Which leg of the proof disagrees, and by how much. */
export interface TrustProofDisagreement {
  leg: "bank-to-book" | "book-to-client";
  differenceMinor: number;
}

/**
 * The three-way proof as it stands NOW: the statement's closing balance adjusted for items the firm
 * recorded that have not reached the bank, the bank account's book balance, and the sum of the
 * client ledgers, each as of the statement's period end. A closed reconciliation still answers this,
 * and the answer may differ from what it froze; a surface shows both and never presents the
 * recomputed figure as what the firm attested to.
 */
export interface TrustThreeWayProof {
  trustAccountId: string;
  statementId: string;
  asOfDate: string;
  currency: string;
  statementClosingMinor: number;
  outstandingDeposits: TrustBankItem[];
  outstandingDepositsMinor: number;
  outstandingDisbursements: TrustBankItem[];
  outstandingDisbursementsMinor: number;
  adjustedBankMinor: number;
  bookBalanceMinor: number;
  clientLedgerTotalMinor: number;
  unmatchedStatementLines: TrustBankStatementLine[];
  balanced: boolean;
  disagreements: TrustProofDisagreement[];
}

export function readTrustReconciliation(
  fetchImpl: typeof fetch,
  reconciliationId: string,
): Promise<ApiOutcome<{ reconciliation: TrustReconciliation; proof: TrustThreeWayProof }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/reconciliations/${encodeURIComponent(reconciliationId)}`,
  );
}

/** Why a line and an item are candidates for each other. */
export type TrustMatchSignal =
  | "amount-equal"
  | "same-day"
  | "within-window"
  | "reference-equal"
  | "counterparty-similar";

export interface TrustMatchSuggestion {
  statementLineId: string;
  ledgerEntryId: string;
  signals: TrustMatchSignal[];
  /** Days between the bank's posting and the recorded effective date. */
  dayGap: number;
}

/**
 * The lines this reconciliation has not accounted for, the recorded items it has not accounted
 * for, and the candidate pairings with their reasons. NOTHING is matched by this read: a person
 * records every match, because a wrong automatic match is a wrong assertion about client money.
 */
export interface TrustReconciliationSuggestions {
  unmatchedLines: TrustBankStatementLine[];
  outstandingItems: TrustBankItem[];
  suggestions: TrustMatchSuggestion[];
}

export function readTrustReconciliationSuggestions(
  fetchImpl: typeof fetch,
  reconciliationId: string,
): Promise<ApiOutcome<TrustReconciliationSuggestions>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/reconciliations/${encodeURIComponent(reconciliationId)}/suggestions`,
  );
}

/** One assertion that a statement line and a recorded entry are the same event, and its fate. */
export interface TrustReconciliationMatch {
  id: string;
  statementLineId: string;
  ledgerEntryId: string;
  recordedBy: string;
  recordedAt: string;
  /** Present once somebody took the assertion back; the item is outstanding again. */
  withdrawnBy: string | null;
  withdrawnAt: string | null;
  line: TrustBankStatementLine;
  item: TrustBankItem;
}

/** Every match recorded on a reconciliation, withdrawn ones included, oldest first. */
export function listTrustReconciliationMatches(
  fetchImpl: typeof fetch,
  reconciliationId: string,
): Promise<ApiOutcome<{ matches: TrustReconciliationMatch[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/reconciliations/${encodeURIComponent(reconciliationId)}/matches`,
  );
}

/** Records a member's assertion that one line and one recorded entry are the same event. */
export function recordTrustReconciliationMatch(
  fetchImpl: typeof fetch,
  reconciliationId: string,
  request: { statementLineId: string; ledgerEntryId: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ trustReconciliationMatchId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/reconciliations/${encodeURIComponent(reconciliationId)}/matches`,
    { method: "POST", body: request, idempotencyKey },
  );
}

/** Takes a match back. Appended, never deleted: the item becomes outstanding again. */
export function withdrawTrustReconciliationMatch(
  fetchImpl: typeof fetch,
  reconciliationId: string,
  matchId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ trustReconciliationMatchId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/reconciliations/${encodeURIComponent(reconciliationId)}/matches/${encodeURIComponent(matchId)}/withdrawal`,
    { method: "POST", idempotencyKey },
  );
}

/**
 * Closes a reconciliation and freezes what its proof says at that moment. A period that did not
 * balance closes exactly as readily as one that did, recording that it did not tie out.
 */
export function closeTrustReconciliation(
  fetchImpl: typeof fetch,
  reconciliationId: string,
  idempotencyKey: string,
): Promise<
  ApiOutcome<{
    trustReconciliationId: string;
    frozenProof: TrustFrozenProof;
    proof: TrustThreeWayProof;
  }>
> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/reconciliations/${encodeURIComponent(reconciliationId)}/close`,
    { method: "POST", idempotencyKey },
  );
}

// ---- the firm's own money in a trust account -----------------------------------------------------

export type TrustFirmFundsMovementKind = "firm_funds_deposit" | "bank_charge";

export interface TrustFirmFundsMovement {
  id: string;
  kind: TrustFirmFundsMovementKind;
  amountMinor: number;
  currency: string;
  ledgerEntryId: string;
  method: "check" | "wire" | "electronic_transfer" | "bank_debit";
  reference: string | null;
  description: string;
  recordedBy: string;
  effectiveDate: string;
  recordedAt: string;
}

/** What is left of the firm's own money in one trust account, and every top-up and charge. */
export interface TrustFirmFundsPosition {
  trustAccountId: string;
  trustLedgerNodeId: string;
  ledgerAccountId: string;
  balanceMinor: number;
  currency: string;
  movements: TrustFirmFundsMovement[];
}

/**
 * The bank-charge cushion on one account. An account on which the carve-out was never opened
 * answers 404: the cushion is a thing a firm opts into, never a zero that was always there.
 */
export function readTrustFirmFunds(
  fetchImpl: typeof fetch,
  trustAccountId: string,
): Promise<ApiOutcome<TrustFirmFundsPosition>> {
  const query = new URLSearchParams({ trustAccountId });
  return requestJson(fetchImpl, `/api/v1/trust/firm-funds?${query.toString()}`);
}

/** Whether a failed cushion read means the carve-out was simply never opened on that account. */
export function isCushionNotOpened(outcome: ApiOutcome<TrustFirmFundsPosition>): boolean {
  return outcome.kind === "problem" && outcome.problem.status === 404;
}

/** Opens the bank-charge carve-out on one account: the firm may keep its own money there for that one purpose. */
export function openTrustFirmFunds(
  fetchImpl: typeof fetch,
  request: { trustAccountId: string; nodeName: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ trustLedgerNodeId: string; ledgerAccountId: string }>> {
  return requestJson(fetchImpl, "/api/v1/trust/firm-funds", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export type TrustFirmFundsDepositMethod = "check" | "wire" | "electronic_transfer";

export interface TrustFirmFundsDepositRequest {
  trustAccountId: string;
  amountMinor: number;
  currency: "USD";
  effectiveDate: string;
  description: string;
  reference?: string | null;
  method: TrustFirmFundsDepositMethod;
}

export interface TrustFirmFundsMovementAck {
  trustFirmFundsMovementId: string;
  ledgerEntryId: string;
  trustLedgerNodeId: string;
}

/** Puts the firm's own money into the cushion: the only permitted deposit of firm money into trust. */
export function depositTrustFirmFunds(
  fetchImpl: typeof fetch,
  request: TrustFirmFundsDepositRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustFirmFundsMovementAck>> {
  return requestJson(fetchImpl, "/api/v1/trust/firm-funds/deposits", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export interface TrustBankChargeRequest {
  trustAccountId: string;
  amountMinor: number;
  currency: "USD";
  effectiveDate: string;
  description: string;
  reference?: string | null;
}

/**
 * Records the institution taking a service charge, borne by the cushion. A charge larger than the
 * cushion is refused with the remedy named: a bank charge is never borne by client money.
 */
export function recordTrustBankCharge(
  fetchImpl: typeof fetch,
  request: TrustBankChargeRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustFirmFundsMovementAck>> {
  return requestJson(fetchImpl, "/api/v1/trust/firm-funds/bank-charges", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

// ---- unclaimed client funds ----------------------------------------------------------------------
//
// Dormancy is a comparison made at read time against a window THE READER STATES: no stored flag, no
// sweep, no default period. The rules' clocks run from receipt, so the earliest receipt still on the
// ledger is reported separately from the last activity. Nothing on this path moves money.

/** A client ledger still holding money with no movement since the stated day. */
export interface TrustDormantBalance {
  trustLedgerNodeId: string;
  matterId: string;
  clientEntityId: string;
  balanceMinor: number;
  currency: string;
  earliestReceiptDate: string | null;
  lastActivityDate: string | null;
  /** The diligence file already open over this ledger, where one is. */
  openReviewId: string | null;
}

export function readDormantTrustBalances(
  fetchImpl: typeof fetch,
  trustAccountId: string,
  quietOnOrBefore: string,
): Promise<ApiOutcome<{ quietOnOrBefore: string; balances: TrustDormantBalance[] }>> {
  const query = new URLSearchParams({ trustAccountId, quietOnOrBefore });
  return requestJson(
    fetchImpl,
    `/api/v1/trust/unclaimed-funds/dormant-balances?${query.toString()}`,
  );
}

export interface TrustUnclaimedFundsReviewOpening {
  trustAccountId: string;
  matterId: string;
  /** The observation the reviewer acted on, stored as seen; the ledger may move afterwards. */
  observedBalanceMinor: number;
  observedEarliestReceiptDate: string | null;
  observedLastActivityDate: string | null;
  note?: string | null;
}

/** Opens a diligence file over one client's matter ledger. One ledger carries one open review. */
export function openTrustUnclaimedFundsReview(
  fetchImpl: typeof fetch,
  request: TrustUnclaimedFundsReviewOpening,
  idempotencyKey: string,
): Promise<ApiOutcome<{ trustUnclaimedFundsReviewId: string; trustLedgerNodeId: string }>> {
  return requestJson(fetchImpl, "/api/v1/trust/unclaimed-funds/reviews", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export type TrustContactChannel =
  | "regular_mail"
  | "certified_mail"
  | "telephone"
  | "email"
  | "record_review"
  | "other";

export type TrustContactOutcome =
  | "no_response"
  | "undeliverable"
  | "reached"
  | "declined"
  | "wrong_contact"
  | "other";

export interface TrustContactAttemptEntry {
  channel: TrustContactChannel;
  attemptedOn: string;
  /** The address or number actually used. Required on every channel but a review of the firm's own records. */
  contactUsed?: string | null;
  outcome: TrustContactOutcome;
  note?: string | null;
}

/** Records one attempt to reach the owner, as it was made. */
export function recordTrustContactAttempt(
  fetchImpl: typeof fetch,
  reviewId: string,
  request: TrustContactAttemptEntry,
  idempotencyKey: string,
): Promise<ApiOutcome<{ trustUnclaimedFundsContactAttemptId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/unclaimed-funds/reviews/${encodeURIComponent(reviewId)}/contact-attempts`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export type TrustReviewOutcome =
  | "distributed_to_owner"
  | "resolved_without_distribution"
  | "not_dormant"
  | "search_continues";

/**
 * Ends one round of diligence. Closing as a distribution ATTACHES a disbursement that already
 * posted through the ordinary authorized path; this takes no amount, payee, date or method.
 */
export function closeTrustUnclaimedFundsReview(
  fetchImpl: typeof fetch,
  reviewId: string,
  request: { outcome: TrustReviewOutcome; trustMovementId?: string | null; note?: string | null },
  idempotencyKey: string,
): Promise<
  ApiOutcome<{ trustUnclaimedFundsReviewClosureId: string; outcome: TrustReviewOutcome }>
> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/unclaimed-funds/reviews/${encodeURIComponent(reviewId)}/closure`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export interface TrustContactAttempt {
  id: string;
  channel: TrustContactChannel;
  attemptedOn: string;
  contactUsed: string | null;
  outcome: TrustContactOutcome;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface TrustUnclaimedFundsReview {
  id: string;
  trustAccountId: string;
  trustLedgerNodeId: string;
  observedBalanceMinor: number;
  currency: string;
  observedEarliestReceiptDate: string | null;
  observedLastActivityDate: string | null;
  openedBy: string;
  openedAt: string;
  note: string | null;
  attempts: TrustContactAttempt[];
  /** Null while the round is open. */
  closure: {
    id: string;
    outcome: TrustReviewOutcome;
    trustMovementId: string | null;
    closedBy: string;
    closedAt: string;
    note: string | null;
  } | null;
}

/** One diligence file whole: the observation, every attempt in order, and its closure if any. */
export function readTrustUnclaimedFundsReview(
  fetchImpl: typeof fetch,
  reviewId: string,
): Promise<ApiOutcome<TrustUnclaimedFundsReview>> {
  return requestJson(
    fetchImpl,
    `/api/v1/trust/unclaimed-funds/reviews/${encodeURIComponent(reviewId)}`,
  );
}
