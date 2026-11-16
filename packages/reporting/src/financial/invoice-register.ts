import { readInvoiceRegister, type InvoiceRegisterRow } from "@magna-carta/billing/queries";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { compare } from "@magna-carta/money/compare";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, subtract, USD } from "@magna-carta/money/money";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import {
  knowledgeBoundOf,
  reproducibilityOf,
  reproducibilityStatement,
  resolveReportingPeriod,
  type ReportingReproducibility,
} from "../temporal.ts";

// INVOICES — every bill issued in a period, with what had been credited and applied against it by the
// end of the period and what was still unpaid then.
//
// Every figure is billing's per-bill-and-matter row (`readInvoiceRegister`), added into bills, clients
// and offices. A bill that charges matters in two offices is counted once in each office it charges
// and once in the firm total; its money is split by matter, so the office figures still add up to the
// firm's. Unpaid is billed less credited less applied, on the same set of applications the as-of
// aging sets against a bill, so a bill's unpaid figure here is the aging's at the period's last day.

export interface InvoiceFigures {
  readonly invoiceCount: number;
  readonly billedMinor: number;
  readonly creditedMinor: number;
  readonly appliedMinor: number;
  readonly unpaidMinor: number;
}

export interface InvoiceRegisterMatter {
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly figures: InvoiceFigures;
}

export interface InvoiceRegisterInvoice {
  readonly invoiceId: string;
  readonly invoiceNumber: string | null;
  readonly issueDate: string;
  readonly dueDate: string | null;
  readonly figures: InvoiceFigures;
  readonly matters: readonly InvoiceRegisterMatter[];
}

export interface InvoiceRegisterReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  readonly completeness: ReportCompleteness;
  readonly totals: InvoiceFigures;
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly figures: InvoiceFigures;
  }[];
  readonly clients: readonly {
    readonly clientEntityId: string;
    readonly clientName: string | null;
    readonly figures: InvoiceFigures;
    readonly invoices: readonly InvoiceRegisterInvoice[];
  }[];
}

const usd = (minor: number) => fromMinor(minor, USD);
const plus = (left: number, right: number): number => toMinor(add(usd(left), usd(right)));
const minus = (left: number, right: number): number => toMinor(subtract(usd(left), usd(right)));

/** Money figures of one row, before a bill count is known. */
interface Amounts {
  readonly billedMinor: number;
  readonly creditedMinor: number;
  readonly appliedMinor: number;
  readonly unpaidMinor: number;
}

function amountsOf(row: InvoiceRegisterRow): Amounts {
  return {
    billedMinor: row.billedMinor,
    creditedMinor: row.creditedMinor,
    appliedMinor: row.appliedMinor,
    unpaidMinor: minus(minus(row.billedMinor, row.creditedMinor), row.appliedMinor),
  };
}

const NO_AMOUNTS: Amounts = { billedMinor: 0, creditedMinor: 0, appliedMinor: 0, unpaidMinor: 0 };

function sum(left: Amounts, right: Amounts): Amounts {
  return {
    billedMinor: plus(left.billedMinor, right.billedMinor),
    creditedMinor: plus(left.creditedMinor, right.creditedMinor),
    appliedMinor: plus(left.appliedMinor, right.appliedMinor),
    unpaidMinor: plus(left.unpaidMinor, right.unpaidMinor),
  };
}

/** A group's figures: its rows' money and the number of distinct bills among them. */
function figuresOf(rows: readonly InvoiceRegisterRow[]): InvoiceFigures {
  const amounts = rows.reduce((total, row) => sum(total, amountsOf(row)), NO_AMOUNTS);
  return { invoiceCount: new Set(rows.map((row) => row.invoiceId)).size, ...amounts };
}

const byBilledDescending = (
  left: { readonly figures: InvoiceFigures },
  right: { readonly figures: InvoiceFigures },
): number => compare(usd(right.figures.billedMinor), usd(left.figures.billedMinor));

function groupBy<Key>(
  rows: readonly InvoiceRegisterRow[],
  keyOf: (row: InvoiceRegisterRow) => Key,
): Map<Key, InvoiceRegisterRow[]> {
  const groups = new Map<Key, InvoiceRegisterRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

export async function assembleInvoiceRegister(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string | null;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<InvoiceRegisterReport> {
  const period = resolveReportingPeriod(input, options.computedAt);
  const register = await readInvoiceRegister(database, {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    knownAsOf: knowledgeBoundOf(period, options.computedAt),
  });
  if (register.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more bills were issued in this period than one report can list; choose an office or a shorter period",
    );
  }
  const rows = register.rows.filter(
    (row) => input.locationId === null || row.locationId === input.locationId,
  );

  const offices = [...groupBy(rows, (row) => row.locationId ?? "").values()].map((group) => ({
    locationId: group[0]?.locationId ?? null,
    locationName: group[0]?.locationName ?? null,
    figures: figuresOf(group),
  }));

  const clients = [...groupBy(rows, (row) => row.clientEntityId).values()].map((clientRows) => ({
    clientEntityId: clientRows[0]?.clientEntityId ?? "",
    clientName: clientRows[0]?.clientName ?? null,
    figures: figuresOf(clientRows),
    // Bills in the order they were issued: a client's register reads as its billing history.
    invoices: [...groupBy(clientRows, (row) => row.invoiceId).values()].map((invoiceRows) => {
      const first = invoiceRows[0];
      return {
        invoiceId: first?.invoiceId ?? "",
        invoiceNumber: first?.invoiceNumber ?? null,
        issueDate: first?.issueDate ?? "",
        dueDate: first?.dueDate ?? null,
        figures: figuresOf(invoiceRows),
        matters: invoiceRows.map((row) => ({
          matterId: row.matterId,
          matterTitle: row.matterTitle,
          matterNumber: row.matterNumber,
          locationId: row.locationId,
          locationName: row.locationName,
          figures: figuresOf([row]),
        })),
      };
    }),
  }));

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
    offices: offices.sort(byBilledDescending),
    clients: clients.sort(byBilledDescending),
  };
}
