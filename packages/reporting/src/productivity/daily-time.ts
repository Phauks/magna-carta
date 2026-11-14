import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readTimeRecordedByDay,
  type TimeRecordedDayRow,
} from "@magna-carta/timekeeping/productivity-statements";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import { resolveLiveOnlyPeriod } from "../temporal.ts";
import { productivityStatement, Tally, type ProductivityFigures } from "./timekeeper-productivity.ts";

// DAILY TIME — how much time was recorded on each day of a period, and by whom, billable against
// non-billable. Minutes only, never money, and no target: the same footing as Timekeeper
// Productivity, on the same permission.
//
// The rows are timekeeping's day-by-day read, which takes the same entries as the productivity
// breakdown through one shared predicate; test/productivity-daily-time.test.ts proves the totals
// equal Timekeeper Productivity's for the same period. LIVE ONLY, as that report is.

export interface DailyTimeReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly computedAt: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly completeness: ReportCompleteness;
  readonly totals: ProductivityFigures;
  // Every day that has time on it, oldest first, each with its timekeepers.
  readonly days: readonly {
    readonly workDate: string;
    readonly figures: ProductivityFigures;
    readonly timekeepers: readonly {
      readonly timekeeperUserId: string;
      readonly timekeeperName: string | null;
      readonly figures: ProductivityFigures;
    }[];
  }[];
  // Each timekeeper over the whole period, and how many days they recorded time on.
  readonly timekeepers: readonly {
    readonly timekeeperUserId: string;
    readonly timekeeperName: string | null;
    readonly dayCount: number;
    readonly figures: ProductivityFigures;
  }[];
}

export async function assembleDailyTime(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<DailyTimeReport> {
  const period = resolveLiveOnlyPeriod(input);
  const byDay = await readTimeRecordedByDay(database, period);
  if (byDay.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more time was recorded in this period than one report can list; choose an office or a shorter period",
    );
  }
  const rows = byDay.rows.filter(
    (row) => input.locationId === null || row.locationId === input.locationId,
  );

  const totals = new Tally();
  const days = new Map<
    string,
    { tally: Tally; timekeepers: Map<string, { name: string | null; tally: Tally }> }
  >();
  const timekeepers = new Map<string, { name: string | null; tally: Tally; days: Set<string> }>();
  const take = (row: TimeRecordedDayRow): void => {
    totals.take(row);
    const day = days.get(row.workDate) ?? { tally: new Tally(), timekeepers: new Map() };
    day.tally.take(row);
    const onDay = day.timekeepers.get(row.timekeeperUserId) ?? {
      name: row.timekeeperName,
      tally: new Tally(),
    };
    onDay.tally.take(row);
    day.timekeepers.set(row.timekeeperUserId, onDay);
    days.set(row.workDate, day);

    const timekeeper = timekeepers.get(row.timekeeperUserId) ?? {
      name: row.timekeeperName,
      tally: new Tally(),
      days: new Set<string>(),
    };
    timekeeper.tally.take(row);
    timekeeper.days.add(row.workDate);
    timekeepers.set(row.timekeeperUserId, timekeeper);
  };
  for (const row of rows) take(row);

  const byName = (left: { name: string | null }, right: { name: string | null }) =>
    (left.name ?? "").localeCompare(right.name ?? "");

  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    computedAt: options.computedAt,
    reproducible: false,
    statement: productivityStatement(period.periodStart, period.periodEnd, options.computedAt),
    locationId: input.locationId,
    completeness: completeScope(),
    totals: totals.figures(),
    days: [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workDate, day]) => ({
        workDate,
        figures: day.tally.figures(),
        timekeepers: [...day.timekeepers.entries()]
          .map(([timekeeperUserId, entry]) => ({ timekeeperUserId, ...entry }))
          .sort(byName)
          .map((entry) => ({
            timekeeperUserId: entry.timekeeperUserId,
            timekeeperName: entry.name,
            figures: entry.tally.figures(),
          })),
      })),
    timekeepers: [...timekeepers.entries()]
      .map(([timekeeperUserId, entry]) => ({ timekeeperUserId, ...entry }))
      .sort(byName)
      .map((entry) => ({
        timekeeperUserId: entry.timekeeperUserId,
        timekeeperName: entry.name,
        dayCount: entry.days.size,
        figures: entry.tally.figures(),
      })),
  };
}
