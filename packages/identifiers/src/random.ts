// A source of random bytes. This is exactly nanoid's getRandom contract — (byteCount) => Uint8Array —
// so a RandomSource can be handed straight to the seam's token generator (see ./nanoid.ts).
export type RandomSource = (bytes: number) => Uint8Array;

// Default: the Web Crypto CSPRNG, a global in Workers, Node, and the test runner.
export const cryptoRandomSource: RandomSource = (bytes) =>
  crypto.getRandomValues(new Uint8Array(bytes));

// Deterministic source for fixtures: the same seed yields the same byte sequence, so fixture
// ids are byte-identical run to run. NOT cryptographic — fixtures only — it exists for reproducibility.
// mulberry32 (a tiny, well-known seedable PRNG) drives the bytes; the seed string is folded to 32-bit
// state with FNV-1a so a human-readable seed ("contingency-scenario") works as well as a number.
export function seededRandomSource(seed: string | number): RandomSource {
  let state = hashSeed(seed);
  return (bytes) => {
    const out = new Uint8Array(bytes);
    for (let index = 0; index < bytes; index++) {
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      out[index] = (mixed ^ (mixed >>> 14)) & 0xff;
    }
    return out;
  };
}

// FNV-1a 32-bit hash of the seed's string form — maps any seed to an unsigned 32-bit PRNG state.
// Exported for other seeded consumers (the fixtures harness seeds faker with it): one FNV-1a in
// the codebase, not per-package copies. Each consumer still derives its OWN stream from the hash.
export function hashSeed(seed: string | number): number {
  const text = typeof seed === "number" ? seed.toString() : seed;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
