import {
  readAccountsReceivableAgingAsOf,
  type AgingBreakdownRow,
} from "@magna-carta/billing/queries";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { compare } from "@magna-carta/money/compare";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, sum as sumMoney, USD } from "@magna-carta/money/money";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import {
  knowledgeBoundOf,
  reproducibilityOf,
  reproducibilityStatement,
  resolveReportingPeriod,
  type ReportingReproducibility,
} from "../temporal.ts";

// ACCOUNTS-RECEIVABLE AGING — what the firm is owed at a date, by how long it has been owed, per
// office, client and matter.
//
// Every figure is billing's. The firm-wide buckets are `readAccountsReceivableAgingAsOf`'s own, and the
// office, client and matter figures are a DECOMPOSITION of its breakdown rows: this module adds rows
// it was handed and nothing else, and test/financial-aging.test.ts proves the decomposition sums to the
// buckets billing produced. The as-of read itself is proved equal to the live read at today in
// packages/billing/test/aging-as-of.test.ts.
//
// Aging is a POSITION at one date rather than activity over a span, so the period is that date at
// both ends. The knowledge instant is the same contract as every other ledger-backed report: given,
// the answer reproduces; omitted, it is live and stamped.
//
// THE OFFICE IS A FILTER, NEVER A GATE. A member who may run this report may run it firm-wide; the
// office narrows the rows, and with no office chosen every office is subtotalled.

export const AGING_BUCKETS = [
  { id: "current", label: "Current" },
  { id: "1-30", label: "1 to 30 days" },
  { id: "31-60", label: "31 to 60 days" },
  { id: "61-90", label: "61 to 90 days" },
  { id: "90+", label: "Over 90 days" },
] as const;

// Five integers, in bucket order.
export type AgingFigures = readonly [number, number, number, number, number];

export interface AgingMatterRow {
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly unpaidMinor: AgingFigures;
  readonly totalMinor: number;
}

export interface AgingClientRow {
  readonly clientEntityId: string;
  readonly clientName: string | null;
  readonly unpaidMinor: AgingFigures;
  readonly totalMinor: number;
  // Every matter of this client with something unpaid, largest first.
  readonly matters: readonly AgingMatterRow[];
}

export interface AgingOfficeRow {
  // Null for matters recorded without an office.
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly unpaidMinor: AgingFigures;
  readonly totalMinor: number;
}

export interface AccountsReceivableAgingReport {
  readonly asOfDate: string;
  // The office the rows were narrowed to, or null for the whole firm.
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  readonly completeness: ReportCompleteness;
  readonly totals: {
    readonly unpaidMinor: AgingFigures;
    readonly totalMinor: number;
    // How many bills are unpaid in each bucket. Billing's own count, given only for the whole firm:
    // a bill can span matters in two offices, so a per-office count would count it twice.
    readonly invoiceCount: AgingFigures | null;
  };
  readonly offices: readonly AgingOfficeRow[];
  readonly clients: readonly AgingClientRow[];
}

export interface AccountsReceivableAgingInput {
  readonly asOfDate: string;
  readonly knownAsOf: string | null;
  readonly locationId: string | null;
}

function zero(): [number, number, number, number, number] {
  return [0, 0, 0, 0, 0];
}

// Every addition goes through the money package, which checks each operand is a safe integer in one
// currency; the receivable is single-currency by the invoice's own CHECK, so USD is the whole domain.
const usd = (minor: number) => fromMinor(minor, USD);

function sum(figures: AgingFigures): number {
  return toMinor(sumMoney(figures.map(usd)));
}

function addInto(target: number[], row: AgingBreakdownRow): void {
  target[row.bucketIndex] = toMinor(add(usd(target[row.bucketIndex] ?? 0), usd(row.unpaidMinor)));
}

// Largest first.
const byTotalDescending = (
  left: { readonly totalMinor: number },
  right: { readonly totalMinor: number },
): number => compare(usd(right.totalMinor), usd(left.totalMinor));

const asFigures = (values: number[]): AgingFigures =>
  [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0, values[4] ?? 0] as const;

export async function assembleAccountsReceivableAging(
  database: SqlDatabase,
  input: AccountsReceivableAgingInput,
  options: { readonly computedAt: string },
): Promise<AccountsReceivableAgingReport> {
  const period = resolveReportingPeriod(
    { periodStart: input.asOfDate, periodEnd: input.asOfDate, knownAsOf: input.knownAsOf },
    options.computedAt,
  );
  const aging = await readAccountsReceivableAgingAsOf(database, {
    asOfDate: input.asOfDate,
    knownAsOf: knowledgeBoundOf(period, options.computedAt),
  });
  if (aging.breakdownTruncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more matters have something unpaid than one report can list; choose an office to narrow it",
    );
  }

  const inScope = aging.breakdown.filter(
    (row) => input.locationId === null || row.locationId === input.locationId,
  );

  const totals = zero();
  const offices = new Map<
    string,
    { locationId: string | null; locationName: string | null; figures: number[] }
  >();
  const clients = new Map<
    string,
    {
      clientEntityId: string;
      clientName: string | null;
      figures: number[];
      matters: Map<string, { row: AgingBreakdownRow; figures: number[] }>;
    }
  >();
  for (const row of inScope) {
    addInto(totals, row);
    const officeKey = row.locationId ?? "";
    const office = offices.get(officeKey) ?? {
      locationId: row.locationId,
      locationName: row.locationName,
      figures: zero(),
    };
    addInto(office.figures, row);
    offices.set(officeKey, office);

    const client = clients.get(row.clientEntityId) ?? {
      clientEntityId: row.clientEntityId,
      clientName: row.clientName,
      figures: zero(),
      matters: new Map(),
    };
    addInto(client.figures, row);
    const matter = client.matters.get(row.matterId) ?? { row, figures: zero() };
    addInto(matter.figures, row);
    client.matters.set(row.matterId, matter);
    clients.set(row.clientEntityId, client);
  }

  const reproducibility = reproducibilityOf(period, options.computedAt);
  const totalFigures = asFigures(totals);
  return {
    asOfDate: input.asOfDate,
    locationId: input.locationId,
    currency: "USD",
    reproducibility,
    reproducibilityStatement: reproducibilityStatement(reproducibility),
    completeness: completeScope(),
    totals: {
      unpaidMinor: totalFigures,
      totalMinor: sum(totalFigures),
      invoiceCount:
        input.locationId === null
          ? asFigures(aging.buckets.map((bucket) => bucket.invoiceCount))
          : null,
    },
    offices: [...offices.values()]
      .map((office) => {
        const figures = asFigures(office.figures);
        return {
          locationId: office.locationId,
          locationName: office.locationName,
          unpaidMinor: figures,
          totalMinor: sum(figures),
        };
      })
      .sort(byTotalDescending),
    clients: [...clients.values()]
      .map((client) => {
        const figures = asFigures(client.figures);
        return {
          clientEntityId: client.clientEntityId,
          clientName: client.clientName,
          unpaidMinor: figures,
          totalMinor: sum(figures),
          matters: [...client.matters.values()]
            .map(({ row, figures: matterFigures }) => {
              const unpaid = asFigures(matterFigures);
              return {
                matterId: row.matterId,
                matterTitle: row.matterTitle,
                matterNumber: row.matterNumber,
                locationId: row.locationId,
                locationName: row.locationName,
                unpaidMinor: unpaid,
                totalMinor: sum(unpaid),
              };
            })
            .sort(byTotalDescending),
        };
      })
      .sort(byTotalDescending),
  };
}
