import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { TimeEntryId } from "@magna-carta/identifiers/types";

// The single WIP store. Only committed entries live here; an in-flight scratch timer lives in the
// per-timekeeper Durable Object, never this table. Lifecycle is a column-level freeze contract: the
// service is the only writer and validates each status transition, and a billed/void row's business
// columns are frozen (transitions live in this module, the guard lives in the service).
export const TIME_ENTRY_TABLE = "time_entry";

// Mirrors the CHECK constraint on time_entry.source — kept in sync so an invalid value is caught
// at the TypeScript boundary before it reaches the database layer.
export type TimeEntrySource =
  | "timer"
  | "manual"
  | "quick_add"
  | "grid"
  | "offline_sync"
  | "calendar";

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
  // The task this time was worked on, when the timekeeper named one. Null on nearly every row. The
  // service is what holds it to a task on this entry's OWN matter; SQLite cannot express that
  // cross-table condition without a trigger.
  readonly taskId: string | null;
  // The firm's own note — never client-facing, never copied into audit metadata.
  readonly memo: string | null;
  // The matter-scoped reference drawn at capture ("2026-0147.0042"); null where the caller draws
  // no sequence (fixtures, backfill-free historical writes). Immutable once stored.
  readonly entryNumber: string | null;
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
      `INSERT INTO ${TIME_ENTRY_TABLE} (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, task_id, invoice_id, memo, entry_number, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, 'draft', ?17, ?18, ?19, NULL, ?20, ?21, ?22, ?22, ?23)`,
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
      row.taskId,
      row.memo,
      row.entryNumber,
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
  return database.prepare(`SELECT e_billing FROM matter WHERE id = ?1`).bind(matterId);
}

// Reads the matter a task belongs to, so the service can refuse a link that crosses matters. The
// table name is spelled here rather than imported from @magna-carta/tasks: this module already reads
// `matter` the same way, and taking a package dependency for one string would make the time store
// depend on the task package to compose a SELECT.
//
// A task on NO matter comes back with a null matter_id, which is the firm's own work — nothing a
// matter's time can point at. The service reads that null as a refusal, not as a wildcard.
export function selectTaskMatterStatement(database: SqlDatabase, taskId: string): SqlStatement {
  return database.prepare(`SELECT matter_id FROM matter_task WHERE id = ?1`).bind(taskId);
}

// The entry's own matter, read only when a draft patch names a task: the cross-matter check needs
// both sides and the status pre-read deliberately carries only the status.
export function selectTimeEntryMatterStatement(
  database: SqlDatabase,
  id: TimeEntryId,
): SqlStatement {
  return database.prepare(`SELECT matter_id FROM ${TIME_ENTRY_TABLE} WHERE id = ?1`).bind(id);
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
// workDate, rateE4, rateCardId, rateSource, and amountMinor are included to support the route-level
// workDate-correction path, which re-resolves the rate for the new date and folds both into one patch.
export interface DraftPatch {
  readonly narrative?: string;
  readonly durationMinutes?: number;
  readonly rawDurationMinutes?: number;
  readonly nonBillableCategoryId?: string | null;
  readonly utbmsTaskCodeId?: string | null;
  readonly utbmsActivityCodeId?: string | null;
  readonly workDate?: string;
  readonly rateE4?: number | null;
  readonly rateCardId?: string | null;
  readonly rateSource?: string | null;
  readonly amountMinor?: number | null;
  // The internal memo. Null clears it; the text never reaches audit metadata (the audit row
  // records only WHICH fields a patch touched).
  readonly memo?: string | null;
  // The task this time was worked on. Null unlinks it. A patch naming a task is checked against the
  // entry's own matter before this statement is composed, because a matter's time must not point at
  // work on another matter and a task on NO matter is firm work with nothing to bill it to.
  readonly taskId?: string | null;
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
    work_date: patch.workDate,
    rate_e4: patch.rateE4,
    rate_card_id: patch.rateCardId,
    rate_source: patch.rateSource,
    amount_minor: patch.amountMinor,
    memo: patch.memo,
    task_id: patch.taskId,
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

/*
 * Refiling a draft onto another matter.
 *
 * Its own statement rather than a `matterId` on DraftPatch, deliberately. The matter is not one of an
 * entry's editable business columns: moving it is a CROSS-MATTER write — two ledgers change, two
 * matters' totals move, and the rate the entry froze was resolved against the matter it is leaving.
 * A patch field would let any caller that can edit a narrative also move money between matters
 * without meaning to. So the columns move together, in one guarded statement, or not at all.
 *
 * The rate travels WITH the matter for the same reason. The chain resolves matter, then client, then
 * timekeeper — so an entry that changes matters is asking a different question of it, and the answer
 * the old matter gave is not an answer about the new one. This is not the snapshot invariant
 * bending: that rule says a rate card edited later never re-rates a standing entry, which is still
 * true. The caller resolves against the destination and hands the result here.
 */
export interface RefilePatch {
  readonly matterId: string;
  readonly durationMinutes: number;
  readonly rateE4: number | null;
  readonly rateCardId: string | null;
  readonly rateSource: string | null;
  readonly amountMinor: number | null;
  readonly currency: string;
}

export function refileStatement(
  database: SqlDatabase,
  id: TimeEntryId,
  patch: RefilePatch,
  updatedAt: string,
): SqlStatement {
  // The guard is the same shape as the draft edit's and carries the same job: a row that stopped
  // being a draft between the service's read and this write matches nothing and the batch reports
  // no change, rather than moving an entry somebody has since submitted or billed. `invoice_id IS
  // NULL` is the second half of it — a claimed row is one a bill is relying on.
  return database
    .prepare(
      `UPDATE ${TIME_ENTRY_TABLE} SET matter_id = ?2, duration_minutes = ?3, rate_e4 = ?4, rate_card_id = ?5, rate_source = ?6, amount_minor = ?7, currency = ?8, updated_at = ?9 WHERE id = ?1 AND status = 'draft' AND invoice_id IS NULL`,
    )
    .bind(
      id,
      patch.matterId,
      patch.durationMinutes,
      patch.rateE4,
      patch.rateCardId,
      patch.rateSource,
      patch.amountMinor,
      patch.currency,
      updatedAt,
    );
}

// Reads the row the service guards against before composing a transition or freeze-guarded edit: the
// service needs the current status to choose the legal target and to refuse a frozen row up front (the
// WHERE-guard is the backstop; this read produces the human-facing refusal code).
export function selectTimeEntryStatusStatement(
  database: SqlDatabase,
  id: TimeEntryId,
): SqlStatement {
  return database.prepare(`SELECT status FROM ${TIME_ENTRY_TABLE} WHERE id = ?1`).bind(id);
}

// Sets the reviewer's kick-back reason text on the entry. Runs in the same batch as the status
// transition so the reason and status change are atomic. A null clears the reason (used on resubmit
// to indicate the reviewer's note has been consumed by the timekeeper's corrective resubmission).
// The NOT IN ('billed','void') clause is a defense-in-depth freeze guard: it EXCLUDES frozen rows;
// the service pre-checks frozen status before composing this statement, but a stale-read race would
// otherwise silently succeed on a frozen row.
export function setKickBackReasonStatement(
  database: SqlDatabase,
  id: TimeEntryId,
  reason: string | null,
  updatedAt: string,
): SqlStatement {
  // fitness:allow-billing-lock — NOT IN ('billed','void') is a freeze guard (excludes, not targets).
  return database
    .prepare(
      `UPDATE ${TIME_ENTRY_TABLE} SET kick_back_reason = ?2, updated_at = ?3 WHERE id = ?1 AND status NOT IN ('billed','void')`,
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
      `SELECT id, matter_id, timekeeper_user_id, work_date, duration_minutes, currency FROM ${TIME_ENTRY_TABLE} WHERE rate_card_id = ?1 AND status IN ('draft','submitted','approved') AND work_date >= ?2 AND work_date <= ?3 ORDER BY work_date`,
    )
    .bind(rateCardId, fromDate, toDate);
}
