import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readTimeRecordedBreakdown } from "@magna-carta/timekeeping/productivity-statements";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import { resolveLiveOnlyPeriod } from "../temporal.ts";
import {
  productivityStatement,
  Tally,
  type ProductivityFigures,
} from "./timekeeper-productivity.ts";

// MATTER PRODUCTIVITY — how much time was recorded on each matter in a period, and by whom,
// billable against non-billable. The same minutes as Timekeeper Productivity turned the other way
// round: the matter is the row and its timekeepers sit under it. Minutes only, never money, on the
// same permission.
//
// The rows are timekeeping's productivity breakdown, the very read Timekeeper Productivity adds up,
// so the totals cannot differ; test/productivity-matter-productivity.test.ts proves they are equal.
// LIVE ONLY, as that report is.

export interface MatterProductivityRow {
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly clientEntityId: string | null;
  readonly clientName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly figures: ProductivityFigures;
  readonly timekeepers: readonly {
    readonly timekeeperUserId: string;
    readonly timekeeperName: string | null;
    readonly figures: ProductivityFigures;
  }[];
}

export interface MatterProductivityReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly computedAt: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly completeness: ReportCompleteness;
  readonly totals: ProductivityFigures;
  // Most time first.
  readonly matters: readonly MatterProductivityRow[];
}

export async function assembleMatterProductivity(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<MatterProductivityReport> {
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
  const matters = new Map<
    string,
    {
      caption: Omit<MatterProductivityRow, "figures" | "timekeepers">;
      tally: Tally;
      timekeepers: Map<string, { name: string | null; tally: Tally }>;
    }
  >();
  for (const row of rows) {
    totals.take(row);
    const matter = matters.get(row.matterId) ?? {
      caption: {
        matterId: row.matterId,
        matterTitle: row.matterTitle,
        matterNumber: row.matterNumber,
        clientEntityId: row.clientEntityId,
        clientName: row.clientName,
        locationId: row.locationId,
        locationName: row.locationName,
      },
      tally: new Tally(),
      timekeepers: new Map(),
    };
    matter.tally.take(row);
    const timekeeper = matter.timekeepers.get(row.timekeeperUserId) ?? {
      name: row.timekeeperName,
      tally: new Tally(),
    };
    timekeeper.tally.take(row);
    matter.timekeepers.set(row.timekeeperUserId, timekeeper);
    matters.set(row.matterId, matter);
  }

  const mostFirst = (
    left: { readonly figures: ProductivityFigures },
    right: { readonly figures: ProductivityFigures },
  ) => right.figures.totalMinutes - left.figures.totalMinutes;

  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    computedAt: options.computedAt,
    reproducible: false,
    statement: productivityStatement(period.periodStart, period.periodEnd, options.computedAt),
    locationId: input.locationId,
    completeness: completeScope(),
    totals: totals.figures(),
    matters: [...matters.values()]
      .map((matter) => ({
        ...matter.caption,
        figures: matter.tally.figures(),
        timekeepers: [...matter.timekeepers.entries()]
          .map(([timekeeperUserId, entry]) => ({
            timekeeperUserId,
            timekeeperName: entry.name,
            figures: entry.tally.figures(),
          }))
          .sort(mostFirst),
      }))
      .sort(mostFirst),
  };
}
