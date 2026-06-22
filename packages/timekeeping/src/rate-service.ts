import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { RateCardId, RateId, UserId } from "@magna-carta/identifiers/types";
import { type AuditContext, timeAuditStatement } from "./audit.ts";
import { RateValidationError } from "./rate-validation.ts";
import {
  closePriorOpenRateStatement,
  insertRateCardStatement,
  insertRateStatement,
  type RateTier,
  selectRatesForScopeStatement,
} from "./rate-statements.ts";

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
