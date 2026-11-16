import {
  readBillingArrangementsOnDate,
  type AdvanceDepositDestination,
  type BillingArrangementKind,
  type BillingArrangementSnapshot,
  type ContingencyBasis,
} from "@magna-carta/billing/arrangements";
import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { readMatterRegister } from "@magna-carta/matters/matter-register";
import {
  readMatterAndClientRatesInForce,
  type ScopedRateInForce,
} from "@magna-carta/timekeeping/rate-resolution";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";

// MATTER BILLING GUIDE — how every open and held matter is billed today: the fee agreement that
// governs today, any amendment already recorded to start later, and the rates recorded against the
// matter itself or against its client on the firm's rate cards.
//
// Nothing here is decided by this module. The matters are the matters package's register (the
// Matters List's own rows, open and held only); the agreement is billing's own read of the version
// governing a date; the rates are timekeeping's read of the matter-tier and client-tier versions in
// force, through the same in-force test the rate engine resolves with. This module puts the three
// side by side and counts matters by kind. It does not resolve any timekeeper's effective rate: the
// timekeeper and role tiers price people, and a matter with no rate of its own is priced by them.
// test/financial-matter-billing-guide.test.ts proves every open and held matter of the Matters List
// is here once, and that each agreement shown is billing's.
//
// LIVE ONLY. Matters, agreements and rate cards all change, so the report answers for the day it is
// produced (the UTC day of `computedAt`) and is not claimed to reproduce.

export interface MatterBillingTerms {
  readonly arrangementId: string;
  readonly version: number;
  readonly kind: BillingArrangementKind;
  readonly flatFeeAmountMinor: number | null;
  readonly contingencyShareE4: number | null;
  readonly contingencyBasis: ContingencyBasis | null;
  readonly retainerTargetMinor: number | null;
  readonly retainerThresholdMinor: number | null;
  readonly advanceDepositDestination: AdvanceDepositDestination | null;
  readonly currency: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export interface MatterBillingRate {
  readonly rateId: string;
  readonly rateCardId: string;
  readonly rateCardName: string;
  readonly tier: "matter" | "client";
  readonly rateE4: number;
  readonly currency: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export interface MatterBillingGuideRow {
  readonly matterId: string;
  readonly matterNumber: string | null;
  readonly matterTitle: string;
  readonly status: "open" | "hold";
  readonly clientEntityId: string | null;
  readonly clientName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly responsibleName: string | null;
  /** The agreement governing today; null when none is recorded, which bills hourly by absence. */
  readonly arrangement: MatterBillingTerms | null;
  /** An amendment already recorded to start after today, if there is one. */
  readonly nextArrangement: MatterBillingTerms | null;
  readonly rates: readonly MatterBillingRate[];
}

export interface MatterBillingKindCounts {
  readonly matterCount: number;
  readonly hourlyCount: number;
  readonly flatFeeCount: number;
  readonly contingencyCount: number;
  readonly retainerCount: number;
  readonly noneRecordedCount: number;
}

export interface MatterBillingGuideReport {
  readonly computedAt: string;
  readonly asOfDate: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly completeness: ReportCompleteness;
  readonly totals: MatterBillingKindCounts;
  readonly matters: readonly MatterBillingGuideRow[];
}

export function matterBillingGuideStatement(computedAt: string, asOfDate: string): string {
  return (
    `This report shows how each open and held matter is billed on ${asOfDate}, as recorded when it was produced, at ${computedAt}. ` +
    `A fee agreement can be amended, a matter moved or closed and a rate card changed, so it is a live report: ` +
    `running it again later will reflect any change made in the meantime, and it is not claimed to reproduce.`
  );
}

function termsOf(snapshot: BillingArrangementSnapshot | undefined): MatterBillingTerms | null {
  if (snapshot === undefined) return null;
  return {
    arrangementId: snapshot.id,
    version: snapshot.version,
    kind: snapshot.kind,
    flatFeeAmountMinor: snapshot.flatFeeAmountMinor,
    contingencyShareE4: snapshot.contingencyShareE4,
    contingencyBasis: snapshot.contingencyBasis,
    retainerTargetMinor: snapshot.retainerTargetMinor,
    retainerThresholdMinor: snapshot.retainerThresholdMinor,
    advanceDepositDestination: snapshot.advanceDepositDestination,
    currency: snapshot.currency,
    validFrom: snapshot.validFrom,
    validTo: snapshot.validTo,
  };
}

function rateOf(rate: ScopedRateInForce): MatterBillingRate {
  return {
    rateId: rate.rateId,
    rateCardId: rate.rateCardId,
    rateCardName: rate.rateCardName,
    tier: rate.tier,
    rateE4: rate.rateE4,
    currency: rate.currency,
    validFrom: rate.validFrom,
    validTo: rate.validTo,
  };
}

class KindCounter {
  private readonly counts = {
    matterCount: 0,
    hourlyCount: 0,
    flatFeeCount: 0,
    contingencyCount: 0,
    retainerCount: 0,
    noneRecordedCount: 0,
  };

  take(arrangement: MatterBillingTerms | null): void {
    this.counts.matterCount += 1;
    if (arrangement === null) this.counts.noneRecordedCount += 1;
    else if (arrangement.kind === "hourly") this.counts.hourlyCount += 1;
    else if (arrangement.kind === "flat_fee") this.counts.flatFeeCount += 1;
    else if (arrangement.kind === "contingency") this.counts.contingencyCount += 1;
    else this.counts.retainerCount += 1;
  }

  result(): MatterBillingKindCounts {
    return { ...this.counts };
  }
}

export async function assembleMatterBillingGuide(
  database: SqlDatabase,
  input: { readonly locationId: string | null },
  options: { readonly computedAt: string },
): Promise<MatterBillingGuideReport> {
  const asOfDate = civilDateOf(options.computedAt);
  const [register, arrangements, rates] = await Promise.all([
    readMatterRegister(database, input),
    readBillingArrangementsOnDate(database, asOfDate),
    readMatterAndClientRatesInForce(database, asOfDate),
  ]);
  if (register.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "the firm has more matters than one report can list; choose an office to narrow it",
    );
  }

  // The scoped id of a client-tier rate is the client's directory entity: the same client the
  // register attributes each matter to.
  const ratesByScope = new Map<string, MatterBillingRate[]>();
  for (const rate of rates) {
    const key = `${rate.tier}:${rate.scopedId}`;
    const list = ratesByScope.get(key) ?? [];
    list.push(rateOf(rate));
    ratesByScope.set(key, list);
  }

  const totals = new KindCounter();
  const matters: MatterBillingGuideRow[] = [];
  for (const row of register.rows) {
    if (row.status !== "open" && row.status !== "hold") continue;
    const onDate = arrangements.get(row.matterId as MatterId);
    const arrangement = termsOf(onDate?.onDate);
    totals.take(arrangement);
    matters.push({
      matterId: row.matterId,
      matterNumber: row.matterNumber,
      matterTitle: row.matterTitle,
      status: row.status,
      clientEntityId: row.clientEntityId,
      clientName: row.clientName,
      locationId: row.locationId,
      locationName: row.locationName,
      responsibleName: row.responsibleName,
      arrangement,
      nextArrangement: termsOf(onDate?.next),
      rates: [
        ...(ratesByScope.get(`matter:${row.matterId}`) ?? []),
        ...(row.clientEntityId === null
          ? []
          : (ratesByScope.get(`client:${row.clientEntityId}`) ?? [])),
      ],
    });
  }

  return {
    computedAt: options.computedAt,
    asOfDate,
    reproducible: false,
    statement: matterBillingGuideStatement(options.computedAt, asOfDate),
    locationId: input.locationId,
    completeness: completeScope(),
    totals: totals.result(),
    matters,
  };
}
