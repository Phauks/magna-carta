import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  TrustTransferId,
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

// How a bank statement's figures reached the platform. `imported` means a file the firm supplied was
// parsed, shown back, and confirmed by a person; it never means anything decided on its own to store
// them.
export const TRUST_BANK_STATEMENT_SOURCES = ["entered", "imported"] as const;
export type TrustBankStatementSource = (typeof TRUST_BANK_STATEMENT_SOURCES)[number];

// Which way a statement line moved the balance, stated from the account holder's side so a line can
// be compared with a recorded entry without anyone reasoning about the bank's debit/credit
// convention: a `deposit` increased the trust bank balance, a `withdrawal` reduced it.
export const TRUST_BANK_STATEMENT_LINE_DIRECTIONS = ["deposit", "withdrawal"] as const;
export type TrustBankStatementLineDirection = (typeof TRUST_BANK_STATEMENT_LINE_DIRECTIONS)[number];

// A reconciliation is open until it closes, and closing is the freeze. Unlike a hold's active state
// or a disbursement request's pending state, this is a stored value rather than a derivation,
// because there is no second row whose presence could imply it — the freeze IS the write.
export const TRUST_RECONCILIATION_STATUSES = ["open", "closed"] as const;
export type TrustReconciliationStatus = (typeof TRUST_RECONCILIATION_STATUSES)[number];

export interface TrustBankStatementSnapshot {
  readonly id: TrustBankStatementId;
  readonly trustAccountId: TrustAccountId;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalanceMinor: number;
  readonly closingBalanceMinor: number;
  readonly currency: string;
  readonly statementReference: string | null;
  readonly source: TrustBankStatementSource;
  readonly supersedesStatementId: TrustBankStatementId | null;
  readonly recordedBy: UserId;
  readonly recordedAt: string;
}

export interface TrustBankStatementLineSnapshot {
  readonly id: TrustBankStatementLineId;
  readonly statementId: TrustBankStatementId;
  readonly postedOn: string;
  readonly direction: TrustBankStatementLineDirection;
  readonly amountMinor: number;
  readonly description: string;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
  readonly sourceRowNumber: number | null;
}

// One thing the firm recorded that moved the trust bank balance, keyed by the LEDGER ENTRY rather
// than by a movement: an earned-fee transfer out of trust posts a bank-affecting entry and no
// movement row at all, so an outstanding list built from movements would never show one.
// `bankDeltaMinor` is signed from the account holder's side — positive put money in.
export interface TrustBankItem {
  readonly entryId: LedgerEntryId;
  readonly effectiveDate: string;
  readonly description: string;
  readonly bankDeltaMinor: number;
  readonly movementId: TrustMovementId | null;
  readonly movementKind: TrustMovementKind | null;
  readonly transferId: TrustTransferId | null;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
}

// Which pair of legs disagreed, and by how much. `bank-to-book` compares the adjusted bank balance
// with the trust bank account's own book balance; `book-to-client` compares that book balance with
// the sum of the client ledgers under it. Naming the leg is the point: the two failures have
// completely different causes, and a single "out by $412" tells a firm nothing about where to look.
export const TRUST_RECONCILIATION_LEGS = ["bank-to-book", "book-to-client"] as const;
export type TrustReconciliationLeg = (typeof TRUST_RECONCILIATION_LEGS)[number];

export interface TrustReconciliationDisagreement {
  readonly leg: TrustReconciliationLeg;
  // Signed: the first named side minus the second, so the sign says which way it is out.
  readonly differenceMinor: number;
}

// The proof. Three totals as of the statement's period end, the items that explain the gap between
// the bank's figure and the firm's, and — when they do not agree — exactly which leg is out and by
// how much. `balanced` is never forced: a proof that does not tie out reports so.
export interface TrustThreeWayProof {
  readonly trustAccountId: TrustAccountId;
  readonly statementId: TrustBankStatementId;
  readonly asOfDate: string;
  readonly currency: string;
  readonly statementClosingMinor: number;
  // Recorded on or before the period end, moving money INTO the bank, that no statement line clears.
  readonly outstandingDeposits: readonly TrustBankItem[];
  readonly outstandingDepositsMinor: number;
  // The same, moving money OUT — the outstanding checks of the classic bank reconciliation.
  readonly outstandingDisbursements: readonly TrustBankItem[];
  readonly outstandingDisbursementsMinor: number;
  readonly adjustedBankMinor: number;
  readonly bookBalanceMinor: number;
  readonly clientLedgerTotalMinor: number;
  // Lines on the statement nobody has tied to a recorded entry. A first-class outcome, not an
  // error state: an unmatched line is frequently the bank fee or returned deposit the firm never
  // recorded, which is the single most valuable thing a reconciliation finds.
  readonly unmatchedStatementLines: readonly TrustBankStatementLineSnapshot[];
  readonly balanced: boolean;
  readonly disagreements: readonly TrustReconciliationDisagreement[];
}

export interface TrustFrozenProof {
  readonly statementClosingMinor: number;
  readonly outstandingDepositsMinor: number;
  readonly outstandingDisbursementsMinor: number;
  readonly adjustedBankMinor: number;
  readonly bookBalanceMinor: number;
  readonly clientLedgerTotalMinor: number;
  readonly unmatchedLineCount: number;
  readonly unmatchedItemCount: number;
  readonly balanced: boolean;
}

export interface TrustReconciliationSnapshot {
  readonly id: TrustReconciliationId;
  readonly trustAccountId: TrustAccountId;
  readonly statementId: TrustBankStatementId;
  readonly status: TrustReconciliationStatus;
  readonly openedBy: UserId;
  readonly openedAt: string;
  readonly closedBy: UserId | null;
  readonly closedAt: string | null;
  // Absent while the reconciliation is open. Once present it never changes: it is what the proof
  // said at the moment somebody attested to it, and a posting made afterwards must not rewrite it.
  readonly frozenProof: TrustFrozenProof | null;
  readonly supersedesReconciliationId: TrustReconciliationId | null;
  readonly note: string | null;
}

export interface TrustReconciliationMatchSnapshot {
  readonly id: TrustReconciliationMatchId;
  readonly reconciliationId: TrustReconciliationId;
  readonly statementLineId: TrustBankStatementLineId;
  readonly entryId: LedgerEntryId;
  readonly unmatchesMatchId: TrustReconciliationMatchId | null;
  readonly unmatchedByMatchId: TrustReconciliationMatchId | null; // derived from the link
  readonly matchedBy: UserId;
  readonly matchedAt: string;
}

// Why the matcher thinks a line and an item might be the same event. Every reason is a fact a person
// can check against the two rows in front of them; there is no opaque score, because a suggestion
// nobody can audit is a suggestion that gets confirmed without being read.
export const TRUST_MATCH_SIGNALS = [
  "amount-equal",
  "same-day",
  "within-window",
  "reference-equal",
  "counterparty-similar",
] as const;
export type TrustMatchSignal = (typeof TRUST_MATCH_SIGNALS)[number];

export interface TrustMatchSuggestion {
  readonly statementLineId: TrustBankStatementLineId;
  readonly entryId: LedgerEntryId;
  readonly signals: readonly TrustMatchSignal[];
  // Days between the bank's posting date and the entry's effective date, signed: the bank posted
  // this many days after the firm recorded it.
  readonly dayGap: number;
}

// A line the import parsed, and one it could not. A rejected row carries its number and the reason,
// because the person fixing it is looking at a file on their own machine and needs to be told which
// row to open.
export interface TrustStatementImportRow {
  readonly rowNumber: number;
  readonly postedOn: string;
  readonly direction: TrustBankStatementLineDirection;
  readonly amountMinor: number;
  readonly description: string;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
}

export interface TrustStatementImportRejection {
  readonly rowNumber: number;
  readonly reason: string;
}

// What a file contains, reported BEFORE anything is stored and independently of whether anything
// ever is. The preview is the decision surface: it says what was found, what each row would become,
// what cannot be carried across, and what the totals imply — and storing any of it takes a separate,
// explicit confirmation carrying this preview's fingerprint.
export interface TrustStatementImportPreview {
  readonly columnMapping: Readonly<Record<string, string>>;
  readonly rows: readonly TrustStatementImportRow[];
  readonly rejections: readonly TrustStatementImportRejection[];
  readonly depositTotalMinor: number;
  readonly withdrawalTotalMinor: number;
  readonly earliestPostedOn: string | null;
  readonly latestPostedOn: string | null;
  // Identifies exactly these parsed rows. A confirmation quoting a different fingerprint is refused,
  // so a person can never confirm one preview and have a different file stored.
  readonly fingerprint: string;
}

// What actually happened, reported after the run — the other half of the same posture the preview
// serves. A firm sees what was found before it decides and what was stored after it did.
export interface TrustStatementImportReport {
  readonly statementId: TrustBankStatementId;
  readonly linesRecorded: number;
  readonly rowsRejected: number;
  readonly depositTotalMinor: number;
  readonly withdrawalTotalMinor: number;
}
