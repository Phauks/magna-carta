import { makeTokenGenerator, TOKEN_SIZE } from "./nanoid.ts";
import { cryptoRandomSource, type RandomSource } from "./random.ts";
import { ENTITY_PREFIXES, type EntityType } from "./registry.ts";
import type { BrandFor } from "./types.ts";

// The default-source generator is built once: the factory does per-construction setup (mask/step math,
// closure allocation) that would otherwise repeat on every row insert. Only the stateless CSPRNG default
// can be shared — a seeded source carries per-instance state, so non-default sources get a fresh generator.
const defaultTokenGenerator = makeTokenGenerator(cryptoRandomSource);

// Mint a new handle for an entity type: <prefix>_<token>. Uses the CSPRNG by default; fixtures pass a
// seededRandomSource for byte-deterministic ids.
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

// The UNIQUE-insert idiom, reused by idempotency and the outbox:
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

// Base64url is exactly the token alphabet (A-Za-z0-9-_), so a SHA-256 digest re-encoded this way lands
// in the same character class a minted token draws from and satisfies the same handle pattern.
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1] ?? 0;
    const third = bytes[offset + 2] ?? 0;
    const triple = (first << 16) | (second << 8) | third;
    // Emit all four sextets and let the caller truncate; padding is irrelevant because the digest is
    // longer than any token we slice out of it.
    out +=
      BASE64URL_ALPHABET[(triple >> 18) & 63]! +
      BASE64URL_ALPHABET[(triple >> 12) & 63]! +
      BASE64URL_ALPHABET[(triple >> 6) & 63]! +
      BASE64URL_ALPHABET[triple & 63]!;
  }
  return out;
}

// A CONTENT-ADDRESSED handle: the same seed always yields the same handle, for a row whose identity is
// determined by what it describes rather than by when it was created. The counterpart to
// newIdentifier's minted randomness — reach for this only when a caller must be able to recompute the
// handle from the same inputs, which is what makes a retried write converge on one row instead of
// inserting a second.
//
// The seed is the caller's, and it is hashed rather than encoded, so the handle leaks nothing about it:
// two seeds differing in one character produce unrelated tokens. SHA-256 truncated to the token length
// keeps ~126 bits — the same collision margin a minted token carries — and the result satisfies
// identifierPattern(type), so a derived handle is indistinguishable in shape from a minted one and
// passes the same validation. Async because it goes through Web Crypto, which is available in Workers,
// Node, and the browser alike.
export async function deriveIdentifier<T extends EntityType>(
  type: T,
  seed: string,
): Promise<BrandFor<T>> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  const token = base64url(new Uint8Array(digest)).slice(0, TOKEN_SIZE);
  return `${ENTITY_PREFIXES[type]}_${token}` as BrandFor<T>;
}
