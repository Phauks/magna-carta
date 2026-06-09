import { makeTokenGenerator } from "./nanoid.ts";
import { cryptoRandomSource, type RandomSource } from "./random.ts";
import { ENTITY_PREFIXES, type EntityType } from "./registry.ts";
import type { BrandFor } from "./types.ts";

// The default-source generator is built once: the factory does per-construction setup (mask/step math,
// closure allocation) that would otherwise repeat on every row insert. Only the stateless CSPRNG default
// can be shared — a seeded source carries per-instance state, so non-default sources get a fresh generator.
const defaultTokenGenerator = makeTokenGenerator(cryptoRandomSource);

// Mint a new handle for an entity type: <prefix>_<token>. Uses the CSPRNG by default; fixtures pass a
// seededRandomSource for byte-deterministic ids (ADR-0034).
export function newIdentifier<T extends EntityType>(
  type: T,
  randomSource: RandomSource = cryptoRandomSource,
): BrandFor<T> {
  const token =
    randomSource === cryptoRandomSource
      ? defaultTokenGenerator()
      : makeTokenGenerator(randomSource)();
  return `${ENTITY_PREFIXES[type]}_${token}` as BrandFor<T>;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export interface GenerateUniqueOptions {
  randomSource?: RandomSource;
  maxAttempts?: number;
}

// The UNIQUE-insert idiom (ADR-0062), reused by idempotency (ADR-0063) and the outbox (ADR-0064):
// generate a candidate and hand it to tryInsert, which performs the real INSERT … ON CONFLICT and returns
// true on success / false on a primary-key collision. Retry with a FRESH candidate up to maxAttempts.
// A thrown error from tryInsert is fatal and propagates un-retried — only a `false` return signals a
// collision; retrying arbitrary database errors would mask real failures (outage, missing table, bad SQL).
// At ~126 bits a genuine collision is astronomically rare, so exhausting attempts means the random source
// is broken (e.g. a seeded source reused where uniqueness is required) — fail loud rather than loop.
export async function generateUniqueIdentifier<T extends EntityType>(
  type: T,
  tryInsert: (candidate: BrandFor<T>) => boolean | Promise<boolean>,
  options: GenerateUniqueOptions = {},
): Promise<BrandFor<T>> {
  const { randomSource = cryptoRandomSource, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = newIdentifier(type, randomSource);
    if (await tryInsert(candidate)) return candidate;
  }
  throw new Error(
    `generateUniqueIdentifier: ${maxAttempts} attempts collided for "${type}" — check the random source`,
  );
}
