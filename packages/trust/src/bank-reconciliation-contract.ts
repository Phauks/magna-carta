import { z } from "zod";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  MAX_BANK_RECONCILIATION_EDITS,
  MAX_BANK_RECONCILIATION_NOTE_LENGTH,
} from "./bank-reconciliation.ts";

// The bank reconciliation screen's contract: what its API accepts and returns, as plain zod. Each
// component is named with zod's own metadata (`.meta({ id })`), which the contract emitter reads as
// the component's name. Amounts are whole cents, signed where a balance can be negative; an item's
// amount is positive into the account and negative out of it.

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int();

export const BankReconciliationLine = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("entry"), entryId: z.string() }),
    z.object({ kind: z.literal("interest"), interestId: z.string() }),
  ])
  .meta({ id: "TrustBankReconciliationLine" });

export const BankReconciliationHeaderRecord = z
  .object({
    trustBankReconciliationId: z.string(),
    trustAccountId: z.string(),
    currency: z.string(),
    startDate: civilDate,
    startBalanceMinor: cents,
    startCarriedOver: z.boolean(),
    startedBy: z.string(),
    startedByName: z.string().nullable(),
    startedAt: z.string(),
    finishedBy: z.string().nullable(),
    finishedByName: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .meta({ id: "TrustBankReconciliationHeader" });

export const BankReconciliationFiguresRecord = z
  .object({
    startBalanceMinor: cents,
    depositedMinor: cents,
    withdrawnMinor: cents,
    clearedBalanceMinor: cents,
    endBalanceMinor: cents.nullable(),
    differenceMinor: cents.nullable(),
    depositCount: z.number().int(),
    depositClearedCount: z.number().int(),
    withdrawalCount: z.number().int(),
    withdrawalClearedCount: z.number().int(),
  })
  .meta({ id: "TrustBankReconciliationFigures" });

export const BANK_RECONCILIATION_ITEM_TYPES = [
  "check",
  "cash",
  "wire",
  "electronic_transfer",
  "card",
  "internal",
  "transfer",
  "bank_charge",
  "other",
] as const;

export const BankReconciliationItemRecord = z
  .object({
    entryId: z.string(),
    effectiveDate: civilDate,
    description: z.string(),
    amountMinor: cents,
    type: z.enum(BANK_RECONCILIATION_ITEM_TYPES),
    number: z.string().nullable(),
    payeeOrFrom: z.string().nullable(),
    purpose: z.string().nullable(),
    matterId: z.string().nullable(),
    matterNumber: z.string().nullable(),
    matterTitle: z.string().nullable(),
    firmFunds: z.boolean(),
    movementId: z.string().nullable(),
    transferId: z.string().nullable(),
    recordedAt: z.string(),
    isNew: z.boolean(),
    cleared: z.boolean(),
  })
  .meta({ id: "TrustBankReconciliationItem" });

export const BankReconciliationInterestRecord = z
  .object({
    interestId: z.string(),
    kind: z.enum(["credited", "swept"]),
    postedOn: civilDate,
    amountMinor: cents,
    description: z.string(),
    cleared: z.boolean(),
    recordedBy: z.string(),
    recordedAt: z.string(),
  })
  .meta({ id: "TrustBankReconciliationInterest" });

export const BankReconciliationNoteRecord = z
  .object({
    noteId: z.string(),
    line: BankReconciliationLine,
    kind: z.enum(["note", "needs_review", "resolved"]),
    body: z.string().nullable(),
    writtenBy: z.string(),
    writtenByName: z.string().nullable(),
    writtenAt: z.string(),
  })
  .meta({ id: "TrustBankReconciliationNote" });

export const BankReconciliationFileRecord = z
  .object({
    fileId: z.string(),
    name: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    recordedBy: z.string(),
    recordedAt: z.string(),
  })
  .meta({ id: "TrustBankReconciliationFile" });

export const BankReconciliationChangeRecord = z
  .object({
    changeId: z.string(),
    sequence: z.number().int(),
    kind: z.enum(["cleared", "uncleared", "end_date", "end_balance"]),
    line: BankReconciliationLine.nullable(),
    endDate: civilDate.nullable(),
    endBalanceMinor: cents.nullable(),
    cause: z.enum(["edit", "undo", "redo", "history", "restore"]),
    revertsChangeId: z.string().nullable(),
    restorePointId: z.string().nullable(),
    changedBy: z.string(),
    changedByName: z.string().nullable(),
    changedAt: z.string(),
    /** False for a change nothing can put back: the end date a period was started with. */
    canRevert: z.boolean(),
  })
  .meta({ id: "TrustBankReconciliationChange" });

export const BankReconciliationRestorePointRecord = z
  .object({
    restorePointId: z.string(),
    name: z.string(),
    atSequence: z.number().int(),
    automatic: z.boolean(),
    savedBy: z.string(),
    savedByName: z.string().nullable(),
    savedAt: z.string(),
  })
  .meta({ id: "TrustBankReconciliationRestorePoint" });

export const BankReconciliationDetailResponse = z
  .object({
    reconciliation: BankReconciliationHeaderRecord,
    endDate: civilDate,
    endBalanceMinor: cents.nullable(),
    figures: BankReconciliationFiguresRecord,
    items: z.array(BankReconciliationItemRecord),
    interest: z.array(BankReconciliationInterestRecord),
    notes: z.array(BankReconciliationNoteRecord),
    files: z.array(BankReconciliationFileRecord),
    changes: z.array(BankReconciliationChangeRecord),
    restorePoints: z.array(BankReconciliationRestorePointRecord),
    /** What Undo and Redo would reverse for the person asking, if anything. */
    undoChangeId: z.string().nullable(),
    redoChangeId: z.string().nullable(),
    version: z.number().int(),
  })
  .meta({ id: "TrustBankReconciliationDetail" });

export const BankReconciliationSummaryRecord = z
  .object({
    reconciliation: BankReconciliationHeaderRecord,
    endDate: civilDate,
    endBalanceMinor: cents.nullable(),
    depositedMinor: cents,
    withdrawnMinor: cents,
    clearedBalanceMinor: cents,
    differenceMinor: cents.nullable(),
    fileCount: z.number().int(),
    noteCount: z.number().int(),
    needsReviewCount: z.number().int(),
    interestCreditedMinor: cents,
    interestSweptMinor: cents,
  })
  .meta({ id: "TrustBankReconciliationSummary" });

export const BankReconciliationListResponse = z
  .object({
    reconciliations: z.array(BankReconciliationSummaryRecord),
    /** Where the next one starts, carried over from the last finished one; null for the first. */
    nextStart: z.object({ startDate: civilDate, startBalanceMinor: cents }).nullable(),
  })
  .meta({ id: "TrustBankReconciliationList" });

export const StartBankReconciliationRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    startDate: civilDate.nullable().optional(),
    startBalanceMinor: cents.nullable().optional(),
    endDate: civilDate,
    endBalanceMinor: cents.nullable().optional(),
  })
  .meta({ id: "StartTrustBankReconciliationRequest" });

export const StartBankReconciliationResponse = z
  .object({ trustBankReconciliationId: z.string() })
  .meta({ id: "StartTrustBankReconciliationResponse" });

export const BankReconciliationEditRecord = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("tick"), line: BankReconciliationLine, cleared: z.boolean() }),
    z.object({ kind: z.literal("end_date"), endDate: civilDate }),
    z.object({ kind: z.literal("end_balance"), endBalanceMinor: cents }),
  ])
  .meta({ id: "TrustBankReconciliationEdit" });

export const BankReconciliationEditsRequest = z
  .object({
    edits: z.array(BankReconciliationEditRecord).min(1).max(MAX_BANK_RECONCILIATION_EDITS),
  })
  .meta({ id: "TrustBankReconciliationEditsRequest" });

export const BankReconciliationRevertRequest = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("undo") }),
    z.object({ kind: z.literal("redo") }),
    z.object({ kind: z.literal("history"), changeId: z.string() }),
  ])
  .meta({ id: "TrustBankReconciliationRevertRequest" });

export const BankReconciliationSaveRequest = z
  .object({ name: z.string().min(1).max(120) })
  .meta({ id: "TrustBankReconciliationSaveRequest" });

export const BankReconciliationRestoreRequest = z
  .object({ restorePointId: z.string() })
  .meta({ id: "TrustBankReconciliationRestoreRequest" });

export const BankReconciliationInterestRequest = z
  .object({
    kind: z.enum(["credited", "swept"]),
    postedOn: civilDate,
    amountMinor: z.number().int().positive(),
    description: z.string().max(200),
    alsoSweep: z.boolean().optional(),
  })
  .meta({ id: "TrustBankReconciliationInterestRequest" });

export const BankReconciliationNoteRequest = z
  .object({
    line: BankReconciliationLine,
    kind: z.enum(["note", "needs_review", "resolved"]),
    body: z.string().max(MAX_BANK_RECONCILIATION_NOTE_LENGTH).nullable().optional(),
  })
  .meta({ id: "TrustBankReconciliationNoteRequest" });

/** The largest file kept with a period: a scanned statement of many pages. */
export const MAX_BANK_RECONCILIATION_FILE_BYTES = 25 * 1024 * 1024;

export const BankReconciliationFileRequest = z
  .object({
    name: z.string().min(1).max(255),
    contentType: z.string().min(1).max(127),
    dataBase64: z.string().min(1),
  })
  .meta({ id: "TrustBankReconciliationFileRequest" });

export const BankReconciliationAcknowledgement = z
  .object({ ok: z.literal(true) })
  .meta({ id: "TrustBankReconciliationAcknowledgement" });
