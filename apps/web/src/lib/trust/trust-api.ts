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
