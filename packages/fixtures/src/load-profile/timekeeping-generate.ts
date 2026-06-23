import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, RateCardId, UserId } from "@magna-carta/identifiers/types";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import { captureTimeEntry, type CaptureRate } from "@magna-carta/timekeeping/time-entry-service";
import { computeAmountMinor, roundDuration } from "@magna-carta/timekeeping/rounding";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { TimeVolume } from "./profile.ts";

// The timekeeping volume (rate cards + effective-dated rates + captured time entries). Every write rides
// a REAL domain service (createRateCard / appendRate / captureTimeEntry) — valid at any scale by
// construction. All randomness is drawn from the one FixtureContext; the module reads no wall-clock.
//
// It runs AFTER the practice generation: it binds its entries to the matters and the responsible member
// that generation laid down (passed in as probes), so the WIP store points at real matters.

// Probe identifiers the timekeeping measurement layer binds real queries to — deterministic for a given
// profile + seed, recorded in the snapshot manifest.
export interface TimeProbes {
  readonly busiestTimekeeperUserId: UserId; // the timekeeper with the most entries — the My Day / grid hot case
  readonly busiestMatterId: MatterId; // the matter with the most unbilled entries — the WIP read target
  readonly resolutionMatterId: MatterId; // a matter on a card with effective-dated rates — rate resolution
  readonly resolutionTimekeeperUserId: UserId;
  readonly rateCardId: RateCardId; // the card the resolution probe walks
  readonly probeWorkDate: string; // the work_date the My Day / grid reads target
}

export interface TimeGenerationResult {
  readonly timeEntryCount: number;
  readonly rateCount: number;
  readonly rateCardCount: number;
  readonly probes: TimeProbes;
}

// The inputs the practice generation already produced, threaded in so time entries bind to real matters.
export interface PracticeAttachPoints {
  readonly timekeeperUserId: UserId;
  readonly matterIds: readonly MatterId[];
}

const NARRATIVES = [
  "Drafted demand letter to opposing counsel",
  "Reviewed discovery responses",
  "Telephone conference with client re status",
  "Prepared motion to compel",
  "Legal research re statute of limitations",
  "Revised settlement agreement",
] as const;

// Add days to a civil PlainDate string (YYYY-MM-DD) without a wall-clock read — pure UTC arithmetic.
function addDays(plainDate: string, days: number): string {
  const at = new Date(`${plainDate}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export async function generateTimeVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: TimeVolume,
  attach: PracticeAttachPoints,
  options: SeedingOptions,
): Promise<TimeGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = { clock, actorUserId: attach.timekeeperUserId, randomSource };
  const commit = (effect: { statements: unknown[]; outboxMessages: unknown[] }) =>
    commitEffectBatch(database, effect as Parameters<typeof commitEffectBatch>[1], {
      now: () => clock.now(),
    });

  // --- Rate cards, each with effective-dated rate versions for the timekeeper tier. The first card is
  // the resolution probe target. The capture span starts at the clock's current civil date. ---
  const startDate = clock.today();
  const cards: RateCardId[] = [];
  let rateCount = 0;
  for (let cardIndex = 0; cardIndex < Math.max(1, volume.rateCardCount); cardIndex += 1) {
    const card = await createRateCard(
      database,
      { name: cardIndex === 0 ? "Standard" : `Card ${cardIndex + 1}` },
      serviceOptions,
    );
    await commit(card.effect);
    cards.push(card.rateCardId);

    // Versions march forward in non-overlapping intervals; appendRate closes the prior open row.
    let validFrom = addDays(startDate, -volume.spanDays - volume.ratesPerCard * 30);
    for (let version = 0; version < Math.max(1, volume.ratesPerCard); version += 1) {
      const rateResult = await appendRate(
        database,
        {
          rateCardId: card.rateCardId,
          tier: "timekeeper",
          scopedId: attach.timekeeperUserId,
          rateE4: 2_500_000 + version * 250_000, // $250.00/h, climbing per version (rate_e4, scale 4)
          currency: "USD",
          validFrom,
        },
        serviceOptions,
      );
      await commit(rateResult.effect);
      rateCount += 1;
      validFrom = addDays(validFrom, 30);
    }
  }
  const probeCardId = cards[0]!;

  // --- Captured entries spread across the span × the matters, on the busiest timekeeper. work_date
  // disperses day by day; each entry resolves its rate on its date and captures the snapshot. ---
  let timeEntryCount = 0;
  const matterEntryTally = new Map<MatterId, number>();
  const probeMatter = attach.matterIds[0]!;
  // The probe work_date sits inside the span so My Day / grid reads find a populated day.
  const probeWorkDate = addDays(startDate, -1);

  for (let dayOffset = 0; dayOffset < volume.spanDays; dayOffset += 1) {
    const workDate = addDays(startDate, -dayOffset);
    for (let index = 0; index < volume.entriesPerTimekeeperPerDay; index += 1) {
      const matterId =
        attach.matterIds[faker.number.int({ min: 0, max: attach.matterIds.length - 1 })]!;
      const rawDurationMinutes = faker.number.int({ min: 6, max: 240 });
      const durationMinutes = roundDuration(rawDurationMinutes, 6, "nearest");

      const resolution = await resolveRate(database, {
        matterId,
        clientId: null,
        timekeeperUserId: attach.timekeeperUserId,
        roleId: null,
        workDate,
        rateCardId: probeCardId,
      });

      // Build the CaptureRate from the resolution + the pre-computed amount.
      const captureRate: CaptureRate =
        "noRate" in resolution
          ? { noRate: true }
          : {
              rateE4: resolution.rateE4,
              rateCardId: resolution.rateCardId,
              rateSource: resolution.rateSource,
              currency: resolution.currency,
              amountMinor: computeAmountMinor(
                resolution.rateE4,
                durationMinutes,
                resolution.currency,
              ),
            };
      const currency = "noRate" in resolution ? "USD" : resolution.currency;

      const captured = await captureTimeEntry(
        database,
        {
          matterId,
          timekeeperUserId: attach.timekeeperUserId,
          workDate,
          rawDurationMinutes,
          durationMinutes,
          narrative: NARRATIVES[faker.number.int({ min: 0, max: NARRATIVES.length - 1 })]!,
          billable: true,
          source: index % 3 === 0 ? "manual" : "grid",
          currency,
          rate: captureRate,
        },
        serviceOptions,
      );
      await commit(captured.effect);
      timeEntryCount += 1;
      matterEntryTally.set(matterId, (matterEntryTally.get(matterId) ?? 0) + 1);
      clock.advanceMinutes(1);
    }
  }

  // The busiest matter by entry count — the unbilled-WIP read's hot case.
  let busiestMatter = probeMatter;
  let busiestCount = -1;
  for (const [matterId, count] of matterEntryTally) {
    if (count > busiestCount) {
      busiestCount = count;
      busiestMatter = matterId;
    }
  }

  return {
    timeEntryCount,
    rateCount,
    rateCardCount: cards.length,
    probes: {
      busiestTimekeeperUserId: attach.timekeeperUserId,
      busiestMatterId: busiestMatter,
      resolutionMatterId: probeMatter,
      resolutionTimekeeperUserId: attach.timekeeperUserId,
      rateCardId: probeCardId,
      probeWorkDate,
    },
  };
}
