import {
  addCalendarDays,
  CIVIL_DATE_PATTERN,
  type CivilDate,
} from "@magna-carta/civil-time/civil-date";
import {
  guarded,
  type EffectStatement,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  LedgerEntryId,
  TrustAccountId,
  TrustBankReconciliationChangeId,
  TrustBankReconciliationFileId,
  TrustBankReconciliationId,
  TrustBankReconciliationInterestId,
  TrustBankReconciliationNoteId,
  TrustBankReconciliationRestorePointId,
  UserId,
} from "@magna-carta/identifiers/types";
import { loadTrustAccount, type TrustServiceOptions } from "./account-tree.ts";
import { liveTrustCheckNumberExpression } from "./check-statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import {
  computeBankReconciliationFigures,
  interestTotalMinor,
  type BankReconciliationFigures,
} from "./bank-reconciliation-figures.ts";

export { computeBankReconciliationFigures, type BankReconciliationFigures };

// BANK RECONCILIATION, the way QuickBooks does it. A person types the statement's end date and end
// balance, ticks each book item the statement shows, and finishes when the difference is zero:
//
//   cleared balance = start balance + cleared deposits - cleared withdrawals
//   difference      = end balance - cleared balance
//
// A "book item" is a ledger entry that moved the account's bank balance, whatever composed it, the
// same definition the three-way proof uses. IOLTA interest is the one kind of line the book does not
// hold: the bank credits it and sweeps it to the bar foundation, it belongs to no matter, and it is
// kept here, on the period, never in a client ledger.
//
// Every tick, untick and change of end date or end balance is a change row, numbered in order. The
// state of a period is those rows folded in order, so History is the list itself, Undo writes the
// opposite of a change, and a restore point is a number in that order. Nothing here locks the
// account: an item recorded while a period is open simply appears, marked new.
//
// A period's row changes once, at its finish, which freezes its figures and copies what it cleared
// into trust_bank_reconciliation_cleared. That table's key is what stops one item being cleared in
// two finished periods. The figures are frozen whatever the difference: a finish that refused a
// difference would leave the period open forever, which is no record at all.

const RECONCILIATION_TABLE = "trust_bank_reconciliation";
const CHANGE_TABLE = "trust_bank_reconciliation_change";
const RESTORE_POINT_TABLE = "trust_bank_reconciliation_restore_point";
const INTEREST_TABLE = "trust_bank_reconciliation_interest";
const NOTE_TABLE = "trust_bank_reconciliation_note";
const FILE_TABLE = "trust_bank_reconciliation_file";
const CLEARED_TABLE = "trust_bank_reconciliation_cleared";
const LEDGER_ENTRY_TABLE = "ledger_entry";
const LEDGER_LINE_TABLE = "ledger_line";
const TRUST_MOVEMENT_TABLE = "trust_movement";
const TRUST_TRANSFER_TABLE = "trust_transfer";
const TRUST_FIRM_FUNDS_MOVEMENT_TABLE = "trust_firm_funds_movement";
const TRUST_LEDGER_NODE_TABLE = "trust_ledger_node";
const MATTER_TABLE = "matter";
const MEMBER_TABLE = "member";

/** The most book items one period lists. One past it is read so a cut-off list is refused, never shown short. */
export const MAX_BANK_RECONCILIATION_ITEMS = 5_000;
/** The most changes one period may hold. */
export const MAX_BANK_RECONCILIATION_CHANGES = 50_000;
/** The most edits one request may carry. */
export const MAX_BANK_RECONCILIATION_EDITS = 500;
/** The longest note. */
export const MAX_BANK_RECONCILIATION_NOTE_LENGTH = 4_000;

/** What kind of payment a line was, for the type filter. */
export type BankReconciliationItemType =
  | "check"
  | "cash"
  | "wire"
  | "electronic_transfer"
  | "card"
  | "internal"
  | "transfer"
  | "bank_charge"
  | "other";

export type BankReconciliationLineKey =
  | { readonly kind: "entry"; readonly entryId: LedgerEntryId }
  | { readonly kind: "interest"; readonly interestId: TrustBankReconciliationInterestId };

export interface BankReconciliationItem {
  readonly entryId: LedgerEntryId;
  readonly effectiveDate: string;
  readonly description: string;
  /** Signed: positive into the account, negative out of it. */
  readonly amountMinor: number;
  readonly type: BankReconciliationItemType;
  readonly number: string | null;
  readonly payeeOrFrom: string | null;
  readonly purpose: string | null;
  readonly matterId: string | null;
  readonly matterNumber: string | null;
  readonly matterTitle: string | null;
  /** True for the firm's own bank-charge cushion, which belongs to no client. */
  readonly firmFunds: boolean;
  readonly movementId: string | null;
  readonly transferId: string | null;
  readonly recordedAt: string;
  /** Recorded after the period was started. */
  readonly isNew: boolean;
  readonly cleared: boolean;
}

export interface BankReconciliationInterestLine {
  readonly id: TrustBankReconciliationInterestId;
  readonly kind: "credited" | "swept";
  readonly postedOn: string;
  /** What the bank credited or swept, as a positive amount; `kind` says which way it went. */
  readonly amountMinor: number;
  readonly description: string;
  readonly cleared: boolean;
  readonly recordedBy: UserId;
  readonly recordedAt: string;
}

export interface BankReconciliationNote {
  readonly id: TrustBankReconciliationNoteId;
  readonly line: BankReconciliationLineKey;
  readonly kind: "note" | "needs_review" | "resolved";
  readonly body: string | null;
  readonly writtenBy: UserId;
  readonly writtenByName: string | null;
  readonly writtenAt: string;
}

export interface BankReconciliationFile {
  readonly id: TrustBankReconciliationFileId;
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly objectKey: string;
  readonly sha256: string;
  readonly recordedBy: UserId;
  readonly recordedAt: string;
}

export type BankReconciliationChangeCause = "edit" | "undo" | "redo" | "history" | "restore";

export interface BankReconciliationChange {
  readonly id: TrustBankReconciliationChangeId;
  readonly sequence: number;
  readonly kind: "cleared" | "uncleared" | "end_date" | "end_balance";
  readonly line: BankReconciliationLineKey | null;
  readonly endDate: string | null;
  readonly endBalanceMinor: number | null;
  readonly cause: BankReconciliationChangeCause;
  readonly revertsChangeId: TrustBankReconciliationChangeId | null;
  readonly restorePointId: TrustBankReconciliationRestorePointId | null;
  readonly changedBy: UserId;
  readonly changedByName: string | null;
  readonly changedAt: string;
}

export interface BankReconciliationRestorePoint {
  readonly id: TrustBankReconciliationRestorePointId;
  readonly name: string;
  readonly atSequence: number;
  readonly automatic: boolean;
  readonly savedBy: UserId;
  readonly savedByName: string | null;
  readonly savedAt: string;
}

export interface BankReconciliationHeader {
  readonly id: TrustBankReconciliationId;
  readonly trustAccountId: TrustAccountId;
  readonly currency: string;
  readonly startDate: string;
  readonly startBalanceMinor: number;
  readonly startCarriedOver: boolean;
  readonly startedBy: UserId;
  readonly startedByName: string | null;
  readonly startedAt: string;
  readonly finishedBy: UserId | null;
  readonly finishedByName: string | null;
  readonly finishedAt: string | null;
}

export interface BankReconciliationDetail {
  readonly reconciliation: BankReconciliationHeader;
  readonly endDate: string;
  readonly endBalanceMinor: number | null;
  readonly figures: BankReconciliationFigures;
  readonly items: readonly BankReconciliationItem[];
  readonly interest: readonly BankReconciliationInterestLine[];
  readonly notes: readonly BankReconciliationNote[];
  readonly files: readonly BankReconciliationFile[];
  readonly changes: readonly BankReconciliationChange[];
  readonly restorePoints: readonly BankReconciliationRestorePoint[];
  /** The latest change's number, or 0. A screen polls with it to know whether anything moved. */
  readonly version: number;
}

export interface BankReconciliationSummary {
  readonly reconciliation: BankReconciliationHeader;
  readonly endDate: string;
  readonly endBalanceMinor: number | null;
  readonly depositedMinor: number;
  readonly withdrawnMinor: number;
  readonly clearedBalanceMinor: number;
  readonly differenceMinor: number | null;
  readonly fileCount: number;
  readonly noteCount: number;
  /** Lines still marked Needs review. */
  readonly needsReviewCount: number;
  readonly interestCreditedMinor: number;
  readonly interestSweptMinor: number;
}

// ---- rows -----------------------------------------------------------------------------------------

interface ReconciliationRow {
  id: string;
  trust_account_id: string;
  currency: string;
  start_date: string;
  start_balance_minor: number;
  start_carried_over: number;
  started_by: string;
  started_by_name: string | null;
  started_at: string;
  finished_by: string | null;
  finished_by_name: string | null;
  finished_at: string | null;
  finished_end_date: string | null;
  finished_end_balance_minor: number | null;
  finished_cleared_balance_minor: number | null;
  finished_deposited_minor: number | null;
  finished_withdrawn_minor: number | null;
  finished_difference_minor: number | null;
}

interface ItemRow {
  entry_id: string;
  effective_date: string;
  description: string;
  recorded_at: string;
  bank_delta_minor: number;
  movement_id: string | null;
  movement_method: string | null;
  reference: string | null;
  counterparty_name: string | null;
  purpose: string | null;
  transfer_id: string | null;
  firm_funds_kind: string | null;
  firm_funds_method: string | null;
  firm_funds_reference: string | null;
  firm_funds_description: string | null;
  matter_id: string | null;
  matter_number: string | null;
  matter_title: string | null;
}

interface ChangeRow {
  id: string;
  sequence: number;
  kind: BankReconciliationChange["kind"];
  entry_id: string | null;
  interest_id: string | null;
  end_date: string | null;
  end_balance_minor: number | null;
  cause: BankReconciliationChangeCause;
  reverts_change_id: string | null;
  restore_point_id: string | null;
  changed_by: string;
  changed_by_name: string | null;
  changed_at: string;
}

interface InterestRow {
  id: string;
  kind: "credited" | "swept";
  posted_on: string;
  amount_minor: number;
  description: string;
  recorded_by: string;
  recorded_at: string;
}

interface NoteRow {
  id: string;
  entry_id: string | null;
  interest_id: string | null;
  kind: BankReconciliationNote["kind"];
  body: string | null;
  written_by: string;
  written_by_name: string | null;
  written_at: string;
}

interface FileRow {
  id: string;
  name: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  sha256: string;
  recorded_by: string;
  recorded_at: string;
}

interface RestorePointRow {
  id: string;
  name: string;
  at_sequence: number;
  automatic: number;
  saved_by: string;
  saved_by_name: string | null;
  saved_at: string;
}

const memberName = (column: string) =>
  `(SELECT display_name FROM ${MEMBER_TABLE} WHERE user_id = ${column})`;

const RECONCILIATION_COLUMNS = `r.id, r.trust_account_id, r.currency, r.start_date, r.start_balance_minor, r.start_carried_over, r.started_by, ${memberName("r.started_by")} AS started_by_name, r.started_at, r.finished_by, ${memberName("r.finished_by")} AS finished_by_name, r.finished_at, r.finished_end_date, r.finished_end_balance_minor, r.finished_cleared_balance_minor, r.finished_deposited_minor, r.finished_withdrawn_minor, r.finished_difference_minor`;

// ---- statements -----------------------------------------------------------------------------------

export function selectBankReconciliationStatement(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): SqlStatement {
  return database
    .prepare(`SELECT ${RECONCILIATION_COLUMNS} FROM ${RECONCILIATION_TABLE} r WHERE r.id = ?1`)
    .bind(reconciliationId);
}

export function selectBankReconciliationsForAccountStatement(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${RECONCILIATION_COLUMNS} FROM ${RECONCILIATION_TABLE} r WHERE r.trust_account_id = ?1 ORDER BY r.start_date DESC, r.started_at DESC`,
    )
    .bind(trustAccountId);
}

// The book items a period lists: every entry that moved the account's bank balance on or before the
// end date, less those a period finished BEFORE this one cleared. For a finished period, entries
// recorded after its finish are left out too, so its list reads as it did when it was finished.
export function selectBankReconciliationItemsStatement(
  database: SqlDatabase,
  input: {
    readonly reconciliationId: TrustBankReconciliationId;
    readonly bankLedgerAccountId: string;
    readonly endDate: string;
    readonly finishedAt: string | null;
  },
): SqlStatement {
  return database
    .prepare(
      `SELECT e.id AS entry_id, e.effective_date AS effective_date, e.description AS description, e.recorded_at AS recorded_at, SUM(CASE WHEN l.direction = 'debit' THEN l.amount_minor ELSE -l.amount_minor END) AS bank_delta_minor, m.id AS movement_id, m.method AS movement_method, COALESCE(NULLIF(TRIM(m.reference), ''), ${liveTrustCheckNumberExpression("m")}) AS reference, m.counterparty_name AS counterparty_name, m.purpose AS purpose, t.id AS transfer_id, f.kind AS firm_funds_kind, f.method AS firm_funds_method, f.reference AS firm_funds_reference, f.description AS firm_funds_description, mt.id AS matter_id, mt.matter_number AS matter_number, mt.title AS matter_title FROM ${LEDGER_ENTRY_TABLE} e JOIN ${LEDGER_LINE_TABLE} l ON l.entry_id = e.id AND l.account_id = ?2 LEFT JOIN ${TRUST_MOVEMENT_TABLE} m ON m.entry_id = e.id LEFT JOIN ${TRUST_TRANSFER_TABLE} t ON t.trust_entry_id = e.id LEFT JOIN ${TRUST_FIRM_FUNDS_MOVEMENT_TABLE} f ON f.entry_id = e.id LEFT JOIN ${TRUST_LEDGER_NODE_TABLE} n ON n.id = COALESCE(m.node_id, t.from_node_id) LEFT JOIN ${MATTER_TABLE} mt ON mt.id = n.matter_id WHERE e.effective_date <= ?3 AND (?4 IS NULL OR e.recorded_at <= ?4) AND NOT EXISTS (SELECT 1 FROM ${CLEARED_TABLE} c JOIN ${RECONCILIATION_TABLE} o ON o.id = c.reconciliation_id WHERE c.entry_id = e.id AND o.id <> ?1 AND o.finished_at < COALESCE(?4, '9999')) GROUP BY e.id, e.effective_date, e.description, e.recorded_at, m.id, m.method, m.reference, m.counterparty_name, m.purpose, t.id, f.kind, f.method, f.reference, f.description, mt.id, mt.matter_number, mt.title ORDER BY e.effective_date, e.recorded_at, e.id LIMIT ?5`,
    )
    .bind(
      input.reconciliationId,
      input.bankLedgerAccountId,
      input.endDate,
      input.finishedAt,
      MAX_BANK_RECONCILIATION_ITEMS + 1,
    );
}

export function selectBankReconciliationChangesStatement(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT c.id, c.sequence, c.kind, c.entry_id, c.interest_id, c.end_date, c.end_balance_minor, c.cause, c.reverts_change_id, c.restore_point_id, c.changed_by, ${memberName("c.changed_by")} AS changed_by_name, c.changed_at FROM ${CHANGE_TABLE} c WHERE c.reconciliation_id = ?1 ORDER BY c.sequence LIMIT ?2`,
    )
    .bind(reconciliationId, MAX_BANK_RECONCILIATION_CHANGES + 1);
}

export function selectBankReconciliationInterestStatement(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT i.id, i.kind, i.posted_on, i.amount_minor, i.description, i.recorded_by, i.recorded_at FROM ${INTEREST_TABLE} i WHERE i.reconciliation_id = ?1 AND i.removes_interest_id IS NULL AND NOT EXISTS (SELECT 1 FROM ${INTEREST_TABLE} x WHERE x.removes_interest_id = i.id) ORDER BY i.posted_on, i.kind, i.recorded_at, i.id`,
    )
    .bind(reconciliationId);
}

export function selectBankReconciliationNotesStatement(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT n.id, n.entry_id, n.interest_id, n.kind, n.body, n.written_by, ${memberName("n.written_by")} AS written_by_name, n.written_at FROM ${NOTE_TABLE} n WHERE n.reconciliation_id = ?1 ORDER BY n.written_at, n.id`,
    )
    .bind(reconciliationId);
}

export function selectBankReconciliationFilesStatement(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT f.id, f.name, f.content_type, f.size_bytes, f.object_key, f.sha256, f.recorded_by, f.recorded_at FROM ${FILE_TABLE} f WHERE f.reconciliation_id = ?1 AND f.removes_file_id IS NULL AND NOT EXISTS (SELECT 1 FROM ${FILE_TABLE} x WHERE x.removes_file_id = f.id) ORDER BY f.recorded_at, f.id`,
    )
    .bind(reconciliationId);
}

export function selectBankReconciliationRestorePointsStatement(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT p.id, p.name, p.at_sequence, p.automatic, p.saved_by, ${memberName("p.saved_by")} AS saved_by_name, p.saved_at FROM ${RESTORE_POINT_TABLE} p WHERE p.reconciliation_id = ?1 ORDER BY p.saved_at DESC, p.id DESC`,
    )
    .bind(reconciliationId);
}

// The sequence is taken inside the insert, so two people ticking at once each get the next number
// instead of one of them being refused. Several inserts in one batch each see the ones before.
function insertChangeStatement(
  database: SqlDatabase,
  row: {
    readonly id: TrustBankReconciliationChangeId;
    readonly reconciliationId: TrustBankReconciliationId;
    readonly kind: BankReconciliationChange["kind"];
    readonly line: BankReconciliationLineKey | null;
    readonly endDate: string | null;
    readonly endBalanceMinor: number | null;
    readonly cause: BankReconciliationChangeCause;
    readonly revertsChangeId: TrustBankReconciliationChangeId | null;
    readonly restorePointId: TrustBankReconciliationRestorePointId | null;
    readonly changedBy: UserId;
    readonly changedAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CHANGE_TABLE} (id, reconciliation_id, sequence, kind, entry_id, interest_id, end_date, end_balance_minor, cause, reverts_change_id, restore_point_id, changed_by, changed_at) VALUES (?1, ?2, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM ${CHANGE_TABLE} WHERE reconciliation_id = ?2), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      row.id,
      row.reconciliationId,
      row.kind,
      row.line?.kind === "entry" ? row.line.entryId : null,
      row.line?.kind === "interest" ? row.line.interestId : null,
      row.endDate,
      row.endBalanceMinor,
      row.cause,
      row.revertsChangeId,
      row.restorePointId,
      row.changedBy,
      row.changedAt,
    );
}

// ---- pure folds -----------------------------------------------------------------------------------

/** A line's key as one string, for maps. */
export function lineKeyText(line: BankReconciliationLineKey): string {
  return line.kind === "entry" ? `entry:${line.entryId}` : `interest:${line.interestId}`;
}

export interface BankReconciliationState {
  readonly cleared: ReadonlySet<string>;
  readonly endDate: string | null;
  readonly endBalanceMinor: number | null;
}

/** The state after every change up to and including `throughSequence` (all of them when absent). */
export function foldBankReconciliationChanges(
  changes: readonly BankReconciliationChange[],
  throughSequence: number = Number.POSITIVE_INFINITY,
): BankReconciliationState {
  const cleared = new Set<string>();
  let endDate: string | null = null;
  let endBalanceMinor: number | null = null;
  for (const change of changes) {
    if (change.sequence > throughSequence) break;
    if (change.kind === "end_date") endDate = change.endDate;
    else if (change.kind === "end_balance") endBalanceMinor = change.endBalanceMinor;
    else if (change.line !== null) {
      const key = lineKeyText(change.line);
      if (change.kind === "cleared") cleared.add(key);
      else cleared.delete(key);
    }
  }
  return { cleared, endDate, endBalanceMinor };
}

type ChangeValue =
  | { readonly kind: "cleared" | "uncleared"; readonly line: BankReconciliationLineKey }
  | { readonly kind: "end_date"; readonly endDate: string }
  | { readonly kind: "end_balance"; readonly endBalanceMinor: number };

/** The change that puts back what `target` replaced, or null when there was nothing before it. */
export function inverseOfChange(
  changes: readonly BankReconciliationChange[],
  target: BankReconciliationChange,
): ChangeValue | null {
  if (target.kind === "cleared" || target.kind === "uncleared") {
    if (target.line === null) return null;
    return { kind: target.kind === "cleared" ? "uncleared" : "cleared", line: target.line };
  }
  const before = foldBankReconciliationChanges(changes, target.sequence - 1);
  if (target.kind === "end_date") {
    return before.endDate === null ? null : { kind: "end_date", endDate: before.endDate };
  }
  return before.endBalanceMinor === null
    ? null
    : { kind: "end_balance", endBalanceMinor: before.endBalanceMinor };
}

/**
 * What Undo and Redo would reverse for one person, from their own changes in order. A plain change
 * goes on the undo stack and empties the redo stack; an undo moves the top of the undo stack to the
 * redo stack; a redo moves it back. Other people's changes, history reverts of an older change and
 * restores are not on anyone's stack. A change with nothing before it (the end date the period was
 * started with) cannot be undone.
 */
export function undoRedoTargets(
  changes: readonly BankReconciliationChange[],
  userId: UserId,
): {
  readonly undo: BankReconciliationChange | null;
  readonly redo: BankReconciliationChange | null;
} {
  const undoStack: BankReconciliationChange[] = [];
  const redoStack: BankReconciliationChange[] = [];
  for (const change of changes) {
    if (change.changedBy !== userId) continue;
    if (change.cause === "edit") {
      if (inverseOfChange(changes, change) === null) continue;
      undoStack.push(change);
      redoStack.length = 0;
    } else if (change.cause === "undo") {
      if (undoStack.at(-1)?.id === change.revertsChangeId) {
        undoStack.pop();
        redoStack.push(change);
      }
    } else if (change.cause === "redo") {
      if (redoStack.at(-1)?.id === change.revertsChangeId) {
        redoStack.pop();
        undoStack.push(change);
      }
    } else if (change.cause === "history") {
      redoStack.length = 0;
    }
  }
  return { undo: undoStack.at(-1) ?? null, redo: redoStack.at(-1) ?? null };
}

// ---- reads ----------------------------------------------------------------------------------------

function toHeader(row: ReconciliationRow): BankReconciliationHeader {
  return {
    id: row.id as TrustBankReconciliationId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    currency: row.currency,
    startDate: row.start_date,
    startBalanceMinor: row.start_balance_minor,
    startCarriedOver: row.start_carried_over === 1,
    startedBy: row.started_by as UserId,
    startedByName: row.started_by_name,
    startedAt: row.started_at,
    finishedBy: row.finished_by as UserId | null,
    finishedByName: row.finished_by_name,
    finishedAt: row.finished_at,
  };
}

function toChange(row: ChangeRow): BankReconciliationChange {
  return {
    id: row.id as TrustBankReconciliationChangeId,
    sequence: row.sequence,
    kind: row.kind,
    line:
      row.entry_id !== null
        ? { kind: "entry", entryId: row.entry_id as LedgerEntryId }
        : row.interest_id !== null
          ? { kind: "interest", interestId: row.interest_id as TrustBankReconciliationInterestId }
          : null,
    endDate: row.end_date,
    endBalanceMinor: row.end_balance_minor,
    cause: row.cause,
    revertsChangeId: row.reverts_change_id as TrustBankReconciliationChangeId | null,
    restorePointId: row.restore_point_id as TrustBankReconciliationRestorePointId | null,
    changedBy: row.changed_by as UserId,
    changedByName: row.changed_by_name,
    changedAt: row.changed_at,
  };
}

function itemType(row: ItemRow): BankReconciliationItemType {
  if (row.firm_funds_kind === "bank_charge") return "bank_charge";
  if (row.transfer_id !== null) return "transfer";
  const method = row.movement_method ?? row.firm_funds_method;
  switch (method) {
    case "check":
    case "cash":
    case "wire":
    case "electronic_transfer":
    case "card":
    case "internal":
      return method;
    default:
      return "other";
  }
}

async function readHeaderRow(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): Promise<ReconciliationRow> {
  const { results } = await selectBankReconciliationStatement(
    database,
    reconciliationId,
  ).all<ReconciliationRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-bank-reconciliation",
      `no such trust bank reconciliation: ${reconciliationId}`,
    );
  }
  return row;
}

export async function readTrustBankReconciliation(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): Promise<BankReconciliationDetail> {
  const row = await readHeaderRow(database, reconciliationId);
  const header = toHeader(row);
  const account = await loadTrustAccount(database, header.trustAccountId);

  const [changeRows, interestRows, noteRows, fileRows, pointRows] = await Promise.all([
    selectBankReconciliationChangesStatement(database, reconciliationId).all<ChangeRow>(),
    selectBankReconciliationInterestStatement(database, reconciliationId).all<InterestRow>(),
    selectBankReconciliationNotesStatement(database, reconciliationId).all<NoteRow>(),
    selectBankReconciliationFilesStatement(database, reconciliationId).all<FileRow>(),
    selectBankReconciliationRestorePointsStatement(
      database,
      reconciliationId,
    ).all<RestorePointRow>(),
  ]);
  if (changeRows.results.length > MAX_BANK_RECONCILIATION_CHANGES) {
    throw new TrustValidationError(
      "bank-reconciliation-too-large",
      `this reconciliation has more than ${MAX_BANK_RECONCILIATION_CHANGES} changes`,
    );
  }
  const changes = changeRows.results.map(toChange);
  const state = foldBankReconciliationChanges(changes);
  const endDate = row.finished_end_date ?? state.endDate ?? header.startDate;
  const endBalanceMinor =
    row.finished_at !== null ? row.finished_end_balance_minor : state.endBalanceMinor;

  const { results: itemRows } = await selectBankReconciliationItemsStatement(database, {
    reconciliationId,
    bankLedgerAccountId: account.bankLedgerAccountId,
    endDate,
    finishedAt: row.finished_at,
  }).all<ItemRow>();
  if (itemRows.length > MAX_BANK_RECONCILIATION_ITEMS) {
    throw new TrustValidationError(
      "bank-reconciliation-too-large",
      `this reconciliation would list more than ${MAX_BANK_RECONCILIATION_ITEMS} items`,
    );
  }

  const items: BankReconciliationItem[] = itemRows.map((item) => {
    const firmFunds = item.firm_funds_kind !== null;
    const type = itemType(item);
    return {
      entryId: item.entry_id as LedgerEntryId,
      effectiveDate: item.effective_date,
      description: item.description,
      amountMinor: item.bank_delta_minor,
      type,
      number: item.reference ?? item.firm_funds_reference,
      payeeOrFrom: item.counterparty_name,
      purpose: item.purpose ?? item.firm_funds_description,
      matterId: item.matter_id,
      matterNumber: item.matter_number,
      matterTitle: item.matter_title,
      firmFunds,
      movementId: item.movement_id,
      transferId: item.transfer_id,
      recordedAt: item.recorded_at,
      isNew: item.recorded_at > header.startedAt,
      cleared: state.cleared.has(`entry:${item.entry_id}`),
    };
  });

  const interest: BankReconciliationInterestLine[] = interestRows.results.map((line) => ({
    id: line.id as TrustBankReconciliationInterestId,
    kind: line.kind,
    postedOn: line.posted_on,
    amountMinor: line.amount_minor,
    description: line.description,
    cleared: state.cleared.has(`interest:${line.id}`),
    recordedBy: line.recorded_by as UserId,
    recordedAt: line.recorded_at,
  }));

  const computed = computeBankReconciliationFigures(
    header.currency,
    header.startBalanceMinor,
    endBalanceMinor,
    items,
    interest,
  );
  // A finished period answers with what it froze, which the live fold agrees with because nothing
  // can change after the finish; the frozen figures are the record either way.
  const figures: BankReconciliationFigures =
    row.finished_at === null
      ? computed
      : {
          ...computed,
          depositedMinor: row.finished_deposited_minor ?? computed.depositedMinor,
          withdrawnMinor: row.finished_withdrawn_minor ?? computed.withdrawnMinor,
          clearedBalanceMinor: row.finished_cleared_balance_minor ?? computed.clearedBalanceMinor,
          differenceMinor: row.finished_difference_minor ?? computed.differenceMinor,
        };

  return {
    reconciliation: header,
    endDate,
    endBalanceMinor,
    figures,
    items,
    interest,
    notes: noteRows.results.map((note) => ({
      id: note.id as TrustBankReconciliationNoteId,
      line:
        note.entry_id !== null
          ? { kind: "entry", entryId: note.entry_id as LedgerEntryId }
          : {
              kind: "interest",
              interestId: note.interest_id as TrustBankReconciliationInterestId,
            },
      kind: note.kind,
      body: note.body,
      writtenBy: note.written_by as UserId,
      writtenByName: note.written_by_name,
      writtenAt: note.written_at,
    })),
    files: fileRows.results.map((file) => ({
      id: file.id as TrustBankReconciliationFileId,
      name: file.name,
      contentType: file.content_type,
      sizeBytes: file.size_bytes,
      objectKey: file.object_key,
      sha256: file.sha256,
      recordedBy: file.recorded_by as UserId,
      recordedAt: file.recorded_at,
    })),
    changes,
    restorePoints: pointRows.results.map((point) => ({
      id: point.id as TrustBankReconciliationRestorePointId,
      name: point.name,
      atSequence: point.at_sequence,
      automatic: point.automatic === 1,
      savedBy: point.saved_by as UserId,
      savedByName: point.saved_by_name,
      savedAt: point.saved_at,
    })),
    version: changes.at(-1)?.sequence ?? 0,
  };
}

/** Which lines are marked Needs review now: the latest review mark on each line decides. */
export function linesNeedingReview(notes: readonly BankReconciliationNote[]): ReadonlySet<string> {
  const latest = new Map<string, BankReconciliationNote["kind"]>();
  for (const note of notes) {
    if (note.kind !== "note") latest.set(lineKeyText(note.line), note.kind);
  }
  return new Set([...latest].filter(([, kind]) => kind === "needs_review").map(([key]) => key));
}

export async function readTrustBankReconciliations(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<readonly BankReconciliationSummary[]> {
  await loadTrustAccount(database, trustAccountId);
  const { results } = await selectBankReconciliationsForAccountStatement(
    database,
    trustAccountId,
  ).all<ReconciliationRow>();
  // One period at most is in progress, so reading it whole costs one detail read; finished ones
  // answer from their frozen figures plus three counts.
  return Promise.all(
    results.map(async (row) => {
      const detail = await readTrustBankReconciliation(
        database,
        row.id as TrustBankReconciliationId,
      );
      return {
        reconciliation: detail.reconciliation,
        endDate: detail.endDate,
        endBalanceMinor: detail.endBalanceMinor,
        depositedMinor: detail.figures.depositedMinor,
        withdrawnMinor: detail.figures.withdrawnMinor,
        clearedBalanceMinor: detail.figures.clearedBalanceMinor,
        differenceMinor: detail.figures.differenceMinor,
        fileCount: detail.files.length,
        noteCount: detail.notes.filter((note) => note.kind === "note").length,
        needsReviewCount: linesNeedingReview(detail.notes).size,
        interestCreditedMinor: interestTotalMinor(
          detail.reconciliation.currency,
          detail.interest,
          "credited",
        ),
        interestSweptMinor: interestTotalMinor(
          detail.reconciliation.currency,
          detail.interest,
          "swept",
        ),
      };
    }),
  );
}

/** Where the next period starts: the day after the last finished one, at its end balance. */
export async function readNextBankReconciliationStart(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<{ readonly startDate: string; readonly startBalanceMinor: number } | null> {
  const { results } = await selectBankReconciliationsForAccountStatement(
    database,
    trustAccountId,
  ).all<ReconciliationRow>();
  const last = results
    .filter((row) => row.finished_end_date !== null && row.finished_end_balance_minor !== null)
    .sort((a, b) => ((a.finished_end_date ?? "") < (b.finished_end_date ?? "") ? 1 : -1))[0];
  if (!last || last.finished_end_date === null || last.finished_end_balance_minor === null) {
    return null;
  }
  return {
    startDate: dayAfter(last.finished_end_date),
    startBalanceMinor: last.finished_end_balance_minor,
  };
}

function dayAfter(civilDate: string): string {
  return addCalendarDays(civilDate as CivilDate, 1);
}

// ---- writes ---------------------------------------------------------------------------------------

export interface ComposedBankReconciliationWrite {
  readonly effect: EffectWrite;
}

function requireCivilDate(value: string, what: string): void {
  if (!CIVIL_DATE_PATTERN.test(value)) {
    throw new TrustValidationError(
      "bank-reconciliation-invalid",
      `${what} is a date in YYYY-MM-DD form; received ${value}`,
    );
  }
}

function requireWholeMinor(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TrustValidationError(
      "bank-reconciliation-invalid",
      `${what} is a whole number of cents; received ${value}`,
    );
  }
}

async function requireInProgress(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
): Promise<BankReconciliationDetail> {
  const detail = await readTrustBankReconciliation(database, reconciliationId);
  if (detail.reconciliation.finishedAt !== null) {
    throw new TrustValidationError(
      "bank-reconciliation-finished",
      "this reconciliation is finished and can no longer change",
    );
  }
  return detail;
}

export interface StartBankReconciliationInput {
  readonly trustAccountId: TrustAccountId;
  /** Typed only for an account's first period; afterwards it is carried over and must be absent. */
  readonly startDate?: string | null;
  readonly startBalanceMinor?: number | null;
  readonly endDate: string;
  readonly endBalanceMinor?: number | null;
  readonly startedBy: UserId;
}

export async function composeTrustBankReconciliationStart(
  database: SqlDatabase,
  input: StartBankReconciliationInput,
  options: TrustServiceOptions,
): Promise<
  ComposedBankReconciliationWrite & { readonly reconciliationId: TrustBankReconciliationId }
> {
  const account = await loadTrustAccount(database, input.trustAccountId);
  const carried = await readNextBankReconciliationStart(database, account.id);
  let startDate: string;
  let startBalanceMinor: number;
  if (carried !== null) {
    startDate = carried.startDate;
    startBalanceMinor = carried.startBalanceMinor;
  } else {
    if (input.startDate == null || input.startBalanceMinor == null) {
      throw new TrustValidationError(
        "bank-reconciliation-start-required",
        "the first reconciliation on an account needs the start date and start balance from the statement",
      );
    }
    startDate = input.startDate;
    startBalanceMinor = input.startBalanceMinor;
  }
  requireCivilDate(startDate, "the start date");
  requireCivilDate(input.endDate, "the end date");
  requireWholeMinor(startBalanceMinor, "the start balance");
  if (input.endBalanceMinor != null) requireWholeMinor(input.endBalanceMinor, "the end balance");
  if (input.endDate < startDate) {
    throw new TrustValidationError(
      "bank-reconciliation-invalid",
      `the end date ${input.endDate} is before the start date ${startDate}`,
    );
  }
  const existing = await readTrustBankReconciliations(database, account.id);
  if (existing.some((summary) => summary.reconciliation.finishedAt === null)) {
    throw new TrustValidationError(
      "bank-reconciliation-in-progress",
      "this account already has a reconciliation in progress; finish it first",
    );
  }

  const reconciliationId = newIdentifier("trustBankReconciliation", options.randomSource);
  const now = options.clock.now();
  const statements: SqlStatement[] = [
    database
      .prepare(
        `INSERT INTO ${RECONCILIATION_TABLE} (id, trust_account_id, currency, start_date, start_balance_minor, start_carried_over, started_by, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        reconciliationId,
        account.id,
        account.currency,
        startDate,
        startBalanceMinor,
        carried === null ? 0 : 1,
        input.startedBy,
        now,
      ),
    insertChangeStatement(database, {
      id: newIdentifier("trustBankReconciliationChange", options.randomSource),
      reconciliationId,
      kind: "end_date",
      line: null,
      endDate: input.endDate,
      endBalanceMinor: null,
      cause: "edit",
      revertsChangeId: null,
      restorePointId: null,
      changedBy: input.startedBy,
      changedAt: now,
    }),
  ];
  if (input.endBalanceMinor != null) {
    statements.push(
      insertChangeStatement(database, {
        id: newIdentifier("trustBankReconciliationChange", options.randomSource),
        reconciliationId,
        kind: "end_balance",
        line: null,
        endDate: null,
        endBalanceMinor: input.endBalanceMinor,
        cause: "edit",
        revertsChangeId: null,
        restorePointId: null,
        changedBy: input.startedBy,
        changedAt: now,
      }),
    );
  }
  return { reconciliationId, effect: { statements, outboxMessages: [] } };
}

export type BankReconciliationEdit =
  | { readonly kind: "tick"; readonly line: BankReconciliationLineKey; readonly cleared: boolean }
  | { readonly kind: "end_date"; readonly endDate: string }
  | { readonly kind: "end_balance"; readonly endBalanceMinor: number };

function lineExists(detail: BankReconciliationDetail, line: BankReconciliationLineKey): boolean {
  return line.kind === "entry"
    ? detail.items.some((item) => item.entryId === line.entryId)
    : detail.interest.some((interest) => interest.id === line.interestId);
}

/** Ticks, unticks and changes of end date or end balance, in the order given. */
export async function composeTrustBankReconciliationEdits(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  edits: readonly BankReconciliationEdit[],
  changedBy: UserId,
  options: TrustServiceOptions,
): Promise<ComposedBankReconciliationWrite> {
  if (edits.length === 0 || edits.length > MAX_BANK_RECONCILIATION_EDITS) {
    throw new TrustValidationError(
      "bank-reconciliation-invalid",
      `one save carries between 1 and ${MAX_BANK_RECONCILIATION_EDITS} changes`,
    );
  }
  const detail = await requireInProgress(database, reconciliationId);
  const now = options.clock.now();
  const statements = edits.map((edit) => {
    if (edit.kind === "tick") {
      if (!lineExists(detail, edit.line)) {
        throw new TrustValidationError(
          "bank-reconciliation-unknown-line",
          "that line is not part of this reconciliation",
        );
      }
    } else if (edit.kind === "end_date") {
      requireCivilDate(edit.endDate, "the end date");
      if (edit.endDate < detail.reconciliation.startDate) {
        throw new TrustValidationError(
          "bank-reconciliation-invalid",
          `the end date ${edit.endDate} is before the start date ${detail.reconciliation.startDate}`,
        );
      }
    } else requireWholeMinor(edit.endBalanceMinor, "the end balance");
    return insertChangeStatement(database, {
      id: newIdentifier("trustBankReconciliationChange", options.randomSource),
      reconciliationId,
      kind: edit.kind === "tick" ? (edit.cleared ? "cleared" : "uncleared") : edit.kind,
      line: edit.kind === "tick" ? edit.line : null,
      endDate: edit.kind === "end_date" ? edit.endDate : null,
      endBalanceMinor: edit.kind === "end_balance" ? edit.endBalanceMinor : null,
      cause: "edit",
      revertsChangeId: null,
      restorePointId: null,
      changedBy,
      changedAt: now,
    });
  });
  return { effect: { statements, outboxMessages: [] } };
}

/**
 * Undo or Redo for one person, or (with a change id) undoing any one change from History. Each
 * writes a new change that puts back what the target replaced; nothing is erased.
 */
export async function composeTrustBankReconciliationRevert(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  request:
    | { readonly kind: "undo" | "redo" }
    | { readonly kind: "history"; readonly changeId: TrustBankReconciliationChangeId },
  changedBy: UserId,
  options: TrustServiceOptions,
): Promise<
  ComposedBankReconciliationWrite & { readonly reverted: TrustBankReconciliationChangeId }
> {
  const detail = await requireInProgress(database, reconciliationId);
  let target: BankReconciliationChange | null;
  if (request.kind === "history") {
    target = detail.changes.find((change) => change.id === request.changeId) ?? null;
  } else {
    const targets = undoRedoTargets(detail.changes, changedBy);
    target = request.kind === "undo" ? targets.undo : targets.redo;
  }
  const inverse = target === null ? null : inverseOfChange(detail.changes, target);
  if (target === null || inverse === null) {
    throw new TrustValidationError(
      "bank-reconciliation-nothing-to-revert",
      request.kind === "redo" ? "there is nothing to redo" : "there is nothing to undo",
    );
  }
  return {
    reverted: target.id,
    effect: {
      statements: [
        insertChangeStatement(database, {
          id: newIdentifier("trustBankReconciliationChange", options.randomSource),
          reconciliationId,
          kind: inverse.kind,
          line: inverse.kind === "cleared" || inverse.kind === "uncleared" ? inverse.line : null,
          endDate: inverse.kind === "end_date" ? inverse.endDate : null,
          endBalanceMinor: inverse.kind === "end_balance" ? inverse.endBalanceMinor : null,
          cause: request.kind,
          revertsChangeId: target.id,
          restorePointId: null,
          changedBy,
          changedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

function insertRestorePointStatement(
  database: SqlDatabase,
  row: {
    readonly id: TrustBankReconciliationRestorePointId;
    readonly reconciliationId: TrustBankReconciliationId;
    readonly name: string;
    readonly automatic: boolean;
    readonly savedBy: UserId;
    readonly savedAt: string;
  },
): SqlStatement {
  // The point is the latest change at the moment it is written, read inside the insert.
  return database
    .prepare(
      `INSERT INTO ${RESTORE_POINT_TABLE} (id, reconciliation_id, name, at_sequence, automatic, saved_by, saved_at) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sequence), 0) FROM ${CHANGE_TABLE} WHERE reconciliation_id = ?2), ?4, ?5, ?6)`,
    )
    .bind(row.id, row.reconciliationId, row.name, row.automatic ? 1 : 0, row.savedBy, row.savedAt);
}

/** Save: a named restore point at the latest change. */
export async function composeTrustBankReconciliationSave(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  name: string,
  savedBy: UserId,
  options: TrustServiceOptions,
): Promise<
  ComposedBankReconciliationWrite & {
    readonly restorePointId: TrustBankReconciliationRestorePointId;
  }
> {
  await requireInProgress(database, reconciliationId);
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 120) {
    throw new TrustValidationError(
      "bank-reconciliation-invalid",
      "a restore point has a name of 1 to 120 characters",
    );
  }
  const restorePointId = newIdentifier("trustBankReconciliationRestorePoint", options.randomSource);
  return {
    restorePointId,
    effect: {
      statements: [
        insertRestorePointStatement(database, {
          id: restorePointId,
          reconciliationId,
          name: trimmed,
          automatic: false,
          savedBy,
          savedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Restore: put the ticks, end date and end balance back as they were at a restore point. A point is
 * saved first, by itself, so the restore can be gone back on. Notes, files and interest lines are
 * kept; an interest line added since the point stays, unticked.
 */
export async function composeTrustBankReconciliationRestore(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  restorePointId: TrustBankReconciliationRestorePointId,
  restoredBy: UserId,
  options: TrustServiceOptions,
): Promise<ComposedBankReconciliationWrite> {
  const detail = await requireInProgress(database, reconciliationId);
  const point = detail.restorePoints.find((candidate) => candidate.id === restorePointId);
  if (!point) {
    throw new TrustValidationError(
      "bank-reconciliation-unknown-restore-point",
      "no such restore point on this reconciliation",
    );
  }
  const now = options.clock.now();
  const then = foldBankReconciliationChanges(detail.changes, point.atSequence);
  const current = foldBankReconciliationChanges(detail.changes);
  const changeRow = (value: ChangeValue) =>
    insertChangeStatement(database, {
      id: newIdentifier("trustBankReconciliationChange", options.randomSource),
      reconciliationId,
      kind: value.kind,
      line: value.kind === "cleared" || value.kind === "uncleared" ? value.line : null,
      endDate: value.kind === "end_date" ? value.endDate : null,
      endBalanceMinor: value.kind === "end_balance" ? value.endBalanceMinor : null,
      cause: "restore",
      revertsChangeId: null,
      restorePointId,
      changedBy: restoredBy,
      changedAt: now,
    });

  const lines = new Map<string, BankReconciliationLineKey>();
  for (const change of detail.changes) {
    if (change.line !== null) lines.set(lineKeyText(change.line), change.line);
  }
  const statements: SqlStatement[] = [
    insertRestorePointStatement(database, {
      id: newIdentifier("trustBankReconciliationRestorePoint", options.randomSource),
      reconciliationId,
      name: `Before restoring ${point.name}`.slice(0, 120),
      automatic: true,
      savedBy: restoredBy,
      savedAt: now,
    }),
  ];
  for (const [key, line] of lines) {
    const wasCleared = then.cleared.has(key);
    if (wasCleared !== current.cleared.has(key)) {
      statements.push(changeRow({ kind: wasCleared ? "cleared" : "uncleared", line }));
    }
  }
  if (then.endDate !== null && then.endDate !== current.endDate) {
    statements.push(changeRow({ kind: "end_date", endDate: then.endDate }));
  }
  if (then.endBalanceMinor !== null && then.endBalanceMinor !== current.endBalanceMinor) {
    statements.push(changeRow({ kind: "end_balance", endBalanceMinor: then.endBalanceMinor }));
  }
  return { effect: { statements, outboxMessages: [] } };
}

export interface AddBankReconciliationInterestInput {
  readonly kind: "credited" | "swept";
  readonly postedOn: string;
  readonly amountMinor: number;
  readonly description: string;
  /** With a credit: also add the bank's sweep of the same amount, on the same date. */
  readonly alsoSweep?: boolean;
}

/** IOLTA interest lines, added already ticked: they come off the statement. */
export async function composeTrustBankReconciliationInterest(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  input: AddBankReconciliationInterestInput,
  recordedBy: UserId,
  options: TrustServiceOptions,
): Promise<
  ComposedBankReconciliationWrite & {
    readonly interestIds: readonly TrustBankReconciliationInterestId[];
  }
> {
  await requireInProgress(database, reconciliationId);
  requireCivilDate(input.postedOn, "the date on the statement");
  requireWholeMinor(input.amountMinor, "the amount");
  if (input.amountMinor <= 0) {
    throw new TrustValidationError("bank-reconciliation-invalid", "the amount is more than zero");
  }
  const description = input.description.trim();
  const lines: { kind: "credited" | "swept"; description: string }[] = [
    {
      kind: input.kind,
      description:
        description.length > 0
          ? description
          : input.kind === "credited"
            ? "Interest credited by bank"
            : "Interest swept to the bar foundation",
    },
  ];
  if (input.kind === "credited" && input.alsoSweep === true) {
    lines.push({ kind: "swept", description: "Interest swept to the bar foundation" });
  }
  const now = options.clock.now();
  const interestIds: TrustBankReconciliationInterestId[] = [];
  const statements: SqlStatement[] = [];
  for (const line of lines) {
    const id = newIdentifier("trustBankReconciliationInterest", options.randomSource);
    interestIds.push(id);
    statements.push(
      database
        .prepare(
          `INSERT INTO ${INTEREST_TABLE} (id, reconciliation_id, kind, posted_on, amount_minor, description, removes_interest_id, recorded_by, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8)`,
        )
        .bind(
          id,
          reconciliationId,
          line.kind,
          input.postedOn,
          input.amountMinor,
          line.description,
          recordedBy,
          now,
        ),
      insertChangeStatement(database, {
        id: newIdentifier("trustBankReconciliationChange", options.randomSource),
        reconciliationId,
        kind: "cleared",
        line: { kind: "interest", interestId: id },
        endDate: null,
        endBalanceMinor: null,
        cause: "edit",
        revertsChangeId: null,
        restorePointId: null,
        changedBy: recordedBy,
        changedAt: now,
      }),
    );
  }
  return { interestIds, effect: { statements, outboxMessages: [] } };
}

export async function composeTrustBankReconciliationInterestRemoval(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  interestId: TrustBankReconciliationInterestId,
  recordedBy: UserId,
  options: TrustServiceOptions,
): Promise<ComposedBankReconciliationWrite> {
  const detail = await requireInProgress(database, reconciliationId);
  const line = detail.interest.find((candidate) => candidate.id === interestId);
  if (!line) {
    throw new TrustValidationError(
      "bank-reconciliation-unknown-line",
      "that interest line is not part of this reconciliation",
    );
  }
  return {
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO ${INTEREST_TABLE} (id, reconciliation_id, kind, posted_on, amount_minor, description, removes_interest_id, recorded_by, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
          )
          .bind(
            newIdentifier("trustBankReconciliationInterest", options.randomSource),
            reconciliationId,
            line.kind,
            line.postedOn,
            line.amountMinor,
            line.description,
            interestId,
            recordedBy,
            options.clock.now(),
          ),
      ],
      outboxMessages: [],
    },
  };
}

export interface AddBankReconciliationNoteInput {
  readonly line: BankReconciliationLineKey;
  readonly kind: "note" | "needs_review" | "resolved";
  readonly body?: string | null;
}

/** A note on a line, or marking it Needs review or resolved. Allowed after the finish too. */
export async function composeTrustBankReconciliationNote(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  input: AddBankReconciliationNoteInput,
  writtenBy: UserId,
  options: TrustServiceOptions,
): Promise<ComposedBankReconciliationWrite & { readonly noteId: TrustBankReconciliationNoteId }> {
  const detail = await readTrustBankReconciliation(database, reconciliationId);
  if (!lineExists(detail, input.line)) {
    throw new TrustValidationError(
      "bank-reconciliation-unknown-line",
      "that line is not part of this reconciliation",
    );
  }
  const body = input.kind === "note" ? (input.body ?? "").trim() : null;
  if (body !== null && (body.length === 0 || body.length > MAX_BANK_RECONCILIATION_NOTE_LENGTH)) {
    throw new TrustValidationError(
      "bank-reconciliation-invalid",
      `a note has 1 to ${MAX_BANK_RECONCILIATION_NOTE_LENGTH} characters`,
    );
  }
  const noteId = newIdentifier("trustBankReconciliationNote", options.randomSource);
  return {
    noteId,
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO ${NOTE_TABLE} (id, reconciliation_id, entry_id, interest_id, kind, body, written_by, written_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
          )
          .bind(
            noteId,
            reconciliationId,
            input.line.kind === "entry" ? input.line.entryId : null,
            input.line.kind === "interest" ? input.line.interestId : null,
            input.kind,
            body,
            writtenBy,
            options.clock.now(),
          ),
      ],
      outboxMessages: [],
    },
  };
}

export interface AttachBankReconciliationFileInput {
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly objectKey: string;
  readonly sha256: string;
}

/** Keep a file with a period. The caller has already written the bytes under the key. */
export async function composeTrustBankReconciliationFile(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  input: AttachBankReconciliationFileInput,
  recordedBy: UserId,
  options: TrustServiceOptions,
): Promise<ComposedBankReconciliationWrite & { readonly fileId: TrustBankReconciliationFileId }> {
  await readHeaderRow(database, reconciliationId);
  const name = input.name.trim();
  if (name.length === 0 || name.length > 255) {
    throw new TrustValidationError(
      "bank-reconciliation-invalid",
      "a file name has 1 to 255 characters",
    );
  }
  const fileId = newIdentifier("trustBankReconciliationFile", options.randomSource);
  return {
    fileId,
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO ${FILE_TABLE} (id, reconciliation_id, name, content_type, size_bytes, object_key, sha256, removes_file_id, recorded_by, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)`,
          )
          .bind(
            fileId,
            reconciliationId,
            name,
            input.contentType,
            input.sizeBytes,
            input.objectKey,
            input.sha256,
            recordedBy,
            options.clock.now(),
          ),
      ],
      outboxMessages: [],
    },
  };
}

export async function composeTrustBankReconciliationFileRemoval(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  fileId: TrustBankReconciliationFileId,
  recordedBy: UserId,
  options: TrustServiceOptions,
): Promise<ComposedBankReconciliationWrite> {
  const detail = await requireInProgress(database, reconciliationId);
  const file = detail.files.find((candidate) => candidate.id === fileId);
  if (!file) {
    throw new TrustValidationError(
      "bank-reconciliation-unknown-file",
      "that file is not kept with this reconciliation",
    );
  }
  return {
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO ${FILE_TABLE} (id, reconciliation_id, name, content_type, size_bytes, object_key, sha256, removes_file_id, recorded_by, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
          )
          .bind(
            newIdentifier("trustBankReconciliationFile", options.randomSource),
            reconciliationId,
            file.name,
            file.contentType,
            file.sizeBytes,
            file.objectKey,
            file.sha256,
            fileId,
            recordedBy,
            options.clock.now(),
          ),
      ],
      outboxMessages: [],
    },
  };
}

/** One file of a period by id, removed or not, for downloading. */
export async function readTrustBankReconciliationFile(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  fileId: TrustBankReconciliationFileId,
): Promise<BankReconciliationFile | null> {
  const { results } = await database
    .prepare(
      `SELECT f.id, f.name, f.content_type, f.size_bytes, f.object_key, f.sha256, f.recorded_by, f.recorded_at FROM ${FILE_TABLE} f WHERE f.reconciliation_id = ?1 AND f.id = ?2 AND f.removes_file_id IS NULL`,
    )
    .bind(reconciliationId, fileId)
    .all<FileRow>();
  const file = results[0];
  return file
    ? {
        id: file.id as TrustBankReconciliationFileId,
        name: file.name,
        contentType: file.content_type,
        sizeBytes: file.size_bytes,
        objectKey: file.object_key,
        sha256: file.sha256,
        recordedBy: file.recorded_by as UserId,
        recordedAt: file.recorded_at,
      }
    : null;
}

/**
 * Finish: freeze the figures and record which items this period cleared. Needs an end balance. A
 * difference is allowed and frozen as it stands; the list shows the period as finished with a
 * difference. Any change written after the read this was composed from makes the guard abort the
 * batch, so the frozen figures are always the ones a person saw.
 */
export async function composeTrustBankReconciliationFinish(
  database: SqlDatabase,
  reconciliationId: TrustBankReconciliationId,
  finishedBy: UserId,
  options: TrustServiceOptions,
): Promise<ComposedBankReconciliationWrite & { readonly figures: BankReconciliationFigures }> {
  const detail = await requireInProgress(database, reconciliationId);
  if (detail.endBalanceMinor === null) {
    throw new TrustValidationError(
      "bank-reconciliation-end-balance-required",
      "enter the end balance from the statement before finishing",
    );
  }
  const figures = detail.figures;
  const cleared = detail.items.filter((item) => item.cleared);
  const now = options.clock.now();
  const statements: EffectStatement[] = [
    guarded(
      database
        .prepare(
          `UPDATE ${RECONCILIATION_TABLE} SET finished_by = ?2, finished_at = ?3, finished_end_date = ?4, finished_end_balance_minor = ?5, finished_cleared_balance_minor = ?6, finished_deposited_minor = ?7, finished_withdrawn_minor = ?8, finished_difference_minor = ?9 WHERE id = ?1 AND finished_at IS NULL AND (SELECT COALESCE(MAX(sequence), 0) FROM ${CHANGE_TABLE} WHERE reconciliation_id = ?1) = ?10`,
        )
        .bind(
          reconciliationId,
          finishedBy,
          now,
          detail.endDate,
          detail.endBalanceMinor,
          figures.clearedBalanceMinor,
          figures.depositedMinor,
          figures.withdrawnMinor,
          figures.differenceMinor,
          detail.version,
        ),
      "trust-bank-reconciliation.finish",
    ),
    ...cleared.map((item) =>
      database
        .prepare(`INSERT INTO ${CLEARED_TABLE} (reconciliation_id, entry_id) VALUES (?1, ?2)`)
        .bind(reconciliationId, item.entryId),
    ),
  ];
  return { figures, effect: { statements, outboxMessages: [] } };
}
