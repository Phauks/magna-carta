import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { Faker, en } from "@faker-js/faker";
import { hashSeed, type RandomSource, seededRandomSource } from "@magna-carta/identifiers/random";
import type { ClockPort } from "@magna-carta/ledger/types";

// All fixture time flows from this anchor; wall-clock reads are banned in fixtures.
export const FIXTURE_EPOCH = "2026-01-05T09:00:00.000Z";

export interface FixtureClock extends ClockPort {
  advanceMinutes(minutes: number): void;
}

export interface FixtureContext {
  readonly seed: string;
  readonly faker: Faker;
  readonly clock: FixtureClock;
  readonly randomSource: RandomSource;
}

export function fixtureContext(seed: string): FixtureContext {
  const faker = new Faker({ locale: [en] });
  // hashSeed is identifiers' FNV-1a (one hash, one home — a local copy here used to claim it
  // "differed subtly"; it did not). faker and the id source each derive their own independent
  // stream from the same hash, so sharing it costs no determinism.
  faker.seed(hashSeed(seed));
  let currentMs = Date.parse(FIXTURE_EPOCH);
  const clock: FixtureClock = {
    now: () => new Date(currentMs).toISOString(),
    today: () => civilDateOf(new Date(currentMs)),
    advanceMinutes: (minutes: number) => {
      currentMs += minutes * 60_000;
    },
  };
  return { seed, faker, clock, randomSource: seededRandomSource(seed) };
}
