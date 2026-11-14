import { readWorkInProgressByAge, type WorkInProgressAgeRow } from "@magna-carta/billing/queries";
import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { compare } from "@magna-carta/money/compare";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, sum as sumMoney, USD } from "@magna-carta/money/money";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";

// AGED WORK IN PROGRESS — unbilled time and costs by how long ago the work was done (0 to 30 days,
// 31 to 60, 61 to 90, over 90), per office, client and matter. Old unbilled work is the work most
// likely never to be paid for.
//
// Every figure is billing's. `readWorkInProgressByAge` reads the same unbilled entries as the
// work-in-progress breakdown, through the same predicate, and buckets them in SQL; this module adds
// its rows into offices, clients and matters. test/financial-aged-work-in-progress.test.ts proves the
// buckets add up to the Work in Progress report's own total.
//
// LIVE ONLY, for the reason Work in Progress is: an unbilled entry can still be edited and carries no
// stamp of when it changed. The age is counted from the day the report is produced (the UTC day of
// `computedAt`).

export type AgedFigures = readonly [number, number, number, number];

export interface AgedWorkFigures {
  readonly unbilledMinor: AgedFigures;
  readonly totalMinor: number;
}

export interface AgedWorkMatterRow {
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly figures: AgedWorkFigures;
}

export interface AgedWorkInProgressReport {
  readonly computedAt: string;
  readonly asOfDate: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly completeness: ReportCompleteness;
  readonly totals: AgedWorkFigures;
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly figures: AgedWorkFigures;
  }[];
  readonly clients: readonly {
    readonly clientEntityId: string | null;
    readonly clientName: string | null;
    readonly figures: AgedWorkFigures;
    readonly matters: readonly AgedWorkMatterRow[];
  }[];
}

const usd = (minor: number) => fromMinor(minor, USD);

class Buckets {
  readonly values: number[] = [0, 0, 0, 0];

  take(row: WorkInProgressAgeRow): void {
    this.values[row.bucketIndex] = toMinor(
      add(usd(this.values[row.bucketIndex] ?? 0), usd(row.amountMinor)),
    );
  }

  figures(): AgedWorkFigures {
    const unbilledMinor: AgedFigures = [
      this.values[0] ?? 0,
      this.values[1] ?? 0,
      this.values[2] ?? 0,
      this.values[3] ?? 0,
    ];
    return { unbilledMinor, totalMinor: toMinor(sumMoney(unbilledMinor.map(usd))) };
  }
}

// Largest first.
const byTotalDescending = (
  left: { readonly figures: AgedWorkFigures },
  right: { readonly figures: AgedWorkFigures },
): number => compare(usd(right.figures.totalMinor), usd(left.figures.totalMinor));

export function agedWorkInProgressStatement(computedAt: string): string {
  return (
    `This report shows unbilled time and costs by how long ago the work was done, as they stood when ` +
    `it was produced, at ${computedAt}. Time and cost entries can still be edited until they are ` +
    `billed, so it is a live report: running it again later will reflect any change made in the ` +
    `meantime, and it is not claimed to reproduce.`
  );
}

export async function assembleAgedWorkInProgress(
  database: SqlDatabase,
  input: { readonly locationId: string | null },
  options: { readonly computedAt: string },
): Promise<AgedWorkInProgressReport> {
  const asOfDate = civilDateOf(options.computedAt);
  const aged = await readWorkInProgressByAge(database, asOfDate);
  if (aged.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more matters have unbilled work than one report can list; choose an office to narrow it",
    );
  }
  const rows = aged.rows.filter(
    (row) => input.locationId === null || row.locationId === input.locationId,
  );

  const totals = new Buckets();
  const offices = new Map<
    string,
    { locationId: string | null; locationName: string | null; buckets: Buckets }
  >();
  const clients = new Map<
    string,
    {
      clientEntityId: string | null;
      clientName: string | null;
      buckets: Buckets;
      matters: Map<string, { row: WorkInProgressAgeRow; buckets: Buckets }>;
    }
  >();
  for (const row of rows) {
    totals.take(row);
    const officeKey = row.locationId ?? "";
    const office = offices.get(officeKey) ?? {
      locationId: row.locationId,
      locationName: row.locationName,
      buckets: new Buckets(),
    };
    office.buckets.take(row);
    offices.set(officeKey, office);

    const clientKey = row.clientEntityId ?? "";
    const client = clients.get(clientKey) ?? {
      clientEntityId: row.clientEntityId,
      clientName: row.clientName,
      buckets: new Buckets(),
      matters: new Map(),
    };
    client.buckets.take(row);
    const matter = client.matters.get(row.matterId) ?? { row, buckets: new Buckets() };
    matter.buckets.take(row);
    client.matters.set(row.matterId, matter);
    clients.set(clientKey, client);
  }

  return {
    computedAt: options.computedAt,
    asOfDate,
    reproducible: false,
    statement: agedWorkInProgressStatement(options.computedAt),
    locationId: input.locationId,
    currency: "USD",
    completeness: completeScope(),
    totals: totals.figures(),
    offices: [...offices.values()]
      .map((office) => ({
        locationId: office.locationId,
        locationName: office.locationName,
        figures: office.buckets.figures(),
      }))
      .sort(byTotalDescending),
    clients: [...clients.values()]
      .map((client) => ({
        clientEntityId: client.clientEntityId,
        clientName: client.clientName,
        figures: client.buckets.figures(),
        matters: [...client.matters.values()]
          .map(({ row, buckets }) => ({
            matterId: row.matterId,
            matterTitle: row.matterTitle,
            matterNumber: row.matterNumber,
            locationId: row.locationId,
            locationName: row.locationName,
            figures: buckets.figures(),
          }))
          .sort(byTotalDescending),
      }))
      .sort(byTotalDescending),
  };
}
