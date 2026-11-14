import {
  readApplicationRegister,
  type ApplicationKind,
  type ApplicationRegisterRow,
} from "@magna-carta/billing/queries";
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

// PAYMENTS APPLIED — everything set against a bill in a period: payments, transfers from trust,
// client credits, credit notes and write-offs, and the reversals of any of them, each on its own row.
//
// Every figure is billing's own application row (`readApplicationRegister`), added up by kind, office
// and client. A reversal keeps its own kind and its own negative row, beside the entry it names: the
// fact that something was undone is part of what the reader needs. "Applied", never "received": the
// platform records what was set against a bill, and no payment rail records cash arriving.

export interface AppliedFigures {
  readonly entryCount: number;
  readonly paymentMinor: number;
  readonly trustTransferMinor: number;
  readonly clientCreditMinor: number;
  readonly creditNoteMinor: number;
  readonly writeOffMinor: number;
  /** Negative or zero: what reversals took back, of every kind. */
  readonly reversalMinor: number;
  readonly totalMinor: number;
}

export interface PaymentsAppliedEntry {
  readonly applicationId: string;
  readonly kind: ApplicationKind;
  readonly reversesKind: Exclude<ApplicationKind, "reversal"> | null;
  readonly effectiveDate: string;
  readonly amountMinor: number;
  readonly reason: string | null;
  readonly invoiceId: string;
  readonly invoiceNumber: string | null;
  readonly clientEntityId: string;
  readonly clientName: string | null;
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
}

export interface PaymentsAppliedReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  readonly completeness: ReportCompleteness;
  readonly totals: AppliedFigures;
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly figures: AppliedFigures;
  }[];
  readonly clients: readonly {
    readonly clientEntityId: string;
    readonly clientName: string | null;
    readonly figures: AppliedFigures;
  }[];
  /** Every application, in the order it took effect. */
  readonly entries: readonly PaymentsAppliedEntry[];
}

const usd = (minor: number) => fromMinor(minor, USD);
const plus = (left: number, right: number): number => toMinor(add(usd(left), usd(right)));

const FIELD_OF_KIND: Readonly<
  Record<ApplicationKind, Exclude<keyof AppliedFigures, "entryCount" | "totalMinor">>
> = {
  payment: "paymentMinor",
  trust_transfer: "trustTransferMinor",
  client_credit: "clientCreditMinor",
  credit_note: "creditNoteMinor",
  write_off: "writeOffMinor",
  reversal: "reversalMinor",
};

function figuresOf(rows: readonly ApplicationRegisterRow[]): AppliedFigures {
  let figures: AppliedFigures = {
    entryCount: 0,
    paymentMinor: 0,
    trustTransferMinor: 0,
    clientCreditMinor: 0,
    creditNoteMinor: 0,
    writeOffMinor: 0,
    reversalMinor: 0,
    totalMinor: 0,
  };
  for (const row of rows) {
    const field = FIELD_OF_KIND[row.kind];
    figures = {
      ...figures,
      entryCount: figures.entryCount + 1,
      [field]: plus(figures[field], row.amountMinor),
      totalMinor: plus(figures.totalMinor, row.amountMinor),
    };
  }
  return figures;
}

const byTotalDescending = (
  left: { readonly figures: AppliedFigures },
  right: { readonly figures: AppliedFigures },
): number => compare(usd(right.figures.totalMinor), usd(left.figures.totalMinor));

function groupBy(
  rows: readonly ApplicationRegisterRow[],
  keyOf: (row: ApplicationRegisterRow) => string,
): ApplicationRegisterRow[][] {
  const groups = new Map<string, ApplicationRegisterRow[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return [...groups.values()];
}

export async function assemblePaymentsApplied(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string | null;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<PaymentsAppliedReport> {
  const period = resolveReportingPeriod(input, options.computedAt);
  const register = await readApplicationRegister(database, {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    knownAsOf: knowledgeBoundOf(period, options.computedAt),
  });
  if (register.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more was applied to bills in this period than one report can list; choose an office or a shorter period",
    );
  }
  const rows = register.rows.filter(
    (row) => input.locationId === null || row.locationId === input.locationId,
  );
  const reproducibility = reproducibilityOf(period, options.computedAt);
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    locationId: input.locationId,
    currency: "USD",
    reproducibility,
    reproducibilityStatement: reproducibilityStatement(reproducibility),
    completeness: completeScope(),
    totals: figuresOf(rows),
    offices: groupBy(rows, (row) => row.locationId ?? "")
      .map((group) => ({
        locationId: group[0]?.locationId ?? null,
        locationName: group[0]?.locationName ?? null,
        figures: figuresOf(group),
      }))
      .sort(byTotalDescending),
    clients: groupBy(rows, (row) => row.clientEntityId)
      .map((group) => ({
        clientEntityId: group[0]?.clientEntityId ?? "",
        clientName: group[0]?.clientName ?? null,
        figures: figuresOf(group),
      }))
      .sort(byTotalDescending),
    entries: rows.map((row) => ({ ...row })),
  };
}
