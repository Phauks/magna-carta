import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FeeEntryId } from "@magna-carta/identifiers/types";

// The single WIP store for recorded fees — a flat charge for professional services, typed by hand.
// Only committed entries live here; each row enters as draft and advances through the lifecycle
// defined in the service. Lifecycle is a column-level freeze contract: the service is the only
// writer and validates each status transition, and a billed/void row's business columns are frozen
// (transitions live in this module, the guard lives in the service).
//
// The same shape as the disbursement store, deliberately: these are two of the three things a
// matter accrues, they ride one chain, and a reader who has learned one should not have to learn
// the other. What differs is only what the domain differs on.
export const FEE_ENTRY_TABLE = "fee_entry";

// The full shape handed in at capture time. amountMinor is integer-minor (cents-equivalent); the
// caller has already validated non-positive amounts before composing this row.
export interface InsertFeeEntryRow {
  readonly id: FeeEntryId;
  readonly matterId: string;
  readonly serviceDate: string;
  readonly timekeeperUserId: string | null;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly billable: number; // 0 | 1
  readonly memo: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

// A captured fee entry always enters as draft; invoice_id stays null until billing locks the row;
// kick_back_reason starts null and is set only on reviewer rejection.
export function insertFeeEntryStatement(
  database: SqlDatabase,
  row: InsertFeeEntryRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FEE_ENTRY_TABLE} (id, matter_id, service_date, timekeeper_user_id, description, amount_minor, currency, billable, status, kick_back_reason, invoice_id, memo, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', NULL, NULL, ?9, ?10, ?10, ?11)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.serviceDate,
      row.timekeeperUserId,
      row.description,
      row.amountMinor,
      row.currency,
      row.billable,
      row.memo,
      row.createdAt,
      row.createdBy,
    );
}

// Reads the row the service guards against before composing a transition or freeze-guarded edit.
// Returns the current status, matter_id, and the ancillary columns the service needs for refusal
// codes; the service needs the status to choose the legal target and to refuse a frozen row early
// (the WHERE-guard is the backstop; this read produces the human-facing refusal code).
export function selectFeeEntryStatement(database: SqlDatabase, id: FeeEntryId): SqlStatement {
  return database
    .prepare(
      `SELECT id, matter_id, status, billable, kick_back_reason, invoice_id FROM ${FEE_ENTRY_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// The editable draft fields — excludes status and invoice_id (freeze). billable is included: a
// capture may need correcting before submission, and whether the client is asked for a charge is
// exactly the kind of decision that gets revised before anyone is billed for it.
export interface FeeDraftPatch {
  readonly serviceDate?: string;
  readonly timekeeperUserId?: string | null;
  readonly description?: string;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly billable?: number; // 0 | 1
  readonly memo?: string | null;
}

// The freeze-guarded draft edit: only a draft row matches, so a billed/void/submitted/approved row
// is untouched (meta.changes === 0) and the service refuses. Only the editable business columns
// move; status and invoice_id are never touched here.
export function updateDraftFeeStatement(
  database: SqlDatabase,
  id: FeeEntryId,
  patch: FeeDraftPatch,
  updatedAt: string,
): SqlStatement {
  const sets: string[] = [];
  const bindings: (string | number | null)[] = [id];
  let index = 2;
  for (const [column, value] of Object.entries({
    service_date: patch.serviceDate,
    timekeeper_user_id: patch.timekeeperUserId,
    description: patch.description,
    amount_minor: patch.amountMinor,
    currency: patch.currency,
    billable: patch.billable,
    memo: patch.memo,
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
      `UPDATE ${FEE_ENTRY_TABLE} SET ${[...sets, `updated_at = ${updatedAtPlaceholder}`].join(", ")} WHERE id = ?1 AND status = 'draft'`,
    )
    .bind(...bindings);
}

// A guarded status transition: the WHERE status = <from> clause is the freeze backstop — a
// billed/void row never matches a pre-terminal `from`, so meta.changes === 0 means the row was not
// in the expected state (frozen, already-transitioned, or missing) and the service refuses.
// updated_at moves with the status; no business column is touched.
export function transitionFeeStatusStatement(
  database: SqlDatabase,
  id: FeeEntryId,
  from: string,
  to: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FEE_ENTRY_TABLE} SET status = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2`,
    )
    .bind(id, from, to, updatedAt);
}

// Sets the reviewer's kick-back reason text on the entry. Runs in the same batch as the status
// transition so the reason and status change are atomic. A null clears the reason, which is what
// the next submission does: a non-null reason therefore means exactly "this draft came back and
// has not been sent again", and no surface has to date-compare anything to work that out.
export function setFeeKickBackReasonStatement(
  database: SqlDatabase,
  id: FeeEntryId,
  reason: string | null,
  updatedAt: string,
): SqlStatement {
  // fitness:allow-billing-lock — NOT IN ('billed','void') is a freeze guard (excludes, not targets).
  return database
    .prepare(
      `UPDATE ${FEE_ENTRY_TABLE} SET kick_back_reason = ?2, updated_at = ?3 WHERE id = ?1 AND status NOT IN ('billed','void')`,
    )
    .bind(id, reason, updatedAt);
}

// Removes a draft that never entered review. The status guard is the whole safety property: a fee
// that has been submitted, approved, billed or voided has a record somebody may be asked to account
// for, and it is voided rather than deleted. A draft nobody has seen has no such record, so
// deleting it outright is the honest act — and it is the one the cost ledger has been waiting on.
export function deleteDraftFeeStatement(database: SqlDatabase, id: FeeEntryId): SqlStatement {
  return database
    .prepare(`DELETE FROM ${FEE_ENTRY_TABLE} WHERE id = ?1 AND status = 'draft'`)
    .bind(id);
}
