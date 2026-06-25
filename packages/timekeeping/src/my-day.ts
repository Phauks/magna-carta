import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import { TIME_ENTRY_TABLE } from "./time-entry-statements.ts";

// The My Day visibility read: billable/non-billable totals for one timekeeper on one work date, with a
// target-vs-actual shortfall and un-logged-day detection. Read-only over the WIP store (never the
// ledger) and total — a missing target yields a null shortfall rather than a guess. Void entries are
// excluded so a discarded capture never colours the day. Utilization/realization roll-ups live in the
// reports surface, not here; this is the daily-driver headline.

export interface MyDayTargets {
  readonly targetDailyMinutes: number | null;
}

export interface MyDayQuery {
  readonly timekeeperUserId: UserId;
  readonly workDate: string;
  readonly targets: MyDayTargets;
}

export interface MyDayView {
  readonly billableMinutes: number;
  readonly nonBillableMinutes: number;
  readonly targetDailyMinutes: number | null;
  readonly shortfallMinutes: number | null;
  readonly unloggedDay: boolean;
}

interface TotalsRow {
  readonly billable_minutes: number | null;
  readonly non_billable_minutes: number | null;
  readonly entry_count: number;
}

export async function readMyDay(database: SqlDatabase, query: MyDayQuery): Promise<MyDayView> {
  // One grouped pass over the (timekeeper_user_id, work_date) index. COALESCE turns the empty-day SUM
  // (NULL) into 0; the billable flag splits the two totals in a single scan.
  const { results } = await database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN billable = 1 THEN duration_minutes ELSE 0 END), 0) AS billable_minutes,
         COALESCE(SUM(CASE WHEN billable = 0 THEN duration_minutes ELSE 0 END), 0) AS non_billable_minutes,
         COUNT(*) AS entry_count
       FROM ${TIME_ENTRY_TABLE}
       WHERE timekeeper_user_id = ?1 AND work_date = ?2 AND status != 'void'`,
    )
    .bind(query.timekeeperUserId, query.workDate)
    .all<TotalsRow>();
  const row = results[0];
  const billableMinutes = row?.billable_minutes ?? 0;
  const nonBillableMinutes = row?.non_billable_minutes ?? 0;
  const entryCount = row?.entry_count ?? 0;

  const targetDailyMinutes = query.targets.targetDailyMinutes;
  // Shortfall is measured against BILLABLE minutes (the headline target); a met target clamps to 0.
  const shortfallMinutes =
    targetDailyMinutes === null ? null : Math.max(0, targetDailyMinutes - billableMinutes);

  return {
    billableMinutes,
    nonBillableMinutes,
    targetDailyMinutes,
    shortfallMinutes,
    unloggedDay: entryCount === 0,
  };
}
