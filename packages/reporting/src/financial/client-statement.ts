import {
  readApplicationRegister,
  readClientUnpaidInvoicesAsOf,
  readInvoiceRegister,
  type ApplicationKind,
  type ClientUnpaidInvoiceRow,
  type InvoiceRegisterRow,
  type MatterCaptionOfBill,
} from "@magna-carta/billing/queries";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, subtract, sum, USD } from "@magna-carta/money/money";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import {
  dayBefore,
  knowledgeBoundOf,
  reproducibilityOf,
  reproducibilityStatement,
  resolveReportingPeriod,
  type ReportingReproducibility,
} from "../temporal.ts";
import { AGING_BUCKETS } from "./accounts-receivable-aging.ts";

// A CLIENT'S STATEMENT OF ACCOUNT — what one client owed at the end of the day before a period, every
// bill and every application against their bills in it, what they owed at its end, and the bills
// still unpaid then.
//
// Every figure is billing's. The opening and closing balances and the unpaid bills are the as-of
// aging's own balances for the client (`readClientUnpaidInvoicesAsOf`) at the day before the period
// and at its last day, so the closing balance is the client's total in the Accounts Receivable Aging
// report at that date. The bills are the invoice register's rows and the applications the
// application register's, both narrowed to the client by billing. A reversal is its own line, its
// applied figure negative as the register signs it, naming the kind it reverses: nothing is netted.
//
// The running balance is the one figure new here: the opening balance moved by each line in turn.
// test/financial-client-statement.test.ts proves that it ends at the closing balance.
//
// ONE KNOWN WAY THE TWO DISAGREE, reported rather than hidden: billing accepts an application whose
// effective date is before its bill's issue date. The aging counts that application only once the
// bill exists, while the application register dates it by its own effective date, so a statement
// whose period separates the two ends somewhere other than its closing balance.

export type ClientStatementLineKind = "invoice" | ApplicationKind;

export interface ClientStatementLine {
  readonly kind: ClientStatementLineKind;
  /** For a reversal, the kind of the application it unwinds; null for every other line. */
  readonly reversesKind: Exclude<ApplicationKind, "reversal"> | null;
  /** A bill's issue date, or an application's effective date. */
  readonly date: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string | null;
  /** Null on a bill's line: a bill is one line however many matters it charges. */
  readonly applicationId: string | null;
  /** Every matter a bill charges; the one matter an application was set against. */
  readonly matters: readonly MatterCaptionOfBill[];
  readonly reason: string | null;
  /** What a bill charged; null on an application's line. */
  readonly chargedMinor: number | null;
  /** What an application set against the bill, a reversal negative; null on a bill's line. */
  readonly appliedMinor: number | null;
  /** What the client owed after this line. */
  readonly balanceMinor: number;
}

export interface ClientStatementUnpaidInvoice {
  readonly invoiceId: string;
  readonly invoiceNumber: string | null;
  readonly issueDate: string;
  readonly dueDate: string | null;
  /** The matters with something still unpaid on the bill. */
  readonly matters: readonly MatterCaptionOfBill[];
  /** The aging bucket the bill fell in at the period's last day. */
  readonly agingBucket: (typeof AGING_BUCKETS)[number]["id"];
  readonly billedMinor: number;
  /** What had been paid, credited or written off against the bill by the period's last day. */
  readonly paidAndCreditedMinor: number;
  readonly unpaidMinor: number;
}

export interface ClientStatementReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly clientEntityId: string;
  /** As the directory names the client now; null when no bill of theirs was found. */
  readonly clientName: string | null;
  readonly currency: "USD";
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  readonly completeness: ReportCompleteness;
  readonly totals: {
    /** Owed at the end of the day before the period starts. */
    readonly openingMinor: number;
    readonly billedMinor: number;
    readonly invoiceCount: number;
    /** Everything applied in the period, a reversal taking its amount back off. */
    readonly appliedMinor: number;
    /** Every application in the period, reversals included. */
    readonly applicationCount: number;
    /** Owed at the end of the period's last day. */
    readonly closingMinor: number;
  };
  /** Oldest first; on one day, the bills before the applications. */
  readonly activity: readonly ClientStatementLine[];
  /** The bills still unpaid at the period's last day, in the order they were issued. */
  readonly unpaidInvoices: readonly ClientStatementUnpaidInvoice[];
}

const usd = (minor: number) => fromMinor(minor, USD);
const plus = (left: number, right: number): number => toMinor(add(usd(left), usd(right)));
const minus = (left: number, right: number): number => toMinor(subtract(usd(left), usd(right)));
const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map(usd)));

function truncated(what: string): ReportingValidationError {
  return new ReportingValidationError(
    "reporting-breakdown-truncated",
    `this client has more ${what} than one statement can list; choose a shorter period`,
  );
}

type UnbalancedLine = Omit<ClientStatementLine, "balanceMinor">;

/** One line per bill: the register's rows are per bill and matter. */
function billLines(rows: readonly InvoiceRegisterRow[]): UnbalancedLine[] {
  const bills = new Map<string, InvoiceRegisterRow[]>();
  for (const row of rows) bills.set(row.invoiceId, [...(bills.get(row.invoiceId) ?? []), row]);
  return [...bills.values()].map((billRows) => {
    const first = billRows[0] as InvoiceRegisterRow;
    return {
      kind: "invoice",
      reversesKind: null,
      date: first.issueDate,
      invoiceId: first.invoiceId,
      invoiceNumber: first.invoiceNumber,
      applicationId: null,
      matters: billRows.map(({ matterId, matterTitle, matterNumber }) => ({
        matterId,
        matterTitle,
        matterNumber,
      })),
      reason: null,
      chargedMinor: totalOf(billRows.map((row) => row.billedMinor)),
      appliedMinor: null,
    };
  });
}

const sumUnpaid = (rows: readonly ClientUnpaidInvoiceRow[]): number =>
  totalOf(rows.map((row) => row.unpaidMinor));

export async function assembleClientStatement(
  database: SqlDatabase,
  input: {
    readonly clientEntityId: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string | null;
  },
  options: { readonly computedAt: string },
): Promise<ClientStatementReport> {
  const period = resolveReportingPeriod(input, options.computedAt);
  const knownAsOf = knowledgeBoundOf(period, options.computedAt);
  const narrowed = {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    knownAsOf,
    clientEntityId: input.clientEntityId,
  };
  const [opening, closing, bills, applications] = await Promise.all([
    readClientUnpaidInvoicesAsOf(database, {
      asOfDate: dayBefore(period.periodStart),
      knownAsOf,
      clientEntityId: input.clientEntityId,
    }),
    readClientUnpaidInvoicesAsOf(database, {
      asOfDate: period.periodEnd,
      knownAsOf,
      clientEntityId: input.clientEntityId,
    }),
    readInvoiceRegister(database, narrowed),
    readApplicationRegister(database, narrowed),
  ]);
  if (opening.truncated || closing.truncated) throw truncated("unpaid bills");
  if (bills.truncated) throw truncated("bills in this period");
  if (applications.truncated) throw truncated("payments and credits in this period");

  const applicationLines: UnbalancedLine[] = applications.rows.map((row) => ({
    kind: row.kind,
    reversesKind: row.reversesKind,
    date: row.effectiveDate,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    applicationId: row.applicationId,
    matters: [
      { matterId: row.matterId, matterTitle: row.matterTitle, matterNumber: row.matterNumber },
    ],
    reason: row.reason,
    chargedMinor: null,
    appliedMinor: row.amountMinor,
  }));
  // Both lists arrive oldest first; a stable sort on the date alone keeps each one's own order and
  // puts a day's bills ahead of what was applied that day.
  const ordered = [...billLines(bills.rows), ...applicationLines]
    .map((line, index) => ({ line, index }))
    .toSorted((left, right) =>
      left.line.date === right.line.date
        ? left.index - right.index
        : left.line.date < right.line.date
          ? -1
          : 1,
    )
    .map(({ line }) => line);

  const openingMinor = sumUnpaid(opening.rows);
  let balanceMinor = openingMinor;
  const activity = ordered.map((line) => {
    balanceMinor = minus(plus(balanceMinor, line.chargedMinor ?? 0), line.appliedMinor ?? 0);
    return { ...line, balanceMinor };
  });

  const clientName =
    [...bills.rows, ...applications.rows, ...closing.rows, ...opening.rows].find(
      (row) => row.clientName !== null,
    )?.clientName ?? null;

  const reproducibility = reproducibilityOf(period, options.computedAt);
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    clientEntityId: input.clientEntityId,
    clientName,
    currency: "USD",
    reproducibility,
    reproducibilityStatement: reproducibilityStatement(reproducibility),
    completeness: completeScope(),
    totals: {
      openingMinor,
      billedMinor: totalOf(bills.rows.map((row) => row.billedMinor)),
      invoiceCount: new Set(bills.rows.map((row) => row.invoiceId)).size,
      appliedMinor: totalOf(applications.rows.map((row) => row.amountMinor)),
      applicationCount: applications.rows.length,
      closingMinor: sumUnpaid(closing.rows),
    },
    activity,
    unpaidInvoices: closing.rows.map((row) => ({
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      matters: row.matters,
      agingBucket: AGING_BUCKETS[row.bucketIndex]?.id ?? "current",
      billedMinor: row.billedMinor,
      paidAndCreditedMinor: minus(row.billedMinor, row.unpaidMinor),
      unpaidMinor: row.unpaidMinor,
    })),
  };
}
