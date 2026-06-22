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
