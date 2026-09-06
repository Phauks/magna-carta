/*
 * The matter Trust section's response shapes and calls. Mirrors the trust routes in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * ONE READ, AND IT NAMES A TRUST ACCOUNT. A matter's trust ledger is read against one of the
 * firm's trust accounts, so the call takes the account's identifier exactly as the route does.
 * Nothing in the app can hand one out yet (trust-gaps.ts, `account`), which is why the ledger
 * surface stands empty: the read is declared here against the contract so the surface is built
 * against what the server serves, and the call is made the day the account listing exists.
 *
 * EVERY FIELD THE CONTRACT SERVES IS DECLARED HERE. A type that names a subset is a screen that
 * cannot see what the server sent: the ledger reads this interface to decide what it can render,
 * and a field missing here renders as a gap on a record that has one. Field names stay as served.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

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
  /** The user identifier of whoever wrote the movement down. A name is not served yet. */
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

/** The matter's trust ledger against one of the firm's trust accounts. */
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
