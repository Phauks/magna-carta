import {
  readApplicationRegister,
  readInvoiceRegister,
  readMatterAttributions,
  type ApplicationKind,
  type ApplicationRegisterRow,
  type InvoiceRegisterRow,
  type MatterAttribution,
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

// REVENUE — what was billed in a period and what was collected in it, by office, by matter type and
// by responsible attorney.
//
// Billed is the Invoices report's billed figure: billing's per-bill-and-matter register rows
// (`readInvoiceRegister`), bills issued in the period. Collected is the part of the Payments Applied
// report that is money the firm received for its bills: payments, transfers from trust and client
// credits, each a row of billing's application register (`readApplicationRegister`) effective in the
// period. Credit notes and write-offs reduce what a client owes without paying it, so they are not
// collections; they stand in their own column, credited, so the two columns together are the Payments
// Applied total. A reversal takes back what it reverses in that entry's own column.
//
// Matter type and responsible attorney are the matter's as it stands now (`readMatterAttributions`):
// neither keeps a history, so a period's money is attributed to the matter's current type and
// attorney, and the response says so in `attributionStatement`. The office is the register's own.

export interface RevenueFigures {
  readonly billedMinor: number;
  /** Payments, transfers from trust and client credits, less their reversals. */
  readonly collectedMinor: number;
  /** Credit notes and write-offs, less their reversals: never counted as collected. */
  readonly creditedMinor: number;
}

export interface RevenueReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  /** What collected counts and how money is attributed to a matter type and an attorney. */
  readonly attributionStatement: string;
  readonly completeness: ReportCompleteness;
  readonly totals: RevenueFigures;
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly figures: RevenueFigures;
  }[];
  readonly matterTypes: readonly {
    readonly matterTypeId: string | null;
    readonly matterTypeName: string | null;
    readonly matterCount: number;
    readonly figures: RevenueFigures;
  }[];
  readonly responsibleAttorneys: readonly {
    readonly responsibleMemberId: string;
    readonly responsibleName: string | null;
    readonly matterCount: number;
    readonly figures: RevenueFigures;
  }[];
}

export const REVENUE_ATTRIBUTION_STATEMENT =
  "Collected counts payments, transfers from trust and client credits applied to bills in the period, less any reversal of them. Credit notes and write-offs are shown as credited and are not counted as collected. Each matter's money is counted under the matter type and responsible attorney the matter has now.";

const usd = (minor: number) => fromMinor(minor, USD);
const plus = (left: number, right: number): number => toMinor(add(usd(left), usd(right)));

const CREDIT_KINDS: ReadonlySet<ApplicationKind> = new Set(["credit_note", "write_off"]);

/** Whether an application is a credit rather than a collection; a reversal follows what it reverses. */
export function isCreditApplication(
  row: Pick<ApplicationRegisterRow, "kind" | "reversesKind">,
): boolean {
  return CREDIT_KINDS.has(row.kind === "reversal" ? (row.reversesKind ?? row.kind) : row.kind);
}

/** One money movement of the report, attributed to its matter and office. */
interface Movement {
  readonly matterId: string;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly figures: RevenueFigures;
}

const NO_FIGURES: RevenueFigures = { billedMinor: 0, collectedMinor: 0, creditedMinor: 0 };

function billedMovement(row: InvoiceRegisterRow): Movement {
  return {
    matterId: row.matterId,
    locationId: row.locationId,
    locationName: row.locationName,
    figures: { ...NO_FIGURES, billedMinor: row.billedMinor },
  };
}

function appliedMovement(row: ApplicationRegisterRow): Movement {
  return {
    matterId: row.matterId,
    locationId: row.locationId,
    locationName: row.locationName,
    figures: isCreditApplication(row)
      ? { ...NO_FIGURES, creditedMinor: row.amountMinor }
      : { ...NO_FIGURES, collectedMinor: row.amountMinor },
  };
}

function figuresOf(movements: readonly Movement[]): RevenueFigures {
  return movements.reduce(
    (total, movement) => ({
      billedMinor: plus(total.billedMinor, movement.figures.billedMinor),
      collectedMinor: plus(total.collectedMinor, movement.figures.collectedMinor),
      creditedMinor: plus(total.creditedMinor, movement.figures.creditedMinor),
    }),
    NO_FIGURES,
  );
}

function groupBy(
  movements: readonly Movement[],
  keyOf: (movement: Movement) => string,
): Movement[][] {
  const groups = new Map<string, Movement[]>();
  for (const movement of movements) {
    const key = keyOf(movement);
    groups.set(key, [...(groups.get(key) ?? []), movement]);
  }
  return [...groups.values()];
}

const byBilledThenCollected = (
  left: { readonly figures: RevenueFigures },
  right: { readonly figures: RevenueFigures },
): number =>
  compare(usd(right.figures.billedMinor), usd(left.figures.billedMinor)) ||
  compare(usd(right.figures.collectedMinor), usd(left.figures.collectedMinor));

const matterCountOf = (movements: readonly Movement[]): number =>
  new Set(movements.map((movement) => movement.matterId)).size;

export async function assembleRevenue(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string | null;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<RevenueReport> {
  const period = resolveReportingPeriod(input, options.computedAt);
  const query = {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    knownAsOf: knowledgeBoundOf(period, options.computedAt),
  };
  const [invoices, applications] = await Promise.all([
    readInvoiceRegister(database, query),
    readApplicationRegister(database, query),
  ]);
  if (invoices.truncated || applications.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more was billed or applied in this period than one report can list; choose an office or a shorter period",
    );
  }
  const inOffice = (row: { readonly locationId: string | null }) =>
    input.locationId === null || row.locationId === input.locationId;
  const movements = [
    ...invoices.rows.filter(inOffice).map(billedMovement),
    ...applications.rows.filter(inOffice).map(appliedMovement),
  ];

  const attributionOf = new Map<string, MatterAttribution>(
    (
      await readMatterAttributions(database, [
        ...new Set(movements.map((movement) => movement.matterId)),
      ])
    ).map((attribution) => [attribution.matterId, attribution]),
  );
  const attributed = (movement: Movement) => attributionOf.get(movement.matterId);

  const reproducibility = reproducibilityOf(period, options.computedAt);
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    locationId: input.locationId,
    currency: "USD",
    reproducibility,
    reproducibilityStatement: reproducibilityStatement(reproducibility),
    attributionStatement: REVENUE_ATTRIBUTION_STATEMENT,
    completeness: completeScope(),
    totals: figuresOf(movements),
    offices: groupBy(movements, (movement) => movement.locationId ?? "")
      .map((group) => ({
        locationId: group[0]?.locationId ?? null,
        locationName: group[0]?.locationName ?? null,
        figures: figuresOf(group),
      }))
      .sort(byBilledThenCollected),
    matterTypes: groupBy(movements, (movement) => attributed(movement)?.matterTypeId ?? "")
      .map((group) => {
        const attribution = group[0] === undefined ? undefined : attributed(group[0]);
        return {
          matterTypeId: attribution?.matterTypeId ?? null,
          matterTypeName: attribution?.matterTypeName ?? null,
          matterCount: matterCountOf(group),
          figures: figuresOf(group),
        };
      })
      .sort(byBilledThenCollected),
    responsibleAttorneys: groupBy(
      movements,
      (movement) => attributed(movement)?.responsibleMemberId ?? "",
    )
      .map((group) => {
        const attribution = group[0] === undefined ? undefined : attributed(group[0]);
        return {
          responsibleMemberId: attribution?.responsibleMemberId ?? "",
          responsibleName: attribution?.responsibleName ?? null,
          matterCount: matterCountOf(group),
          figures: figuresOf(group),
        };
      })
      .sort(byBilledThenCollected),
  };
}
