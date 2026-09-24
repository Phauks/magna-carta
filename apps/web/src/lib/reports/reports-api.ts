/*
 * The reporting reads, and the trust-account listing a report about one account picks from.
 *
 * Mirrors `reports.trustCompliancePack` and `trust.listTrustAccounts` in
 * apps/api-worker/openapi/openapi.json. apps/web hand-writes the shapes it reads (the transport
 * seam in $lib/api/request.ts says why); every field the contract serves is declared, because a
 * presenter that cannot see a field renders a gap on a record that has one. Field names stay as
 * served.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import type { ReportCompleteness } from "./report-presentation.ts";

// ---- the trust-compliance pack ------------------------------------------------------------------

export type ReportReproducibility =
  | {
      reproducible: true;
      periodStart: string;
      periodEnd: string;
      knownAsOf: string;
    }
  | {
      reproducible: false;
      periodStart: string;
      periodEnd: string;
      computedAt: string;
    };

export type TrustComplianceJurisdiction =
  | {
      available: true;
      jurisdiction: string;
      requirement: string;
      citation: string;
      binding: boolean;
    }
  | {
      available: false;
      jurisdiction: string | null;
      refusalCode: string;
      refusalDetail: string;
    };

export interface TrustComplianceCover {
  trustAccountId: string;
  trustAccountName: string;
  locationId: string;
  currency: string;
  pooledInterestBearing: boolean;
  accountStatus: "open" | "closed";
  bankName: string | null;
  accountNumberLastFour: string | null;
  jurisdiction: TrustComplianceJurisdiction;
  bankChargeCarveOutOpen: boolean;
  reproducibility: ReportReproducibility;
  reproducibilityStatement: string;
  completeness: ReportCompleteness;
}

export interface TrustComplianceFrozenProof {
  statementClosingMinor: number;
  outstandingDepositsMinor: number;
  outstandingDisbursementsMinor: number;
  adjustedBankMinor: number;
  bookBalanceMinor: number;
  clientLedgerTotalMinor: number;
  firmFundsMinor: number;
  unmatchedLineCount: number;
  unmatchedItemCount: number;
  balanced: boolean;
}

export interface TrustComplianceBankItem {
  entryId: string;
  effectiveDate: string;
  description: string;
  bankDeltaMinor: number;
  movementId: string | null;
  movementKind: string | null;
  transferId: string | null;
  reference: string | null;
  counterpartyName: string | null;
}

export interface TrustComplianceStatementLine {
  id: string;
  statementId: string;
  postedOn: string;
  direction: string;
  amountMinor: number;
  description: string;
  reference: string | null;
  counterpartyName: string | null;
  sourceRowNumber: number | null;
}

export interface TrustComplianceLiveProof {
  trustAccountId: string;
  statementId: string;
  asOfDate: string;
  currency: string;
  statementClosingMinor: number;
  outstandingDeposits: TrustComplianceBankItem[];
  outstandingDepositsMinor: number;
  outstandingDisbursements: TrustComplianceBankItem[];
  outstandingDisbursementsMinor: number;
  adjustedBankMinor: number;
  bookBalanceMinor: number;
  clientLedgerTotalMinor: number;
  firmFundsMinor: number;
  unmatchedStatementLines: TrustComplianceStatementLine[];
  balanced: boolean;
  disagreements: { leg: string; differenceMinor: number }[];
}

export interface TrustComplianceProofDifference {
  leg: string;
  attestedMinor: number;
  liveMinor: number;
  differenceMinor: number;
}

export interface TrustComplianceReconciliation {
  reconciliationId: string;
  statementId: string;
  statementPeriodStart: string;
  statementPeriodEnd: string;
  statementReference: string | null;
  openedBy: string;
  openedAt: string;
  statusAsKnown: "open" | "closed";
  closedBy: string | null;
  closedAt: string | null;
  frozenProof: TrustComplianceFrozenProof | null;
  proofAtProduction: {
    computedAt: string;
    boundedByKnowledgeInstant: false;
    proof: TrustComplianceLiveProof;
    differencesFromAttestation: TrustComplianceProofDifference[];
  };
}

export interface TrustComplianceLedgerEntry {
  entryId: string;
  effectiveDate: string;
  recordedAt: string;
  description: string;
  reversesEntryId: string | null;
  direction: "debit" | "credit";
  amountMinor: number;
  deltaMinor: number;
  runningBalanceMinor: number;
  movementId: string | null;
  movementKind: string | null;
  method: string | null;
  reference: string | null;
  counterpartyName: string | null;
  purpose: string | null;
  transferId: string | null;
  authorizedBy: string | null;
  recordedBy: string | null;
}

export interface TrustComplianceMatterLedger {
  nodeId: string;
  matterId: string | null;
  ledgerAccountId: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  entries: TrustComplianceLedgerEntry[];
}

export interface TrustComplianceClientLedger {
  clientEntityId: string | null;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  matters: TrustComplianceMatterLedger[];
}

export interface TrustComplianceJournalEntry {
  entryId: string;
  effectiveDate: string;
  recordedAt: string;
  description: string;
  reversesEntryId: string | null;
  bankDeltaMinor: number;
  runningBalanceMinor: number;
  movementId: string | null;
  movementKind: string | null;
  transferId: string | null;
  firmFundsMovementId: string | null;
  firmFundsMovementKind: string | null;
  method: string | null;
  reference: string | null;
  counterpartyName: string | null;
  purpose: string | null;
  nodeId: string | null;
  counterpartyNodeId: string | null;
  authorizedBy: string | null;
  recordedBy: string | null;
}

export interface TrustComplianceCushionMovement {
  firmFundsMovementId: string;
  kind: "firm_funds_deposit" | "bank_charge";
  effectiveDate: string;
  recordedAt: string;
  amountMinor: number;
  method: string;
  reference: string | null;
  description: string;
  recordedBy: string;
}

export interface TrustComplianceCushion {
  nodeId: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  movements: TrustComplianceCushionMovement[];
}

export interface TrustComplianceHold {
  holdId: string;
  nodeId: string;
  matterId: string | null;
  clientEntityId: string | null;
  amountMinor: number;
  reason: string;
  placedAt: string;
  placedBy: string | null;
}

export interface TrustComplianceExceptions {
  holdsInForceAtKnowledgeInstant: TrustComplianceHold[];
  atProduction: {
    computedAt: string;
    boundedByKnowledgeInstant: false;
    outstandingBankItems: TrustComplianceBankItem[];
    unmatchedStatementLines: { reconciliationId: string; line: TrustComplianceStatementLine }[];
    storedBalanceDisagreements: {
      ledgerAccountId: string;
      storedBalanceMinor: number;
      computedBalanceMinor: number;
    }[];
  };
}

export interface TrustCompliancePack {
  cover: TrustComplianceCover;
  reconciliations: TrustComplianceReconciliation[];
  reconciliationNote: string | null;
  proofAtProductionNote: string;
  clientLedgers: TrustComplianceClientLedger[];
  journal: {
    openingBalanceMinor: number;
    closingBalanceMinor: number;
    entries: TrustComplianceJournalEntry[];
  };
  cushion: TrustComplianceCushion | null;
  exceptions: TrustComplianceExceptions;
  provenance: {
    requestedBy: string | null;
    computedAt: string;
    periodStart: string;
    periodEnd: string;
    knownAsOf: string | null;
    packShapeVersion: number;
    options: {
      zeroBalanceLedgers: "include" | "omit";
      authorizers: "include" | "omit";
    };
  };
}

export interface TrustCompliancePackQuery {
  readonly trustAccountId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Omitted means everything known now: a live report, stamped as such. */
  readonly knownAsOf?: string;
  /**
   * Both default from the firm's report policy on the server when absent, and the screen leaves
   * them absent; they stay on the call so a caller that must state one can.
   */
  readonly zeroBalanceLedgers?: "include" | "omit";
  readonly authorizers?: "include" | "omit";
}

/** The permission the pack route names. A member without it is refused server-side. */
export const TRUST_COMPLIANCE_PERMISSION = "reports:trustCompliance";

export function readTrustCompliancePack(
  fetchImpl: typeof fetch,
  query: TrustCompliancePackQuery,
): Promise<ApiOutcome<TrustCompliancePack>> {
  const search = new URLSearchParams({
    periodStart: query.periodStart,
    periodEnd: query.periodEnd,
  });
  if (query.knownAsOf !== undefined) search.set("knownAsOf", query.knownAsOf);
  if (query.zeroBalanceLedgers !== undefined) {
    search.set("zeroBalanceLedgers", query.zeroBalanceLedgers);
  }
  if (query.authorizers !== undefined) search.set("authorizers", query.authorizers);
  return requestJson(
    fetchImpl,
    `/api/v1/reports/trust-compliance/${encodeURIComponent(query.trustAccountId)}?${search.toString()}`,
  );
}

// ---- the firm's trust accounts ------------------------------------------------------------------
//
// The listing, its row type and the picker label live with the trust surfaces
// ($lib/trust/trust-api.ts), which read and write against the same identifier this report is asked
// about. They are re-exported here so the report screen keeps one import for everything it reads.

/** The permission the listing names: reading which accounts the firm holds is a trust read. */
export const LIST_TRUST_ACCOUNTS_PERMISSION = "trust:read";

export {
  listTrustAccounts,
  trustAccountLabel,
  type TrustAccountListing,
  type TrustAccountRoster,
} from "$lib/trust/trust-api.ts";

// ---- the firm's report policy -------------------------------------------------------------------
//
// What the firm decides once about what its trust-compliance document lists. A FIRM setting rather
// than a per-run choice (the owner's ruling, 2026-09-07): a compliance document should read the same
// every time the firm produces it. Read and written through `firm:manageReportPolicy`; the pack
// applies it on the server, so a member who runs the report never reads the policy directly.

export type TrustComplianceListing = "include" | "omit";

export interface FirmReportPolicy {
  trustCompliance: {
    zeroBalanceLedgers: TrustComplianceListing;
    authorizers: TrustComplianceListing;
  };
}

/** The permission the policy routes name. Owners and administrators hold it by seed. */
export const MANAGE_REPORT_POLICY_PERMISSION = "firm:manageReportPolicy";

export function readFirmReportPolicy(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<FirmReportPolicy>> {
  return requestJson(fetchImpl, "/api/v1/firm/reports/policy");
}

export interface UpdateFirmReportPolicyRequest {
  trustCompliance?: {
    zeroBalanceLedgers?: TrustComplianceListing;
    authorizers?: TrustComplianceListing;
  };
}

/** Changes what the firm's compliance document lists, for everybody; audited. */
export function updateFirmReportPolicy(
  fetchImpl: typeof fetch,
  request: UpdateFirmReportPolicyRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<FirmReportPolicy>> {
  return requestJson(fetchImpl, "/api/v1/firm/reports/policy", {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}
