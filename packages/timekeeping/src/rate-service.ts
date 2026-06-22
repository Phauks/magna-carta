import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { RateCardId, RateId, UserId } from "@magna-carta/identifiers/types";
import { type AuditContext, timeAuditStatement } from "./audit.ts";
import { resolveRate } from "./rate-resolution.ts";
import { RateValidationError } from "./rate-validation.ts";
import {
  closePriorOpenRateStatement,
  insertRateCardStatement,
  insertRateStatement,
  type RateTier,
  selectRatesForScopeStatement,
} from "./rate-statements.ts";
import { computeAmountMinor } from "./rounding.ts";
import { reRateEntryStatement, selectReRateCandidatesStatement } from "./time-entry-statements.ts";

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids. The shared options shape every
// timekeeping service takes (mirrors ShipmentServiceOptions).
export interface ClockPort {
  now(): string;
}

export interface TimekeepingServiceOptions extends AuditContext {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

export interface CreateRateCardInput {
  readonly name: string;
}

export async function createRateCard(
  database: SqlDatabase,
  input: CreateRateCardInput,
  options: TimekeepingServiceOptions,
): Promise<{ rateCardId: RateCardId; effect: EffectWrite }> {
  const rateCardId = newIdentifier("rateCard", options.randomSource);
  const createdAt = options.clock.now();
  return {
    rateCardId,
    effect: {
      statements: [
        insertRateCardStatement(database, { id: rateCardId, name: input.name, createdAt }),
        timeAuditStatement(database, options, "rate_card.created", rateCardId),
      ],
      outboxMessages: [],
    },
  };
}

export interface AppendRateInput {
  readonly rateCardId: RateCardId;
  readonly tier: RateTier;
  readonly scopedId: string | null;
  readonly rateE4: number;
  readonly currency: string;
  readonly validFrom: string; // PlainDate
}

// Appends a new effective-dated version for one scope. Append-only: it never edits an existing rate,
// it closes the prior OPEN row's valid_to at the new valid_from in the SAME batch, so the [valid_from,
// valid_to) intervals stay contiguous and non-overlapping (resolution always matches exactly one).
// Closed-interval non-overlap is enforced here because SQLite has no range-exclusion constraint: a
// valid_from that lands on or before any existing version's valid_from is refused.
export async function appendRate(
  database: SqlDatabase,
  input: AppendRateInput,
  options: TimekeepingServiceOptions,
): Promise<{ rateId: RateId; effect: EffectWrite }> {
  const { results } = await selectRatesForScopeStatement(
    database,
    input.rateCardId,
    input.tier,
    input.scopedId,
  ).all<{ id: RateId; valid_from: string; valid_to: string | null }>();

  // A new version must start strictly after every existing version for the scope; otherwise it would
  // land inside (or before) an existing interval. The open row, if any, is the one we close.
  let openRow: { id: RateId; valid_from: string } | undefined;
  for (const row of results) {
    if (input.validFrom <= row.valid_from) {
      throw new RateValidationError(
        "overlapping-valid-from",
        `valid_from ${input.validFrom} overlaps an existing rate interval starting ${row.valid_from}`,
      );
    }
    if (row.valid_to === null) openRow = { id: row.id, valid_from: row.valid_from };
  }

  const rateId = newIdentifier("rate", options.randomSource);
  const createdAt = options.clock.now();
  const statements: SqlStatement[] = [];
  if (openRow !== undefined) {
    statements.push(closePriorOpenRateStatement(database, openRow.id, input.validFrom));
  }
  statements.push(
    insertRateStatement(database, {
      id: rateId,
      rateCardId: input.rateCardId,
      tier: input.tier,
      scopedId: input.scopedId,
      rateE4: input.rateE4,
      currency: input.currency,
      validFrom: input.validFrom,
      createdAt,
    }),
    timeAuditStatement(database, options, "rate.appended", rateId),
  );
  return { rateId, effect: { statements, outboxMessages: [] } };
}

export interface ReRateUnbilledDraftsInput {
  readonly rateCardId: RateCardId;
  readonly fromDate: string;
  readonly toDate: string;
}

// Re-resolves and rewrites the rate on every unbilled (draft/submitted/approved) entry the card
// produced over a work-date range — the opt-in retroactive correction, never automatic, so amounts
// never move silently. Billed/void rows are excluded by query AND by the statement's status guard, so a
// captured rate on a billed entry can never move. Each rewrite re-resolves on the entry's OWN work_date,
// so the effective-dated version in force on that date is the one applied. Batched into one EffectWrite.
export async function reRateUnbilledDrafts(
  database: SqlDatabase,
  input: ReRateUnbilledDraftsInput,
  options: TimekeepingServiceOptions,
): Promise<{ count: number; effect: EffectWrite }> {
  const { results } = await selectReRateCandidatesStatement(
    database,
    input.rateCardId,
    input.fromDate,
    input.toDate,
  ).all<{
    id: string;
    matter_id: string;
    timekeeper_user_id: string;
    work_date: string;
    duration_minutes: number;
    currency: string;
  }>();

  const statements: SqlStatement[] = [];
  const updatedAt = options.clock.now();
  for (const row of results) {
    const resolution = await resolveRate(database, {
      matterId: row.matter_id,
      clientId: null,
      timekeeperUserId: row.timekeeper_user_id,
      roleId: null,
      workDate: row.work_date,
      rateCardId: input.rateCardId,
    });
    // A candidate that no longer resolves a rate keeps its captured rate unchanged; re-rating only
    // rewrites when the new version is in force. Non-billable entries are excluded at the query level
    // (null rate_card_id) so they never appear here.
    if ("noRate" in resolution) continue;
    const amountMinor = computeAmountMinor(
      resolution.rateE4,
      row.duration_minutes,
      resolution.currency,
    );
    statements.push(
      reRateEntryStatement(
        database,
        row.id,
        resolution.rateE4,
        amountMinor,
        resolution.rateCardId,
        resolution.rateSource,
        updatedAt,
      ),
      timeAuditStatement(database, options, "time_entry.re_rated", row.id),
    );
  }

  return { count: statements.length / 2, effect: { statements, outboxMessages: [] } };
}
