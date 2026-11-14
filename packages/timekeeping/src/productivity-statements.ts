import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// TIME RECORDED OVER A PERIOD, grouped finely enough for every productivity roll-up: by timekeeper,
// matter, billable or not, non-billable category and task code. The work date is the period axis.
//
// LIVE ONLY. A time entry is a mutable working store until it is billed — a duration or a category is
// fixed during review, and nothing records when — so this read takes a period and no knowledge
// instant, and a caller states when it was computed.
//
// MINUTES, NEVER MONEY. A report about people is a different grant (`reports:productivity`) from a
// report about money, so this read carries no value at all; what the time was worth is the
// realization report's, on `reports:financial`.
//
// Voided entries are not time recorded and are left out. Every other status counts: a draft entry is
// still time the timekeeper says they worked.
export const MAXIMUM_TIME_RECORDED_ROWS = 10000;

// WHAT COUNTS AS TIME RECORDED IN A PERIOD, stated once for both reads here, so the productivity
// roll-ups and the day-by-day list cannot disagree about which entries are in the period.
const TIME_RECORDED_IN_PERIOD = "t.work_date BETWEEN ?1 AND ?2 AND t.status <> 'void'";

export interface TimeRecordedRow {
  readonly timekeeperUserId: string;
  readonly timekeeperName: string | null;
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly clientEntityId: string | null;
  readonly clientName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly billable: boolean;
  readonly nonBillableCategoryId: string | null;
  readonly nonBillableCategoryName: string | null;
  readonly taskCode: string | null;
  readonly taskLabel: string | null;
  readonly entryCount: number;
  readonly minutes: number;
}

export interface TimeRecordedBreakdown {
  readonly rows: readonly TimeRecordedRow[];
  readonly truncated: boolean;
}

export async function readTimeRecordedBreakdown(
  database: SqlDatabase,
  period: { readonly periodStart: string; readonly periodEnd: string },
): Promise<TimeRecordedBreakdown> {
  const { results } = await database
    .prepare(
      `SELECT t.timekeeper_user_id, mem.display_name AS timekeeper_name,
              t.matter_id, m.title AS matter_title, m.matter_number,
              (SELECT MIN(p.entity_id) FROM matter_party p
                WHERE p.matter_id = t.matter_id AND p.role = 'client') AS client_entity_id,
              m.client_display_name AS client_name,
              m.location_id, l.name AS location_name,
              t.billable, t.non_billable_category_id, c.name AS non_billable_category_name,
              u.code AS task_code, u.label AS task_label,
              COUNT(*) AS entry_count, SUM(t.duration_minutes) AS minutes
         FROM time_entry t
         JOIN matter m ON m.id = t.matter_id
         LEFT JOIN location l ON l.id = m.location_id
         LEFT JOIN member mem ON mem.user_id = t.timekeeper_user_id
         LEFT JOIN non_billable_category c ON c.id = t.non_billable_category_id
         LEFT JOIN utbms_code u ON u.id = t.utbms_task_code_id
        WHERE ${TIME_RECORDED_IN_PERIOD}
        GROUP BY t.timekeeper_user_id, t.matter_id, t.billable, t.non_billable_category_id, t.utbms_task_code_id
        ORDER BY t.timekeeper_user_id, t.matter_id
        LIMIT ?3`,
    )
    .bind(period.periodStart, period.periodEnd, MAXIMUM_TIME_RECORDED_ROWS + 1)
    .all<{
      timekeeper_user_id: string;
      timekeeper_name: string | null;
      matter_id: string;
      matter_title: string;
      matter_number: string | null;
      client_entity_id: string | null;
      client_name: string | null;
      location_id: string | null;
      location_name: string | null;
      billable: number;
      non_billable_category_id: string | null;
      non_billable_category_name: string | null;
      task_code: string | null;
      task_label: string | null;
      entry_count: number;
      minutes: number;
    }>();
  return {
    truncated: results.length > MAXIMUM_TIME_RECORDED_ROWS,
    rows: results.slice(0, MAXIMUM_TIME_RECORDED_ROWS).map((row) => ({
      timekeeperUserId: row.timekeeper_user_id,
      timekeeperName: row.timekeeper_name,
      matterId: row.matter_id,
      matterTitle: row.matter_title,
      matterNumber: row.matter_number,
      clientEntityId: row.client_entity_id,
      clientName: row.client_name,
      locationId: row.location_id,
      locationName: row.location_name,
      billable: row.billable === 1,
      nonBillableCategoryId: row.non_billable_category_id,
      nonBillableCategoryName: row.non_billable_category_name,
      taskCode: row.task_code,
      taskLabel: row.task_label,
      entryCount: row.entry_count,
      minutes: row.minutes,
    })),
  };
}

// THE SAME TIME, DAY BY DAY: per work date, timekeeper and office, billable or not. The Daily Time
// report lists it; its totals equal the breakdown's above because both take TIME_RECORDED_IN_PERIOD.
export interface TimeRecordedDayRow {
  readonly workDate: string;
  readonly timekeeperUserId: string;
  readonly timekeeperName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly billable: boolean;
  readonly entryCount: number;
  readonly minutes: number;
}

export async function readTimeRecordedByDay(
  database: SqlDatabase,
  period: { readonly periodStart: string; readonly periodEnd: string },
): Promise<{ readonly rows: readonly TimeRecordedDayRow[]; readonly truncated: boolean }> {
  const { results } = await database
    .prepare(
      `SELECT t.work_date, t.timekeeper_user_id, mem.display_name AS timekeeper_name,
              m.location_id, l.name AS location_name, t.billable,
              COUNT(*) AS entry_count, SUM(t.duration_minutes) AS minutes
         FROM time_entry t
         JOIN matter m ON m.id = t.matter_id
         LEFT JOIN location l ON l.id = m.location_id
         LEFT JOIN member mem ON mem.user_id = t.timekeeper_user_id
        WHERE ${TIME_RECORDED_IN_PERIOD}
        GROUP BY t.work_date, t.timekeeper_user_id, m.location_id, t.billable
        ORDER BY t.work_date, t.timekeeper_user_id
        LIMIT ?3`,
    )
    .bind(period.periodStart, period.periodEnd, MAXIMUM_TIME_RECORDED_ROWS + 1)
    .all<{
      work_date: string;
      timekeeper_user_id: string;
      timekeeper_name: string | null;
      location_id: string | null;
      location_name: string | null;
      billable: number;
      entry_count: number;
      minutes: number;
    }>();
  return {
    truncated: results.length > MAXIMUM_TIME_RECORDED_ROWS,
    rows: results.slice(0, MAXIMUM_TIME_RECORDED_ROWS).map((row) => ({
      workDate: row.work_date,
      timekeeperUserId: row.timekeeper_user_id,
      timekeeperName: row.timekeeper_name,
      locationId: row.location_id,
      locationName: row.location_name,
      billable: row.billable === 1,
      entryCount: row.entry_count,
      minutes: row.minutes,
    })),
  };
}
