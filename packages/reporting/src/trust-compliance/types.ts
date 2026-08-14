import type {
  LedgerAccountId,
  LedgerEntryId,
  MatterId,
  TrustAccountId,
  TrustBankStatementId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustReconciliationId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import type {
  TrustBankStatementLineSnapshot,
  TrustFrozenProof,
  TrustThreeWayProof,
} from "@magna-carta/trust/types";
import type { ReportCompleteness } from "../completeness.ts";
import type { ReportingReproducibility } from "../temporal.ts";

// THE BAR-AUDIT PACK — what a firm hands a regulator or an examiner about one trust account.
//
// What a reader is entitled to conclude from it, stated once: for this trust account, over this
// period, as known at this instant — here is every movement of client money, here is each client's
// and each matter's ledger, here is what the firm attested to at each reconciliation, and here is
// every item that did not tie out.
//
// It is not a dashboard. Its sections mirror what the record-keeping rules require a firm to be able
// to produce: a receipts-and-disbursements journal, individual client ledgers, and the periodic
// reconciliation. Every figure in it is a re-presentation of rows the trust and ledger packages
// already own — the pack adds no arithmetic that any of them asserts.

// The corpus review state on the cover. Printing a governing-rule citation for a jurisdiction nobody
// has reviewed would assert a compliance fact the platform does not hold, so the citation is either
// resolved and quoted, or its absence is named in the corpus's own words.
export type TrustComplianceJurisdictionStatement =
  | {
      readonly available: true;
      readonly jurisdiction: string;
      readonly requirement: string;
      readonly citation: string;
      readonly binding: boolean;
    }
  | {
      readonly available: false;
      // The account's recorded jurisdiction, which is the firm's own statement of fact and is
      // printed whether or not the platform has rules for it. Null when the office recorded none.
      readonly jurisdiction: string | null;
      // The trust package's own refusal code and message, verbatim. Each of the four is fixed by a
      // different person doing a different thing, so they are never collapsed into one sentence.
      readonly refusalCode: string;
      readonly refusalDetail: string;
    };

export interface TrustCompliancePackCover {
  readonly trustAccountId: TrustAccountId;
  readonly trustAccountName: string;
  readonly locationId: string;
  readonly currency: string;
  // Whether this is the pooled interest-bearing kind of account, which changes which rules govern it.
  readonly pooledInterestBearing: boolean;
  readonly accountStatus: "open" | "closed";
  // The bank's identity as the account row carries it. A raw account number is never in a report
  // body — the last four is what the schema stores for exactly this reason.
  readonly bankName: string | null;
  readonly accountNumberLastFour: string | null;
  readonly jurisdiction: TrustComplianceJurisdictionStatement;
  // Whether the firm keeps its own money in this account under the bank-charge carve-out. On the
  // cover because it explains a book-to-client difference an examiner would otherwise ask about.
  readonly bankChargeCarveOutOpen: boolean;
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  readonly completeness: ReportCompleteness;
}

// One reconciliation, as the pack presents it: the firm's own frozen attestation, and — where they
// differ — the proof as the ledger stands now, beside it and labelled.
export interface TrustCompliancePackReconciliation {
  readonly reconciliationId: TrustReconciliationId;
  readonly statementId: TrustBankStatementId;
  readonly statementPeriodStart: string;
  readonly statementPeriodEnd: string;
  readonly statementReference: string | null;
  readonly openedBy: UserId;
  readonly openedAt: string;
  // As the reconciliation stood at the pack's knowledge instant. A reconciliation closed after that
  // instant reads as open here, and its attestation is absent — printing it would be printing
  // knowledge from after the moment the pack claims to be taken at.
  readonly statusAsKnown: "open" | "closed";
  readonly closedBy: UserId | null;
  readonly closedAt: string | null;
  // What the firm attested to. Null while the reconciliation was still open at the knowledge instant.
  // It never moves: the reconciliation freeze is one-way, so a backdated posting made afterwards
  // cannot rewrite it, and re-running the same triple returns exactly these integers.
  readonly frozenProof: TrustFrozenProof | null;
  // THE LEDGER AS IT STOOD WHEN THE PACK WAS PRODUCED — deliberately NOT bounded by the pack's
  // knowledge instant, and the one part of the document that is not.
  //
  // The three-way proof is owned by the trust package and this pack calls it rather than re-deriving
  // it, which is the rule that stops the reporting surface contradicting the reconciliation. That
  // function computes over everything recorded, and takes no knowledge instant. Giving this section
  // one would mean writing a second implementation of the proof here — the single thing a report
  // must never do — so the pack does the honest thing instead: it prints the figure, stamps the
  // instant it was computed at, and says on its own face that this section alone does not
  // reproduce. Every other figure in the pack does.
  readonly proofAtProduction: TrustCompliancePackProofAtProduction;
}

export interface TrustCompliancePackProofAtProduction {
  readonly computedAt: string;
  // Always false, and stated rather than implied: a reader deciding whether two copies of this pack
  // should agree needs to know which section is allowed to differ.
  readonly boundedByKnowledgeInstant: false;
  readonly proof: TrustThreeWayProof;
  // The differences between the attestation and the proof at production, leg by leg — never a third
  // figure standing in for either. Empty when they agree, and empty when there is no attestation to
  // compare against. A backdated posting into a closed reconciliation's period is legal and moves
  // the proof; this is the surface on which a firm sees that it did.
  readonly differencesFromAttestation: readonly TrustComplianceProofDifference[];
}

export interface TrustComplianceProofDifference {
  readonly leg:
    | "statement-closing"
    | "outstanding-deposits"
    | "outstanding-disbursements"
    | "adjusted-bank"
    | "book-balance"
    | "client-total"
    | "firm-funds";
  readonly attestedMinor: number;
  readonly liveMinor: number;
  readonly differenceMinor: number;
}

export interface TrustCompliancePackLedgerEntry {
  readonly entryId: LedgerEntryId;
  readonly effectiveDate: string;
  readonly recordedAt: string;
  readonly description: string;
  // Present when this entry reverses another. A correction here is never an edit: the reversal
  // stands beside the entry it reverses and both are printed.
  readonly reversesEntryId: LedgerEntryId | null;
  readonly direction: "debit" | "credit";
  readonly amountMinor: number;
  // Signed in client-liability terms: a credit increases what the firm owes this client.
  readonly deltaMinor: number;
  readonly runningBalanceMinor: number;
  readonly movementId: TrustMovementId | null;
  readonly movementKind: string | null;
  readonly method: string | null;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
  readonly purpose: string | null;
  readonly transferId: TrustTransferId | null;
  // Who released the money, where the ledger records it. Omitted when the pack is produced with
  // authorizers suppressed.
  readonly authorizedBy: UserId | null;
  readonly recordedBy: UserId | null;
}

export interface TrustCompliancePackMatterLedger {
  readonly nodeId: TrustLedgerNodeId;
  readonly matterId: MatterId | null;
  readonly ledgerAccountId: LedgerAccountId;
  readonly openingBalanceMinor: number;
  readonly closingBalanceMinor: number;
  readonly entries: readonly TrustCompliancePackLedgerEntry[];
}

export interface TrustCompliancePackClientLedger {
  // The entity handle is the identity; a display name is a caption that can be renamed under the
  // report, so the pack carries the handle and leaves the name to the renderer.
  readonly clientEntityId: string | null;
  readonly openingBalanceMinor: number;
  readonly closingBalanceMinor: number;
  readonly matters: readonly TrustCompliancePackMatterLedger[];
}

export interface TrustCompliancePackJournalEntry {
  readonly entryId: LedgerEntryId;
  readonly effectiveDate: string;
  readonly recordedAt: string;
  readonly description: string;
  readonly reversesEntryId: LedgerEntryId | null;
  // Signed against the bank leaf, which is an asset: a debit adds, a credit subtracts.
  readonly bankDeltaMinor: number;
  readonly runningBalanceMinor: number;
  readonly movementId: TrustMovementId | null;
  readonly movementKind: string | null;
  readonly transferId: TrustTransferId | null;
  readonly firmFundsMovementId: string | null;
  readonly firmFundsMovementKind: string | null;
  readonly method: string | null;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
  readonly purpose: string | null;
  readonly nodeId: TrustLedgerNodeId | null;
  readonly counterpartyNodeId: TrustLedgerNodeId | null;
  readonly authorizedBy: UserId | null;
  readonly recordedBy: UserId | null;
}

export interface TrustCompliancePackJournal {
  readonly openingBalanceMinor: number;
  readonly closingBalanceMinor: number;
  readonly entries: readonly TrustCompliancePackJournalEntry[];
}

export interface TrustCompliancePackCushionMovement {
  readonly firmFundsMovementId: string;
  readonly kind: "firm_funds_deposit" | "bank_charge";
  readonly effectiveDate: string;
  readonly recordedAt: string;
  readonly amountMinor: number;
  readonly method: string;
  readonly reference: string | null;
  readonly description: string;
  readonly recordedBy: UserId;
}

// The firm's own money in the account. ABSENT — not zero — on an account that never opened the
// carve-out: a zero would say the firm keeps a cushion here and it happens to be empty, which is a
// different fact from the firm keeping none.
export interface TrustCompliancePackCushion {
  readonly nodeId: TrustLedgerNodeId;
  readonly openingBalanceMinor: number;
  readonly closingBalanceMinor: number;
  readonly movements: readonly TrustCompliancePackCushionMovement[];
}

export interface TrustCompliancePackHold {
  readonly holdId: TrustHoldId;
  readonly nodeId: TrustLedgerNodeId;
  readonly matterId: MatterId | null;
  readonly clientEntityId: string | null;
  readonly amountMinor: number;
  readonly reason: string;
  readonly placedAt: string;
  readonly placedBy: UserId | null;
}

export interface TrustCompliancePackStoredBalanceDisagreement {
  readonly ledgerAccountId: LedgerAccountId;
  readonly storedBalanceMinor: number;
  readonly computedBalanceMinor: number;
}

export interface TrustCompliancePackExceptions {
  // Holds are answered on the KNOWLEDGE axis alone: a hold row carries `placed_at` and no effective
  // date, so "in force at the period end" is a question the data cannot answer and the pack does not
  // pretend to. This list is as at the knowledge instant, the field name says so, and it reproduces.
  readonly holdsInForceAtKnowledgeInstant: readonly TrustCompliancePackHold[];
  // The exceptions whose owning reads have no knowledge axis, grouped so a reader can see at a
  // glance which part of this section reproduces and which does not.
  readonly atProduction: TrustCompliancePackExceptionsAtProduction;
}

// THE EXCEPTIONS THAT ARE NOT BOUNDED BY THE KNOWLEDGE INSTANT, and why they are grouped rather than
// scattered through the section.
//
// Each of these is read through the function that OWNS it — the trust package's outstanding-item
// statement, the same list the reconciliation adjusts by; the unmatched statement lines the
// three-way proof reports; the ledger's own stored-balance fitness query. None of those takes a
// knowledge instant, and giving them one here would mean writing a second definition of
// "outstanding", of "unmatched", and of "the stored balance disagrees with its lines". A firm that
// cleared an item against a second definition would clear one the proof still counted as in transit.
//
// So the pack keeps the one definition and is explicit about the cost: these three lists are as they
// stood when the document was produced, and they are the only part of the exceptions section that
// can differ between two runs of the same period.
export interface TrustCompliancePackExceptionsAtProduction {
  readonly computedAt: string;
  readonly boundedByKnowledgeInstant: false;
  // Recorded on or before the period end and not tied to any bank statement line.
  readonly outstandingBankItems: readonly TrustComplianceOutstandingItem[];
  // Statement lines nobody tied to a recorded entry, per reconciliation in the period. Frequently the
  // bank fee or returned deposit the firm never recorded, which is the most valuable thing a
  // reconciliation finds.
  readonly unmatchedStatementLines: readonly TrustComplianceUnmatchedLine[];
  // The ledger's own fitness query, narrowed to this account's accounts. Expected to be empty; a row
  // here is corruption, and a pack that hid it would be hiding the one thing an examiner most needs
  // to see.
  readonly storedBalanceDisagreements: readonly TrustCompliancePackStoredBalanceDisagreement[];
}

export interface TrustComplianceOutstandingItem {
  readonly entryId: LedgerEntryId;
  readonly effectiveDate: string;
  readonly description: string;
  readonly bankDeltaMinor: number;
  readonly movementId: TrustMovementId | null;
  readonly transferId: TrustTransferId | null;
  readonly reference: string | null;
  readonly counterpartyName: string | null;
}

export interface TrustComplianceUnmatchedLine {
  readonly reconciliationId: TrustReconciliationId;
  readonly line: TrustBankStatementLineSnapshot;
}

export interface TrustCompliancePackProvenance {
  // Who asked for it. Null on a read served straight to a screen, where the session is the record;
  // a filed production always carries one.
  readonly requestedBy: UserId | null;
  readonly computedAt: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly knownAsOf: string | null;
  // The shape of the document, so a pack produced under one arrangement of sections is
  // distinguishable from one produced under another. It is not a package version number: what a
  // reader needs to know is whether the document they hold is laid out the way the one beside it is.
  readonly packShapeVersion: number;
  // What the pack was produced with, stated rather than implied — each of these is an owner's choice
  // about what the document says, not a computation.
  readonly options: TrustCompliancePackOptionsRecord;
}

export interface TrustCompliancePackOptionsRecord {
  readonly zeroBalanceLedgers: "include" | "omit";
  readonly authorizers: "include" | "omit";
}

export interface TrustCompliancePack {
  readonly cover: TrustCompliancePackCover;
  // Every reconciliation whose statement period ends inside the report period. Empty is a real
  // answer and the pack says so in words rather than leaving a blank section.
  readonly reconciliations: readonly TrustCompliancePackReconciliation[];
  readonly reconciliationNote: string | null;
  // The sentence the reconciliation section carries about its own two figures: which leads, and
  // which is allowed to differ between two runs of the same period.
  readonly proofAtProductionNote: string;
  readonly clientLedgers: readonly TrustCompliancePackClientLedger[];
  readonly journal: TrustCompliancePackJournal;
  readonly cushion: TrustCompliancePackCushion | null;
  readonly exceptions: TrustCompliancePackExceptions;
  readonly provenance: TrustCompliancePackProvenance;
}
