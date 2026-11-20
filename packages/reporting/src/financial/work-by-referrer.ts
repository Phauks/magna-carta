import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readEntityReferrals, type EntityReferral } from "@magna-carta/directory/referrals";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import {
  reproducibilityOf,
  reproducibilityStatement,
  type ReportingReproducibility,
} from "../temporal.ts";
import {
  byBilledThenCollected,
  figuresOf,
  groupBy,
  matterCountOf,
  readRevenueMovements,
  type RevenueFigures,
  type RevenueMovement,
} from "./revenue.ts";

// WORK BY REFERRER — which sources and people send the firm its work, and what that work billed and
// collected.
//
// The money is Revenue's, movement for movement (`readRevenueMovements`): the Invoices billed rows and
// the Payments Applied rows effective in the period. Each movement belongs to the client its bill was
// issued to, and is grouped by how that client found the firm: first by the SOURCE on the firm's list,
// then within a source by the person or organization who REFERRED the client. Clients with a referrer
// and no source stand in their own group, and clients with nothing recorded in another, so every
// movement lands in exactly one row and the report's totals are Revenue's totals for the same period.
//
// A referral keeps no history, so the money is counted under the referral each client has NOW, and
// the response says so in `attributionStatement`.

/** How a group's clients came to be in it. */
export type ReferralGroupKind = "source" | "referrerOnly" | "notRecorded";

export interface WorkByReferrerReferrerRow {
  /** Null for the clients in the group with no referrer recorded. */
  readonly referrerEntityId: string | null;
  readonly referrerName: string | null;
  readonly clientCount: number;
  readonly matterCount: number;
  readonly figures: RevenueFigures;
}

export interface WorkByReferrerSourceRow {
  readonly kind: ReferralGroupKind;
  /** Null unless `kind` is `source`. */
  readonly sourceId: string | null;
  readonly sourceName: string | null;
  readonly sourceArchived: boolean;
  readonly clientCount: number;
  readonly matterCount: number;
  readonly figures: RevenueFigures;
  readonly referrers: readonly WorkByReferrerReferrerRow[];
}

export interface WorkByReferrerReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly reproducibility: ReportingReproducibility;
  readonly reproducibilityStatement: string;
  /** What the money is and whose referral it is counted under. */
  readonly attributionStatement: string;
  readonly completeness: ReportCompleteness;
  readonly totals: RevenueFigures;
  readonly sources: readonly WorkByReferrerSourceRow[];
}

export const WORK_BY_REFERRER_ATTRIBUTION_STATEMENT =
  "Billed and collected are the Revenue report's figures for the same period. Each bill's money is counted under the referral its client has now: the source on the firm's list, then the person or organization who referred them.";

const clientCountOf = (movements: readonly RevenueMovement[]): number =>
  new Set(movements.map((movement) => movement.clientEntityId)).size;

const GROUP_ORDER: Readonly<Record<ReferralGroupKind, number>> = {
  source: 0,
  referrerOnly: 1,
  notRecorded: 2,
};

function groupKey(referral: EntityReferral | undefined): string {
  if (referral === undefined) return "notRecorded";
  if (referral.source === null) return "referrerOnly";
  return `source:${referral.source.id}`;
}

export async function assembleWorkByReferrer(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string | null;
    readonly locationId: string | null;
  },
  options: { readonly computedAt: string },
): Promise<WorkByReferrerReport> {
  const { period, movements } = await readRevenueMovements(database, input, options);

  const referralOf = new Map<string, EntityReferral>(
    (
      await readEntityReferrals(database, [
        ...new Set(movements.map((movement) => movement.clientEntityId)),
      ])
    ).map((referral) => [referral.entityId, referral]),
  );
  const referred = (movement: RevenueMovement) => referralOf.get(movement.clientEntityId);

  const sources = groupBy(movements, (movement) => groupKey(referred(movement)))
    .map((group): WorkByReferrerSourceRow => {
      const first = group[0] === undefined ? undefined : referred(group[0]);
      const kind: ReferralGroupKind =
        first === undefined ? "notRecorded" : first.source === null ? "referrerOnly" : "source";
      return {
        kind,
        sourceId: first?.source?.id ?? null,
        sourceName: first?.source?.name ?? null,
        sourceArchived: first?.source?.archived ?? false,
        clientCount: clientCountOf(group),
        matterCount: matterCountOf(group),
        figures: figuresOf(group),
        referrers:
          kind === "notRecorded"
            ? []
            : groupBy(group, (movement) => referred(movement)?.referrer?.entityId ?? "")
                .map((referrerGroup) => {
                  const referrer =
                    referrerGroup[0] === undefined ? null : referred(referrerGroup[0])?.referrer;
                  return {
                    referrerEntityId: referrer?.entityId ?? null,
                    referrerName: referrer?.displayName ?? null,
                    clientCount: clientCountOf(referrerGroup),
                    matterCount: matterCountOf(referrerGroup),
                    figures: figuresOf(referrerGroup),
                  };
                })
                .sort(byBilledThenCollected),
      };
    })
    .sort(
      (left, right) =>
        GROUP_ORDER[left.kind] - GROUP_ORDER[right.kind] || byBilledThenCollected(left, right),
    );

  const reproducibility = reproducibilityOf(period, options.computedAt);
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    locationId: input.locationId,
    currency: "USD",
    reproducibility,
    reproducibilityStatement: reproducibilityStatement(reproducibility),
    attributionStatement: WORK_BY_REFERRER_ATTRIBUTION_STATEMENT,
    completeness: completeScope(),
    totals: figuresOf(movements),
    sources,
  };
}
