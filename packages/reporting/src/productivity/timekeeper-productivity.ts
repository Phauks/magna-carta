import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readTimeRecordedBreakdown,
  type TimeRecordedRow,
} from "@magna-carta/timekeeping/productivity-statements";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import { resolveLiveOnlyPeriod } from "../temporal.ts";

// TIMEKEEPER PRODUCTIVITY — how much time each timekeeper recorded in a period, billable against
// non-billable, and on what: per office, client, non-billable category and task code.
//
// It says nothing about whether the time was enough. The platform stores no billable-hour target, so
// there is no attainment figure: a target rendered against a number the firm never set would be the
// platform grading a lawyer's month. Minutes only, never money — what the time was worth is the
// realization report's, on a different permission.
//
// LIVE ONLY: time entries are edited until billed and record no date for it, so the period is on the
// work date and there is no knowledge instant. The roll-ups are timekeeping's rows added together;
// test/productivity.test.ts proves each sums to the same total.
//
// The billable share is the one figure computed here. It is a ratio of two minute counts, not money,
// and is given in basis points (10000 = all of it), null where nothing was recorded.

export interface ProductivityFigures {
  readonly entryCount: number;
  readonly billableMinutes: number;
  readonly nonBillableMinutes: number;
  readonly totalMinutes: number;
  readonly billableShareBasisPoints: number | null;
}

export interface TimekeeperProductivityReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly computedAt: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly completeness: ReportCompleteness;
  readonly totals: ProductivityFigures;
  readonly timekeepers: readonly {
    readonly timekeeperUserId: string;
    readonly timekeeperName: string | null;
    readonly matterCount: number;
    readonly figures: ProductivityFigures;
  }[];
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly figures: ProductivityFigures;
  }[];
  readonly clients: readonly {
    readonly clientEntityId: string | null;
    readonly clientName: string | null;
    readonly figures: ProductivityFigures;
  }[];
  // Non-billable time by the category it was recorded under; null for none given.
  readonly nonBillableCategories: readonly {
    readonly categoryId: string | null;
    readonly categoryName: string | null;
    readonly minutes: number;
  }[];
  // Time by the task code recorded on it; null for none given.
  readonly taskCodes: readonly {
    readonly code: string | null;
    readonly label: string | null;
    readonly figures: ProductivityFigures;
  }[];
}

// Shared with the Daily Time report, so both compute the billable share the same way.
export class Tally {
  entryCount = 0;
  billableMinutes = 0;
  nonBillableMinutes = 0;

  take(row: Pick<TimeRecordedRow, "billable" | "entryCount" | "minutes">): void {
    this.entryCount += row.entryCount;
    if (row.billable) this.billableMinutes += row.minutes;
    else this.nonBillableMinutes += row.minutes;
  }

  figures(): ProductivityFigures {
    const totalMinutes = this.billableMinutes + this.nonBillableMinutes;
    return {
      entryCount: this.entryCount,
      billableMinutes: this.billableMinutes,
      nonBillableMinutes: this.nonBillableMinutes,
      totalMinutes,
      billableShareBasisPoints:
        totalMinutes === 0 ? null : Math.round((this.billableMinutes * 10000) / totalMinutes),
    };
  }
}

function tallyFor<Caption>(
  map: Map<string, { caption: Caption; tally: Tally }>,
  key: string,
  caption: Caption,
): Tally {
  const existing = map.get(key);
  if (existing) return existing.tally;
  const created = { caption, tally: new Tally() };
  map.set(key, created);
  return created.tally;
}

const byMostTime = (
  left: { readonly figures: ProductivityFigures },
  right: { readonly figures: ProductivityFigures },
): number => right.figures.totalMinutes - left.figures.totalMinutes;

export function productivityStatement(
  periodStart: string,
  periodEnd: string,
  computedAt: string,
): string {
  return (
    `This report covers time worked from ${periodStart} to ${periodEnd}, as the time entries stood ` +
    `when it was produced, at ${computedAt}. Entries can be edited until they are billed, so it is a ` +
    `live report and is not claimed to reproduce. It reports time recorded and sets no target.`
  );
}

export async function assembleTimekeeperProductivity(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<TimekeeperProductivityReport> {
  const period = resolveLiveOnlyPeriod(input);
  const breakdown = await readTimeRecordedBreakdown(database, period);
  if (breakdown.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more time was recorded in this period than one report can list; choose an office or a shorter period",
    );
  }
  const rows = breakdown.rows.filter(
    (row) => input.locationId === null || row.locationId === input.locationId,
  );

  const totals = new Tally();
  const timekeepers = new Map<
    string,
    { caption: { name: string | null; matters: Set<string> }; tally: Tally }
  >();
  const offices = new Map<
    string,
    { caption: { id: string | null; name: string | null }; tally: Tally }
  >();
  const clients = new Map<
    string,
    { caption: { id: string | null; name: string | null }; tally: Tally }
  >();
  const tasks = new Map<
    string,
    { caption: { code: string | null; label: string | null }; tally: Tally }
  >();
  const categories = new Map<string, { id: string | null; name: string | null; minutes: number }>();

  for (const row of rows) {
    totals.take(row);
    tallyFor(timekeepers, row.timekeeperUserId, {
      name: row.timekeeperName,
      matters: new Set(),
    }).take(row);
    timekeepers.get(row.timekeeperUserId)?.caption.matters.add(row.matterId);
    tallyFor(offices, row.locationId ?? "", { id: row.locationId, name: row.locationName }).take(
      row,
    );
    tallyFor(clients, row.clientEntityId ?? "", {
      id: row.clientEntityId,
      name: row.clientName,
    }).take(row);
    tallyFor(tasks, row.taskCode ?? "", { code: row.taskCode, label: row.taskLabel }).take(row);
    if (!row.billable) {
      const key = row.nonBillableCategoryId ?? "";
      const category = categories.get(key) ?? {
        id: row.nonBillableCategoryId,
        name: row.nonBillableCategoryName,
        minutes: 0,
      };
      category.minutes += row.minutes;
      categories.set(key, category);
    }
  }

  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    computedAt: options.computedAt,
    reproducible: false,
    statement: productivityStatement(period.periodStart, period.periodEnd, options.computedAt),
    locationId: input.locationId,
    completeness: completeScope(),
    totals: totals.figures(),
    timekeepers: [...timekeepers.entries()]
      .map(([timekeeperUserId, { caption, tally }]) => ({
        timekeeperUserId,
        timekeeperName: caption.name,
        matterCount: caption.matters.size,
        figures: tally.figures(),
      }))
      .sort(byMostTime),
    offices: [...offices.values()]
      .map(({ caption, tally }) => ({
        locationId: caption.id,
        locationName: caption.name,
        figures: tally.figures(),
      }))
      .sort(byMostTime),
    clients: [...clients.values()]
      .map(({ caption, tally }) => ({
        clientEntityId: caption.id,
        clientName: caption.name,
        figures: tally.figures(),
      }))
      .sort(byMostTime),
    nonBillableCategories: [...categories.values()]
      .map((category) => ({
        categoryId: category.id,
        categoryName: category.name,
        minutes: category.minutes,
      }))
      .sort((left, right) => right.minutes - left.minutes),
    taskCodes: [...tasks.values()]
      .map(({ caption, tally }) => ({
        code: caption.code,
        label: caption.label,
        figures: tally.figures(),
      }))
      .sort(byMostTime),
  };
}
