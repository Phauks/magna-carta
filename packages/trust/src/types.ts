import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustAuthorizationPolicyId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustFirmFundsMovementId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  TrustTransferId,
  TrustUnclaimedFundsContactAttemptId,
  TrustUnclaimedFundsReviewClosureId,
  TrustUnclaimedFundsReviewId,
  UserId,
} from "@magna-carta/identifiers/types";

// The three tiers of the sub-ledger tree, plus the permitted bank-charge carve-out. Client money
// lands on MATTER leaves only: a client node is a roll-up over its matters (the bar's "client
// ledger"), and the trust account's liability root is a roll-up over its clients.
//
// `firm_funds` is the fourth thing and it is NOT a tier of that tree: it hangs off no parent, rolls
// up into nothing, and holds the firm's own money kept in the account to bear the bank's service
// charges. It carries postings — but only from `composeTrustFirmFundsEntry`, a door narrower than
// the one client money goes through, and never from `composeTrustEntry`, which refuses it outright.
// See composition-guard.ts for why that is two doors rather than one relaxed check.
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
  // Whether this is the POOLED INTEREST-BEARING kind of trust account — the one a jurisdiction
  // compels for nominal or short-term client funds. It is carried on the snapshot because the
  // bank-charge carve-out turns on it: the researched corpus records the pooled account as exempt
  // from service charges by rule, so an account of that kind has no charge for the firm's own funds
  // to pay. Spelled `iolta` to match the column and the industry's own name for the arrangement.
  readonly iolta: boolean;
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

// On what footing an approval was given. `second_person` is the rule under a policy that requires
// one — a member other than the one who submitted the request approved it. `sole_trust_manager` is
// the recorded exception for a firm with only one member holding the trust capability: a second
// person was required, nobody else existed, and the submitter authorized their own disbursement —
// the record says so in as many words rather than looking like an ordinary approval; the database
// refuses it the moment a second such member exists. `policy_exempt` records that the policy version
// stamped on the request did not require a second person for the amount, and the submitter acted
// alone under it. Each basis is pinned to the stamped policy by triggers, so none can be worn where
// another applies.
export const TRUST_DISBURSEMENT_AUTHORIZATION_BASES = [
  "second_person",
  "sole_trust_manager",
  "policy_exempt",
] as const;
export type TrustDisbursementAuthorizationBasis =
  (typeof TRUST_DISBURSEMENT_AUTHORIZATION_BASES)[number];

// What a request's approval will post: a `disbursement` posts a trust movement to an external payee;
// an `earned_fee_application` posts a trust-to-operating transfer whose invoice particulars billing
// keeps beside the request. One queue, one decision discipline, two postings.
export const TRUST_DISBURSEMENT_REQUEST_KINDS = ["disbursement", "earned_fee_application"] as const;
export type TrustDisbursementRequestKind = (typeof TRUST_DISBURSEMENT_REQUEST_KINDS)[number];

// The firm's disbursement-authorization posture. `off`: the deciding member may act alone.
// `threshold`: a second person is required for amounts strictly above the threshold. `always`: a
// second person is required for every amount — the shipped default a firm has until it writes a
// version.
export const TRUST_AUTHORIZATION_POLICY_KINDS = ["off", "threshold", "always"] as const;
export type TrustAuthorizationPolicyKind = (typeof TRUST_AUTHORIZATION_POLICY_KINDS)[number];

// One version of the policy — or the shipped default, which has version 0 and no id because no row
// exists until a firm writes one. `id: null` therefore MEANS "the platform default: always
// two-person, no authority requirement", and it is what a pre-policy request's null stamp resolves
// to.
export interface TrustAuthorizationPolicySnapshot {
  readonly id: TrustAuthorizationPolicyId | null;
  readonly version: number;
  readonly policy: TrustAuthorizationPolicyKind;
  readonly thresholdAmountMinor: number | null;
  readonly requireAuthorizedApprover: boolean;
  readonly setBy: UserId | null;
  readonly setAt: string | null;
}

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
  readonly kind: TrustDisbursementRequestKind;
  // The operating leg's ledger-entry description — set exactly on an earned-fee application.
  readonly operatingDescription: string | null;
  // The policy version this request was submitted under; null is the shipped default (always
  // two-person). The decision triggers read this stamp, never the latest version, so a posture
  // change never re-governs a request already in flight.
  readonly policyId: TrustAuthorizationPolicyId | null;
  // Null while the request is pending — the derived state, read from the absence of a decision row.
  readonly decision: TrustDisbursementDecisionSnapshot | null;
}

// A request as the approval QUEUE serves it: the request itself, plus the matter whose ledger the
// money would leave. The matter is a caption an approver decides by — a payee and an amount do not
// say whose money is being paid out — and it is resolved from the request's own node rather than
// stated anywhere, so it can never name a matter the ledger does not belong to. All three are null
// on a request filed against a node that is not a matter leaf.
export interface TrustPendingDisbursementRequestSnapshot extends TrustDisbursementRequestSnapshot {
  readonly matterId: MatterId | null;
  readonly matterNumber: string | null;
  readonly matterTitle: string | null;
}

export interface TrustDisbursementDecisionSnapshot {
  readonly id: TrustDisbursementDecisionId;
  readonly decision: TrustDisbursementDecisionKind;
  readonly decidedBy: UserId;
  readonly decidedAt: string;
  readonly reason: string | null;
  readonly authorizationBasis: TrustDisbursementAuthorizationBasis | null;
  readonly movementId: TrustMovementId | null;
  readonly transferId: TrustTransferId | null;
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

// THE BANK-CHARGE CARVE-OUT'S CLOSED CATEGORY. Two kinds and no more: the firm putting its own
// cushion into the trust account, and the institution taking a service charge out of it. There is
// deliberately no kind that pays a person — paying somebody out of a trust account is a
// disbursement, and it goes through the disbursement queue like every other one.
export const TRUST_FIRM_FUNDS_MOVEMENT_KINDS = ["firm_funds_deposit", "bank_charge"] as const;
export type TrustFirmFundsMovementKind = (typeof TRUST_FIRM_FUNDS_MOVEMENT_KINDS)[number];

// `bank_debit` is the institution helping itself, which is what a service charge IS: no member
// released it and no instrument left the firm. It is the only method a charge may claim and the one
// method a top-up may not, so the two directions cannot wear each other's face.
export const TRUST_FIRM_FUNDS_MOVEMENT_METHODS = [
  "check",
  "wire",
  "electronic_transfer",
  "bank_debit",
] as const;
export type TrustFirmFundsMovementMethod = (typeof TRUST_FIRM_FUNDS_MOVEMENT_METHODS)[number];

export interface TrustFirmFundsMovementSnapshot {
  readonly id: TrustFirmFundsMovementId;
  readonly trustAccountId: TrustAccountId;
  readonly kind: TrustFirmFundsMovementKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly entryId: LedgerEntryId;
  readonly method: TrustFirmFundsMovementMethod;
  readonly reference: string | null;
  readonly description: string;
  readonly recordedBy: UserId;
  readonly effectiveDate: string;
  readonly recordedAt: string;
}

// The firm's own money in one trust account: the node, and what is left of the cushion. There is no
// `available` here and no hold model — a hold restricts a CLIENT's money pending a dispute, and the
// firm disputing itself is not a shape worth expressing.
export interface TrustFirmFundsPosition {
  readonly trustAccountId: TrustAccountId;
  readonly nodeId: TrustLedgerNodeId;
  readonly ledgerAccountId: LedgerAccountId;
  readonly balanceMinor: number;
  readonly currency: string;
}

// WHERE ONE TRUST ACCOUNT STANDS as of a civil day: what the bank leaf's own book says, what the
// client ledgers under it come to, what is under hold, the firm's own cushion where the account has
// one, how many client ledgers it carries and how many payments out are waiting on a decision.
//
// The three money legs are the reconciliation's own, computed from dated ledger rows rather than
// from any stored balance, so the figure a person reads on an account and the figure a period
// attests to come from one computation. `firmFundsMinor` is null — not zero — on an account that
// never opened the bank-charge carve-out: the cushion is a thing a firm opts into, and a zero would
// say it is open and empty.
export interface TrustAccountPosition {
  readonly trustAccountId: TrustAccountId;
  readonly currency: string;
  readonly asOfDate: string;
  readonly bookBalanceMinor: number;
  readonly clientLedgerTotalMinor: number;
  readonly heldMinor: number;
  readonly firmFundsMinor: number | null;
  readonly matterLedgerCount: number;
  readonly pendingRequestCount: number;
}

// ---- unclaimed and dormant client funds ----

// One matter ledger still holding money, with the two dates a firm's duty is measured from. NOTHING
// HERE IS A VERDICT: there is no `dormant` boolean, no eligibility flag, and no jurisdiction clock.
// The reader states the window they are asking about and gets back the facts; whether a balance is
// dormant, and what the firm owes about it, is the firm's judgment over its own file — which may
// include a conversation this platform never saw.
export interface TrustDormantBalance {
  readonly nodeId: TrustLedgerNodeId;
  readonly trustAccountId: TrustAccountId;
  readonly matterId: MatterId;
  readonly clientEntityId: string;
  readonly balanceMinor: number;
  readonly currency: string;
  // The effective date of the EARLIEST receipt still on this ledger. The rules' clocks run from
  // receipt of the property, not from the last thing that happened on the matter, so this is the
  // date the duty is measured from and it is deliberately a different question from the one below.
  readonly earliestReceiptDate: string | null;
  readonly lastActivityDate: string | null;
  // Whether a review is currently open over this ledger — derived from the absence of a closure row,
  // never a stored flag on the node.
  readonly openReviewId: TrustUnclaimedFundsReviewId | null;
}

export const TRUST_UNCLAIMED_FUNDS_CONTACT_CHANNELS = [
  "regular_mail",
  "certified_mail",
  "telephone",
  "email",
  "record_review",
  "other",
] as const;
export type TrustUnclaimedFundsContactChannel =
  (typeof TRUST_UNCLAIMED_FUNDS_CONTACT_CHANNELS)[number];

export const TRUST_UNCLAIMED_FUNDS_CONTACT_OUTCOMES = [
  "no_response",
  "undeliverable",
  "reached",
  "declined",
  "wrong_contact",
  "other",
] as const;
export type TrustUnclaimedFundsContactOutcome =
  (typeof TRUST_UNCLAIMED_FUNDS_CONTACT_OUTCOMES)[number];

export const TRUST_UNCLAIMED_FUNDS_REVIEW_OUTCOMES = [
  "distributed_to_owner",
  "resolved_without_distribution",
  "not_dormant",
  "search_continues",
] as const;
export type TrustUnclaimedFundsReviewOutcome =
  (typeof TRUST_UNCLAIMED_FUNDS_REVIEW_OUTCOMES)[number];

export interface TrustUnclaimedFundsContactAttemptSnapshot {
  readonly id: TrustUnclaimedFundsContactAttemptId;
  readonly reviewId: TrustUnclaimedFundsReviewId;
  readonly channel: TrustUnclaimedFundsContactChannel;
  readonly attemptedOn: string;
  readonly contactUsed: string | null;
  readonly outcome: TrustUnclaimedFundsContactOutcome;
  readonly note: string | null;
  readonly recordedBy: UserId;
  readonly recordedAt: string;
}

export interface TrustUnclaimedFundsReviewClosureSnapshot {
  readonly id: TrustUnclaimedFundsReviewClosureId;
  readonly outcome: TrustUnclaimedFundsReviewOutcome;
  // The disbursement that already paid the owner — never a movement this closure composed.
  readonly movementId: TrustMovementId | null;
  readonly closedBy: UserId;
  readonly closedAt: string;
  readonly note: string | null;
}

export interface TrustUnclaimedFundsReviewSnapshot {
  readonly id: TrustUnclaimedFundsReviewId;
  readonly trustAccountId: TrustAccountId;
  readonly nodeId: TrustLedgerNodeId;
  readonly observedBalanceMinor: number;
  readonly currency: string;
  readonly observedEarliestReceiptDate: string | null;
  readonly observedLastActivityDate: string | null;
  readonly openedBy: UserId;
  readonly openedAt: string;
  readonly note: string | null;
  readonly attempts: readonly TrustUnclaimedFundsContactAttemptSnapshot[];
  // Null while the review is open — the derived state, read from the absence of a closure row.
  readonly closure: TrustUnclaimedFundsReviewClosureSnapshot | null;
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
  // The firm's own money in this account — the permitted bank-charge cushion, and zero on every
  // account that has not enabled the carve-out. It is reported as its OWN figure and never folded
  // into the client total: the whole point of the client leg is that it is what the firm owes other
  // people, and a leg that silently included the firm's own cushion would tie out while asserting
  // that firm money is client money.
  readonly firmFundsMinor: number;
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
  readonly firmFundsMinor: number;
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

// One assertion that a bank line and a recorded entry are the same event, with both ends beside it
// and whatever became of it. Withdrawn is a fact about the assertion rather than a reason to omit
// it: that somebody paired these two and then took it back is part of what the period records.
export interface TrustReconciliationMatchRecord {
  readonly id: TrustReconciliationMatchId;
  readonly statementLineId: TrustBankStatementLineId;
  readonly entryId: LedgerEntryId;
  readonly matchedBy: UserId;
  readonly matchedAt: string;
  // Null while the assertion stands. Taken from the row that withdrew it, which is an append rather
  // than an edit, so these two are the withdrawal's own author and instant.
  readonly withdrawnBy: UserId | null;
  readonly withdrawnAt: string | null;
  readonly line: TrustBankStatementLineSnapshot;
  readonly item: TrustBankItem;
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
