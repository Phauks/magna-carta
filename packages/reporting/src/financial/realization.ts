import { readRealizationBreakdown, type RealizationRow } from "@magna-carta/billing/queries";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { compare } from "@magna-carta/money/compare";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, USD } from "@magna-carta/money/money";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import {
  knowledgeBoundOf,
  reproducibilityOf,
  reproducibilityStatement,
  resolveReportingPeriod,
  type ReportingReproducibility,
} from "../temporal.ts";

// REALIZATION — for a period: what the time recorded was worth at standard rates, what was billed,
// what was credited or written off, and what was applied against the bills.
//
// The billed, credited and applied legs re-derive from records that never change, on the period and
// the knowledge instant. The standard value is LIVE — time entries can be edited until billed — and
// the response carries that in `standardValueIsLive` and in its own sentence beside the stamp, so a
// reader never takes a blended figure for a reproducible one. Every figure is billing's per-matter row
// added together; test/financial-realization.test.ts proves the roll-ups sum to the rows.
//
// No realization percentage is printed. A rate is a quotient of a live leg and an as-of leg, and a
// rate that silently mixes the two is exactly the blended figure this report is built not to show.

export interface RealizationFigures {
  readonly standardValueMinor: number;
  readonly billedMinor: number;
  readonly creditedMinor: number;
  readonly appliedMinor: number;
}

export interface RealizationReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  readonly standardValueIsLive: true;
  readonly standardValueStatement: string;
  readonly completeness: ReportCompleteness;
  readonly totals: RealizationFigures;
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly figures: RealizationFigures;
  }[];
  readonly clients: readonly {
    readonly clientEntityId: string | null;
    readonly clientName: string | null;
    readonly figures: RealizationFigures;
    readonly matters: readonly {
      readonly matterId: string;
      readonly matterTitle: string;
      readonly matterNumber: string | null;
      readonly locationId: string | null;
      readonly locationName: string | null;
      readonly figures: RealizationFigures;
    }[];
  }[];
}

const usd = (minor: number) => fromMinor(minor, USD);
const plus = (left: number, right: number): number => toMinor(add(usd(left), usd(right)));

function zero(): RealizationFigures {
  return { standardValueMinor: 0, billedMinor: 0, creditedMinor: 0, appliedMinor: 0 };
}

function combine(left: RealizationFigures, row: RealizationRow): RealizationFigures {
  return {
    standardValueMinor: plus(left.standardValueMinor, row.standardValueMinor),
    billedMinor: plus(left.billedMinor, row.billedMinor),
    creditedMinor: plus(left.creditedMinor, row.creditedMinor),
    appliedMinor: plus(left.appliedMinor, row.appliedMinor),
  };
}

// Ordered by what was billed, largest first, then by standard value for rows billed nothing.
const byBilledDescending = (
  left: { readonly figures: RealizationFigures },
  right: { readonly figures: RealizationFigures },
): number =>
  compare(usd(right.figures.billedMinor), usd(left.figures.billedMinor)) ||
  compare(usd(right.figures.standardValueMinor), usd(left.figures.standardValueMinor));

export function standardValueStatement(computedAt: string): string {
  return (
    `The standard value of time is as the time entries stood when this report was produced, at ` +
    `${computedAt}: entries can be edited until they are billed, so that one column is live even when ` +
    `the rest of the report reproduces.`
  );
}

export async function assembleRealization(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string | null;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<RealizationReport> {
  const period = resolveReportingPeriod(input, options.computedAt);
  const breakdown = await readRealizationBreakdown(database, {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    knownAsOf: knowledgeBoundOf(period, options.computedAt),
  });
  if (breakdown.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more matters had activity in this period than one report can list; choose an office or a shorter period",
    );
  }
  const rows = breakdown.rows.filter(
    (row) => input.locationId === null || row.locationId === input.locationId,
  );

  let totals = zero();
  const offices = new Map<
    string,
    { locationId: string | null; locationName: string | null; figures: RealizationFigures }
  >();
  const clients = new Map<
    string,
    {
      clientEntityId: string | null;
      clientName: string | null;
      figures: RealizationFigures;
      matters: RealizationRow[];
    }
  >();
  for (const row of rows) {
    totals = combine(totals, row);
    const officeKey = row.locationId ?? "";
    const office = offices.get(officeKey) ?? {
      locationId: row.locationId,
      locationName: row.locationName,
      figures: zero(),
    };
    offices.set(officeKey, { ...office, figures: combine(office.figures, row) });
    const clientKey = row.clientEntityId ?? "";
    const client = clients.get(clientKey) ?? {
      clientEntityId: row.clientEntityId,
      clientName: row.clientName,
      figures: zero(),
      matters: [],
    };
    clients.set(clientKey, {
      ...client,
      figures: combine(client.figures, row),
      matters: [...client.matters, row],
    });
  }

  const reproducibility = reproducibilityOf(period, options.computedAt);
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    locationId: input.locationId,
    currency: "USD",
    reproducibility,
    reproducibilityStatement: reproducibilityStatement(reproducibility),
    standardValueIsLive: true,
    standardValueStatement: standardValueStatement(options.computedAt),
    completeness: completeScope(),
    totals,
    offices: [...offices.values()].sort(byBilledDescending),
    clients: [...clients.values()]
      .map((client) => ({
        clientEntityId: client.clientEntityId,
        clientName: client.clientName,
        figures: client.figures,
        matters: client.matters
          .map((matter) => ({
            matterId: matter.matterId,
            matterTitle: matter.matterTitle,
            matterNumber: matter.matterNumber,
            locationId: matter.locationId,
            locationName: matter.locationName,
            figures: combine(zero(), matter),
          }))
          .sort(byBilledDescending),
      }))
      .sort(byBilledDescending),
  };
}
