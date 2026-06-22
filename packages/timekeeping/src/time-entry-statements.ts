import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { TimeEntryId } from "@magna-carta/identifiers/types";

// The single WIP store. Only committed entries live here; an in-flight scratch timer lives in the
// per-timekeeper Durable Object, never this table. Lifecycle is a column-level freeze contract: the
// service is the only writer and validates each status transition, and a billed/void row's business
// columns are frozen (transitions live in this module, the guard lives in the service).
export const TIME_ENTRY_TABLE = "time_entry";

// Mirrors the CHECK constraint on time_entry.source — kept in sync so an invalid value is caught
// at the TypeScript boundary before it reaches the database layer.
export type TimeEntrySource = "timer" | "manual" | "quick_add" | "grid" | "offline_sync" | "calendar";

// The resolved rate snapshot the route hands in, already frozen for this entry. amount_minor and
// rate_e4 are paired by the table CHECK: both set (billable) or both null (non-billable internal time).
export interface InsertTimeEntryRow {
  readonly id: TimeEntryId;
  readonly matterId: string;
  readonly timekeeperUserId: string;
  readonly workDate: string;
  readonly durationMinutes: number;
  readonly rawDurationMinutes: number;
  readonly narrative: string;
  readonly billable: number; // 0 | 1
  readonly nonBillableCategoryId: string | null;
  readonly currency: string;
  readonly rateE4: number | null;
  readonly rateCardId: string | null;
  readonly rateSource: string | null;
  readonly amountMinor: number | null;
  readonly utbmsTaskCodeId: string | null;
  readonly utbmsActivityCodeId: string | null;
  readonly source: TimeEntrySource;
  readonly liveRunId: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

// A captured entry always enters as draft; invoice_id stays null until billing locks the row.
export function insertTimeEntryStatement(
  database: SqlDatabase,
  row: InsertTimeEntryRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TIME_ENTRY_TABLE} (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, invoice_id, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, 'draft', ?17, ?18, NULL, ?19, ?19, ?20)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.timekeeperUserId,
      row.workDate,
      row.durationMinutes,
      row.rawDurationMinutes,
      row.narrative,
      row.billable,
      row.nonBillableCategoryId,
      row.currency,
      row.rateE4,
      row.rateCardId,
      row.rateSource,
      row.amountMinor,
      row.utbmsTaskCodeId,
      row.utbmsActivityCodeId,
      row.source,
      row.liveRunId,
      row.createdAt,
      row.createdBy,
    );
}

// Reads the e_billing flag of the matter the capture binds to: an electronic-billing matter requires a
// UTBMS task code on every billable entry (the LEDES exporter at billing reads this column).
export function selectMatterEBillingStatement(
  database: SqlDatabase,
  matterId: string,
): SqlStatement {
  return database
    .prepare(`SELECT e_billing FROM matter WHERE id = ?1`)
    .bind(matterId);
}

// A guarded status transition: the WHERE status = <from> clause is the freeze backstop — a billed/void
// row never matches a pre-terminal `from`, so meta.changes === 0 means the row was not in the expected
// state (frozen, already-transitioned, or missing) and the service refuses. updated_at moves with the
// status; no business column is touched.
export function transitionStatusStatement(
  database: SqlDatabase,
  id: TimeEntryId,
  from: string,
  to: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TIME_ENTRY_TABLE} SET status = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2`,
    )
    .bind(id, from, to, updatedAt);
}

// The freeze-guarded draft edit: only a draft row matches, so a billed/void/submitted/approved row is
// untouched (meta.changes === 0) and the service refuses. Only the editable business columns move.
export interface DraftPatch {
  readonly narrative?: string;
  readonly durationMinutes?: number;
  readonly rawDurationMinutes?: number;
  readonly nonBillableCategoryId?: string | null;
  readonly utbmsTaskCodeId?: string | null;
  readonly utbmsActivityCodeId?: string | null;
}

export function updateDraftStatement(
  database: SqlDatabase,
  id: TimeEntryId,
  patch: DraftPatch,
  updatedAt: string,
): SqlStatement {
  const sets: string[] = [];
  const bindings: (string | number | null)[] = [id];
  let index = 2;
  for (const [column, value] of Object.entries({
    narrative: patch.narrative,
    duration_minutes: patch.durationMinutes,
    raw_duration_minutes: patch.rawDurationMinutes,
    non_billable_category_id: patch.nonBillableCategoryId,
    utbms_task_code_id: patch.utbmsTaskCodeId,
    utbms_activity_code_id: patch.utbmsActivityCodeId,
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
      `UPDATE ${TIME_ENTRY_TABLE} SET ${[...sets, `updated_at = ${updatedAtPlaceholder}`].join(", ")} WHERE id = ?1 AND status = 'draft'`,
    )
    .bind(...bindings);
}

// Reads the row the service guards against before composing a transition or freeze-guarded edit: the
// service needs the current status to choose the legal target and to refuse a frozen row up front (the
// WHERE-guard is the backstop; this read produces the human-facing refusal code).
export function selectTimeEntryStatusStatement(
  database: SqlDatabase,
  id: TimeEntryId,
): SqlStatement {
  return database
    .prepare(`SELECT status FROM ${TIME_ENTRY_TABLE} WHERE id = ?1`)
    .bind(id);
}

// Sets the reviewer's kick-back reason text on the entry. Runs in the same batch as the status
// transition so the reason and status change are atomic. A null clears the reason (used on resubmit
// to indicate the reviewer's note has been consumed by the timekeeper's corrective resubmission).
export function setKickBackReasonStatement(
  database: SqlDatabase,
  id: TimeEntryId,
  reason: string | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TIME_ENTRY_TABLE} SET kick_back_reason = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, reason, updatedAt);
}

// The re-rate rewrite: moves rate_e4 + amount_minor on ONE unbilled entry. Guarded to the unbilled set
// (draft/submitted/approved) so a billed/void row can never be re-rated — the captured rate is frozen.
export function reRateEntryStatement(
  database: SqlDatabase,
  id: string,
  rateE4: number,
  amountMinor: number,
  rateCardId: string,
  rateSource: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TIME_ENTRY_TABLE} SET rate_e4 = ?2, amount_minor = ?3, rate_card_id = ?4, rate_source = ?5, updated_at = ?6 WHERE id = ?1 AND status IN ('draft','submitted','approved')`,
    )
    .bind(id, rateE4, amountMinor, rateCardId, rateSource, updatedAt);
}

// The unbilled entries a re-rate revisits for a card over a work-date range. Only billable, unbilled,
// card-bound rows in range — billed/void and non-billable (null rate_card_id) are excluded by query.
export interface ReRateCandidate {
  readonly id: string;
  readonly matter_id: string;
  readonly timekeeper_user_id: string;
  readonly work_date: string;
  readonly duration_minutes: number;
  readonly currency: string;
}

export function selectReRateCandidatesStatement(
  database: SqlDatabase,
  rateCardId: string,
  fromDate: string,
  toDate: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, matter_id, timekeeper_user_id, work_date, duration_minutes, currency FROM ${TIME_ENTRY_TABLE} WHERE rate_card_id = ?1 AND status IN ('draft','submitted','approved') AND work_date >= ?2 AND work_date < ?3 ORDER BY work_date`,
    )
    .bind(rateCardId, fromDate, toDate);
}
