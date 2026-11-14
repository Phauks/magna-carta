import { readBillingVolumes, type BillingVolumes } from "@magna-carta/billing/operational-counts";
import { readCostVolumes, type CostVolumeRow } from "@magna-carta/costs/operational-counts";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readMatterVolumes, type MatterVolumeRow } from "@magna-carta/matters/operational-counts";
import { readTrustVolumes, type TrustVolumeRow } from "@magna-carta/trust/operational-counts";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import {
  knowledgeBoundOf,
  reproducibilityOf,
  reproducibilityStatement,
  resolveReportingPeriod,
  type ReportingReproducibility,
} from "../temporal.ts";

// OPERATIONAL VOLUMES — how much the firm did in a period: matters opened and closed, bills drafted,
// finalized and voided, credit notes and write-offs, trust movements, disbursement requests and their
// outcomes, reconciliations, and costs incurred.
//
// COUNTS, DELIBERATELY NOT MONEY. Where a reader wants the value beside a count, that value belongs
// to the financial report that owns it, and summing it again here would be a second answer.
//
// Each domain counts its own records (matters, billing, trust, costs) and this module only places the
// four answers side by side. The billing and trust counts are over records that never change, so
// they honor the knowledge instant; the matter and cost counts are over mutable records and are live.
// The response names the live sections in `liveSections` and says so in its own sentence, so a
// reproducible stamp is never read as covering them.

export type OperationalSection = "matters" | "billing" | "trust" | "costs";

export interface OperationalVolumesReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly locationId: string | null;
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  readonly liveSections: readonly OperationalSection[];
  readonly liveSectionsStatement: string;
  readonly completeness: ReportCompleteness;
  readonly matters: readonly MatterVolumeRow[];
  readonly billing: BillingVolumes;
  readonly trust: readonly TrustVolumeRow[];
  readonly costs: readonly CostVolumeRow[];
}

export function liveSectionsStatement(computedAt: string): string {
  return (
    `Matters opened and closed and costs incurred are counted as those records stood when this ` +
    `report was produced, at ${computedAt}: a matter can be reopened and a cost entry edited, so ` +
    `those two sections are live even when the rest of the report reproduces.`
  );
}

export async function assembleOperationalVolumes(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string | null;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<OperationalVolumesReport> {
  const period = resolveReportingPeriod(input, options.computedAt);
  const bounded = {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    knownAsOf: knowledgeBoundOf(period, options.computedAt),
    locationId: input.locationId,
  };
  const live = {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    locationId: input.locationId,
  };
  const [matters, billing, trust, costs] = await Promise.all([
    readMatterVolumes(database, live),
    readBillingVolumes(database, bounded),
    readTrustVolumes(database, bounded),
    readCostVolumes(database, live),
  ]);
  const reproducibility = reproducibilityOf(period, options.computedAt);
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    locationId: input.locationId,
    reproducibility,
    reproducibilityStatement: reproducibilityStatement(reproducibility),
    liveSections: ["matters", "costs"],
    liveSectionsStatement: liveSectionsStatement(options.computedAt),
    completeness: completeScope(),
    matters,
    billing,
    trust,
    costs,
  };
}
