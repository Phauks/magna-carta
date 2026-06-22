import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { TimeEntryId, UserId } from "@magna-carta/identifiers/types";
import type { RateResolution, RateSource } from "./rate-resolution.ts";
import {
  insertTimeEntryStatement,
  selectMatterEBillingStatement,
  type TimeEntrySource,
} from "./time-entry-statements.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids. Mirrors ShipmentServiceOptions.
export interface ClockPort {
  now(): string;
}

export interface TimekeepingServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// The resolved rate the route hands in: Task-7 RateResolution widened with the Task-4-computed
// amount_minor, so the service stores a frozen snapshot and never re-resolves or re-multiplies.
export type CaptureRate =
  | {
      readonly rateE4: number;
      readonly rateCardId: string;
      readonly rateSource: RateSource;
      readonly currency: string;
      readonly amountMinor: number;
    }
  | { readonly noRate: true };

export interface CaptureTimeEntryInput {
  readonly matterId: string;
  readonly timekeeperUserId: string;
  readonly workDate: string;
  readonly rawDurationMinutes: number;
  readonly durationMinutes: number;
  readonly narrative: string;
  readonly billable: boolean;
  readonly nonBillableCategoryId?: string;
  readonly source: TimeEntrySource;
  readonly utbmsTaskCodeId?: string;
  readonly utbmsActivityCodeId?: string;
  readonly liveRunId?: string;
  readonly currency: string;
  readonly rate: CaptureRate;
}

function audit(
  database: SqlDatabase,
  options: TimekeepingServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

async function isEBillingMatter(database: SqlDatabase, matterId: string): Promise<boolean> {
  const { results } = await selectMatterEBillingStatement(database, matterId).all<{
    e_billing: number;
  }>();
  return (results[0]?.e_billing ?? 0) === 1;
}

// The single WIP-store writer. The route has already resolved the rate (precedence + effective date)
// and rounded the duration, then folded both into `input.rate` — this composes the insert + audit into
// one EffectWrite. A null rate ("non-billable internal time") stores null rate columns; the table's
// amount_minor ⟺ rate_e4 paired-null CHECK keeps the two in lockstep.
export async function captureTimeEntry(
  database: SqlDatabase,
  input: CaptureTimeEntryInput,
  options: TimekeepingServiceOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  // An electronic-billing matter cannot carry a billable entry without a UTBMS task code — the LEDES
  // exporter rejects an uncoded line, so refusing here keeps an uncodeable entry out of the WIP store.
  if (input.billable && input.utbmsTaskCodeId === undefined && (await isEBillingMatter(database, input.matterId))) {
    throw new TimeEntryValidationError(
      "utbms-required",
      "an electronic-billing matter requires a UTBMS task code on a billable entry",
    );
  }

  const timeEntryId = newIdentifier("timeEntry", options.randomSource);
  const createdAt = options.clock.now();
  const billed = "noRate" in input.rate ? null : input.rate;

  return {
    timeEntryId,
    effect: {
      statements: [
        insertTimeEntryStatement(database, {
          id: timeEntryId,
          matterId: input.matterId,
          timekeeperUserId: input.timekeeperUserId,
          workDate: input.workDate,
          durationMinutes: input.durationMinutes,
          rawDurationMinutes: input.rawDurationMinutes,
          narrative: input.narrative,
          billable: input.billable ? 1 : 0,
          nonBillableCategoryId: input.nonBillableCategoryId ?? null,
          currency: input.currency,
          rateE4: billed?.rateE4 ?? null,
          rateCardId: billed?.rateCardId ?? null,
          rateSource: billed?.rateSource ?? null,
          amountMinor: billed?.amountMinor ?? null,
          utbmsTaskCodeId: input.utbmsTaskCodeId ?? null,
          utbmsActivityCodeId: input.utbmsActivityCodeId ?? null,
          source: input.source,
          liveRunId: input.liveRunId ?? null,
          createdAt,
          createdBy: options.actorUserId,
        }),
        audit(database, options, "time_entry.captured", timeEntryId),
      ],
      outboxMessages: [],
    },
  };
}
