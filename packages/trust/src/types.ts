import type {
  LedgerAccountId,
  MatterId,
  TrustAccountId,
  TrustHoldId,
  TrustLedgerNodeId,
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
