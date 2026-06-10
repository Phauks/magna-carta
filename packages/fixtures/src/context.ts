import { Faker, en } from "@faker-js/faker";
import { type RandomSource, seededRandomSource } from "@magna-carta/identifiers/random";
import type { ClockPort } from "@magna-carta/ledger/types";

// All fixture time flows from this anchor; wall-clock reads are banned in fixtures (ADR-0034).
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

// FNV-1a: a deterministic string → uint32 for faker.seed(). Not cryptographic — doesn't need to be.
// Deliberately independent of the hash inside @magna-carta/identifiers/random (whose arithmetic
// differs subtly): each seeds its OWN consumer and the two never need to agree on a number — do not
// unify them or assert they match.
function seedNumber(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function fixtureContext(seed: string): FixtureContext {
  const faker = new Faker({ locale: [en] });
  faker.seed(seedNumber(seed));
  let currentMs = Date.parse(FIXTURE_EPOCH);
  const clock: FixtureClock = {
    now: () => new Date(currentMs).toISOString(),
    today: () => new Date(currentMs).toISOString().slice(0, 10),
    advanceMinutes: (minutes: number) => {
      currentMs += minutes * 60_000;
    },
  };
  return { seed, faker, clock, randomSource: seededRandomSource(seed) };
}
