import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CostEntryId } from "@magna-carta/identifiers/types";

// The single WIP store for disbursements. Only committed entries live here; each row enters as draft
// and advances through the lifecycle defined in the service. Lifecycle is a column-level freeze
// contract: the service is the only writer and validates each status transition, and a billed/void
// row's business columns are frozen (transitions live in this module, the guard lives in the service).
export const COST_ENTRY_TABLE = "cost_entry";

// Mirrors the CHECK constraint on cost_entry.source — kept in sync so an invalid value is caught
// at the TypeScript boundary before it reaches the database layer.
export type CostEntrySource = "manual" | "grid" | "recovery";

// Mirrors the CHECK constraint on cost_entry.disbursement_class.
export type DisbursementClass = "hard" | "soft";

// The full shape handed in at capture time. amount_minor is integer-minor (cents-equivalent);
// the caller has already validated non-positive amounts before composing this row.
export interface InsertCostEntryRow {
  readonly id: CostEntryId;
  readonly matterId: string;
  readonly vendorId: string | null;
  readonly incurredDate: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly disbursementClass: DisbursementClass;
  readonly billable: number; // 0 | 1
  readonly utbmsExpenseCodeId: string | null;
  readonly description: string;
  readonly receiptFileId: string | null;
  readonly source: CostEntrySource;
  readonly recoveryCategory: string | null;
  readonly recoveryRef: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

// A captured cost entry always enters as draft; invoice_id stays null until billing locks the row;
// kick_back_reason starts null and is set only on reviewer rejection.
export function insertCostEntryStatement(
  database: SqlDatabase,
  row: InsertCostEntryRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COST_ENTRY_TABLE} (id, matter_id, vendor_id, incurred_date, amount_minor, currency, disbursement_class, billable, utbms_expense_code_id, description, receipt_file_id, status, kick_back_reason, source, recovery_category, recovery_ref, invoice_id, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'draft', NULL, ?12, ?13, ?14, NULL, ?15, ?15, ?16)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.vendorId,
      row.incurredDate,
      row.amountMinor,
      row.currency,
      row.disbursementClass,
      row.billable,
      row.utbmsExpenseCodeId,
      row.description,
      row.receiptFileId,
      row.source,
      row.recoveryCategory,
      row.recoveryRef,
      row.createdAt,
      row.createdBy,
    );
}

// Reads the e_billing flag of the matter the cost entry binds to: an electronic-billing matter
// requires a UTBMS expense code on every billable entry (the LEDES exporter at billing reads this).
export function selectMatterEBillingStatement(
  database: SqlDatabase,
  matterId: string,
): SqlStatement {
  return database.prepare(`SELECT e_billing FROM matter WHERE id = ?1`).bind(matterId);
}

// Reads the row the service guards against before composing a transition or freeze-guarded edit.
// Returns the current status, matter_id, and ancillary columns the service needs for refusal
// codes; the service needs the status to choose the legal target and to refuse a frozen row early
// (the WHERE-guard is the backstop; this read produces the human-facing refusal code).
export function selectCostEntryStatement(database: SqlDatabase, id: CostEntryId): SqlStatement {
  return database
    .prepare(
      `SELECT id, matter_id, status, disbursement_class, billable, receipt_file_id, kick_back_reason, invoice_id FROM ${COST_ENTRY_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// The editable draft fields — excludes status, invoice_id, and recovery_* (append-only/freeze).
// billable is included: a capture may need correcting before submission. disbursementClass is
// included: the distinction between hard and soft cost is correctable pre-approval.
export interface CostDraftPatch {
  readonly vendorId?: string | null;
  readonly incurredDate?: string;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly disbursementClass?: DisbursementClass;
  readonly billable?: number; // 0 | 1
  readonly utbmsExpenseCodeId?: string | null;
  readonly description?: string;
}

// The freeze-guarded draft edit: only a draft row matches, so a billed/void/submitted/approved row
// is untouched (meta.changes === 0) and the service refuses. Only the editable business columns
// move; status, invoice_id, and recovery_* are never touched here.
export function updateDraftCostStatement(
  database: SqlDatabase,
  id: CostEntryId,
  patch: CostDraftPatch,
  updatedAt: string,
): SqlStatement {
  const sets: string[] = [];
  const bindings: (string | number | null)[] = [id];
  let index = 2;
  for (const [column, value] of Object.entries({
    vendor_id: patch.vendorId,
    incurred_date: patch.incurredDate,
    amount_minor: patch.amountMinor,
    currency: patch.currency,
    disbursement_class: patch.disbursementClass,
    billable: patch.billable,
    utbms_expense_code_id: patch.utbmsExpenseCodeId,
    description: patch.description,
  })) {
    if (value === undefined) continue;
    sets.push(`${column} = ?${index}`);
    bindings.push(value);
    index += 1;
  }
  const updatedAtPlaceholder = `?${index}`;
  bindings.push(updatedAt);
  return database
    .prepare(
      `UPDATE ${COST_ENTRY_TABLE} SET ${[...sets, `updated_at = ${updatedAtPlaceholder}`].join(", ")} WHERE id = ?1 AND status = 'draft'`,
    )
    .bind(...bindings);
}

// A guarded status transition: the WHERE status = <from> clause is the freeze backstop — a
// billed/void row never matches a pre-terminal `from`, so meta.changes === 0 means the row was
// not in the expected state (frozen, already-transitioned, or missing) and the service refuses.
// updated_at moves with the status; no business column is touched.
export function transitionCostStatusStatement(
  database: SqlDatabase,
  id: CostEntryId,
  from: string,
  to: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COST_ENTRY_TABLE} SET status = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2`,
    )
    .bind(id, from, to, updatedAt);
}

// Sets the reviewer's kick-back reason text on the entry. Runs in the same batch as the status
// transition so the reason and status change are atomic. A null clears the reason (used on
// resubmit to signal the reviewer's note has been consumed by the submitter's corrective action).
// The NOT IN ('billed','void') clause is a defense-in-depth freeze guard: it excludes frozen rows;
// the service pre-checks frozen status before composing this statement, but a stale-read race would
// otherwise silently succeed on a frozen row.
export function setCostKickBackReasonStatement(
  database: SqlDatabase,
  id: CostEntryId,
  reason: string | null,
  updatedAt: string,
): SqlStatement {
  // fitness:allow-billing-lock — NOT IN ('billed','void') is a freeze guard (excludes, not targets).
  return database
    .prepare(
      `UPDATE ${COST_ENTRY_TABLE} SET kick_back_reason = ?2, updated_at = ?3 WHERE id = ?1 AND status NOT IN ('billed','void')`,
    )
    .bind(id, reason, updatedAt);
}

// Sets receipt_file_id on an unfrozen cost entry. Guarded to pre-terminal states so a billed/void
// row cannot have its receipt link changed after the billing lock (meta.changes === 0 on frozen row).
export function attachReceiptStatement(
  database: SqlDatabase,
  id: CostEntryId,
  fileId: string,
  updatedAt: string,
): SqlStatement {
  // fitness:allow-billing-lock — NOT IN ('billed','void') is a freeze guard (excludes, not targets).
  return database
    .prepare(
      `UPDATE ${COST_ENTRY_TABLE} SET receipt_file_id = ?2, updated_at = ?3 WHERE id = ?1 AND status NOT IN ('billed','void')`,
    )
    .bind(id, fileId, updatedAt);
}

// Clears receipt_file_id on an unfrozen cost entry. Same billing-lock guard as attachReceipt.
export function detachReceiptStatement(
  database: SqlDatabase,
  id: CostEntryId,
  updatedAt: string,
): SqlStatement {
  // fitness:allow-billing-lock — NOT IN ('billed','void') is a freeze guard (excludes, not targets).
  return database
    .prepare(
      `UPDATE ${COST_ENTRY_TABLE} SET receipt_file_id = NULL, updated_at = ?2 WHERE id = ?1 AND status NOT IN ('billed','void')`,
    )
    .bind(id, updatedAt);
}
