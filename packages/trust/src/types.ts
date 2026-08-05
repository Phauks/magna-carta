import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  UserId,
} from "@magna-carta/identifiers/types";

// The three tiers of the sub-ledger tree, plus the permitted bank-charge carve-out. Postings land on
// MATTER leaves only: a client node is a roll-up over its matters (the bar's "client ledger"), and
// the trust account's liability root is a roll-up over its clients. `firmFunds` is reserved
// vocabulary — nothing creates one and the composition guard refuses to post to one — because the
// firm's own money in a trust account is a real, permitted category whose rules are not settled here
// and whose absence from the schema would later cost a table rebuild.
export const TRUST_NODE_KINDS = ["client", "matter", "firm_funds"] as const;
export type TrustNodeKind = (typeof TRUST_NODE_KINDS)[number];

// What a ledger account IS, as far as trust is concerned. Every account on a proposed entry resolves
// to exactly one of these before the entry is composed; "outside" is any account that belongs to no
// trust account at all, which is what makes commingling detectable rather than assumed-absent.
export type TrustAccountRole =
  | { readonly kind: "bank"; readonly trustAccountId: TrustAccountId } // the asset leaf: the book side
  | { readonly kind: "liabilityRoot"; readonly trustAccountId: TrustAccountId } // the client-side roll-up
  | {
      readonly kind: "client";
      readonly trustAccountId: TrustAccountId;
      readonly nodeId: TrustLedgerNodeId;
      readonly clientEntityId: string;
    }
  | {
      readonly kind: "matter";
      readonly trustAccountId: TrustAccountId;
      readonly nodeId: TrustLedgerNodeId;
      readonly clientEntityId: string;
      readonly matterId: MatterId;
    }
  | {
      readonly kind: "firmFunds";
      readonly trustAccountId: TrustAccountId;
      readonly nodeId: TrustLedgerNodeId;
    }
  | { readonly kind: "outside" };

// The trust-account facts a composer needs before composing: whether it is still open, and which
// ledger accounts are its two roots.
export interface TrustAccountSnapshot {
  readonly id: TrustAccountId;
  readonly currency: string;
  readonly status: "open" | "closed";
  readonly jurisdiction: string | null;
  readonly bankLedgerAccountId: LedgerAccountId;
  readonly clientLiabilityAccountId: LedgerAccountId;
}

export interface TrustLedgerNodeSnapshot {
  readonly id: TrustLedgerNodeId;
  readonly trustAccountId: TrustAccountId;
  readonly ledgerAccountId: LedgerAccountId;
  readonly kind: TrustNodeKind;
  readonly clientEntityId: string | null;
  readonly matterId: MatterId | null;
  readonly parentNodeId: TrustLedgerNodeId | null;
}

// Stored balance, the active holds against it, and what is actually disbursable. Available is what a
// disbursement or a transfer is measured against — a positive balance is not the ceiling when part
// of it is disputed.
export interface TrustAvailableBalance {
  readonly nodeId: TrustLedgerNodeId;
  readonly balanceMinor: number;
  readonly heldMinor: number;
  readonly availableMinor: number;
}

export interface TrustHoldSnapshot {
  readonly id: TrustHoldId;
  readonly nodeId: TrustLedgerNodeId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly releasesHoldId: TrustHoldId | null;
  readonly releasedByHoldId: TrustHoldId | null; // derived from the link, never a stored flag
}

// The three movements a firm makes inside a trust account. A deposit puts client money in, a
// disbursement pays it out, and a matter transfer reallocates it between two matters of the SAME
// client without any bank movement at all. There is deliberately no client-to-client movement: at
// the entry level it is indistinguishable from misappropriation, so it is not in the vocabulary.
export const TRUST_MOVEMENT_KINDS = ["deposit", "disbursement", "matter_transfer"] as const;
export type TrustMovementKind = (typeof TRUST_MOVEMENT_KINDS)[number];

// How the money physically moved, recorded as a value rather than buried in a description: several
// jurisdictions prohibit specific methods outright, and a rule engine cannot refuse a method it
// cannot see. `internal` names the matter transfer, where no bank movement happened at all — which
// is why the schema refuses `internal` on a deposit or a disbursement and refuses anything else on a
// matter transfer.
export const TRUST_MOVEMENT_METHODS = [
  "check",
  "cash",
  "wire",
  "electronic_transfer",
  "card",
  "internal",
] as const;
export type TrustMovementMethod = (typeof TRUST_MOVEMENT_METHODS)[number];

// The methods a DISBURSEMENT may claim — every movement method except `internal`, which names a
// reallocation that never touches a bank. Split out from TRUST_MOVEMENT_METHODS because a pending
// disbursement request is composed before any entry exists, so the movement shape CHECK that would
// otherwise catch `internal` is a whole approval cycle away.
export const TRUST_DISBURSEMENT_METHODS = [
  "check",
  "cash",
  "wire",
  "electronic_transfer",
  "card",
] as const;
export type TrustDisbursementMethod = (typeof TRUST_DISBURSEMENT_METHODS)[number];

// How a pending disbursement request ended. There is no `pending` member: pending is the DERIVED
// state of a request no decision names, the same way an active hold is a hold no release names, so
// there is no status column anywhere that can disagree with the rows.
export const TRUST_DISBURSEMENT_DECISIONS = ["approved", "rejected", "withdrawn"] as const;
export type TrustDisbursementDecisionKind = (typeof TRUST_DISBURSEMENT_DECISIONS)[number];

// On what footing an approval was given. `second_person` is the rule — a member other than the one
// who submitted the request approved it. `sole_trust_manager` is the recorded exception for a firm
// with only one member holding the trust capability: the submitter authorized their own
// disbursement, and the record says so in as many words rather than looking like an ordinary
// approval. The database refuses the exception the moment a second such member exists.
export const TRUST_DISBURSEMENT_AUTHORIZATION_BASES = [
  "second_person",
  "sole_trust_manager",
] as const;
export type TrustDisbursementAuthorizationBasis =
  (typeof TRUST_DISBURSEMENT_AUTHORIZATION_BASES)[number];

export interface TrustDisbursementRequestSnapshot {
  readonly id: TrustDisbursementRequestId;
  readonly trustAccountId: TrustAccountId;
  readonly nodeId: TrustLedgerNodeId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly method: TrustDisbursementMethod;
  readonly reference: string | null;
  readonly payee: string;
  readonly purpose: string;
  readonly description: string;
  readonly effectiveDate: string;
  readonly requestedBy: UserId;
  readonly requestedAt: string;
  // Null while the request is pending — the derived state, read from the absence of a decision row.
  readonly decision: TrustDisbursementDecisionSnapshot | null;
}

export interface TrustDisbursementDecisionSnapshot {
  readonly id: TrustDisbursementDecisionId;
  readonly decision: TrustDisbursementDecisionKind;
  readonly decidedBy: UserId;
  readonly decidedAt: string;
  readonly reason: string | null;
  readonly authorizationBasis: TrustDisbursementAuthorizationBasis | null;
  readonly movementId: TrustMovementId | null;
}

export interface TrustMovementSnapshot {
  readonly id: TrustMovementId;
  readonly trustAccountId: TrustAccountId;
  readonly kind: TrustMovementKind;
  readonly nodeId: TrustLedgerNodeId;
  readonly counterpartyNodeId: TrustLedgerNodeId | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly entryId: LedgerEntryId;
  readonly method: TrustMovementMethod;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
  readonly purpose: string;
  readonly recordedBy: UserId;
  readonly authorizedBy: UserId | null;
  readonly effectiveDate: string;
  readonly recordedAt: string;
}
