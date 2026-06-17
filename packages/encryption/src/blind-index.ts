// Blind index: a keyed, deterministic, truncated digest of a normalized value that supports
// equality lookup over an encrypted column without decrypting it. The encrypted value stays
// opaque; only equality and frequency leak, a tradeoff accepted knowingly to make exact-match
// queries (an SSN, an account number, a driver's license) possible against sealed data.
//
// The output is version-prefixed and truncated to a configured bit length. Truncation bounds how
// much collision and lookup signal a stored index reveals; the prefix is the dual-read rotation
// seam, so a new scheme increments it ("2:") and both can be read during a migration.
//
// Frozen contract: committed golden vectors pin the exact output strings. Changing the truncation
// length or the normalize transform changes which values collide, so it is a new indexName (and a
// new derived subkey), never an edit to one already in use.

import { base64FromBytes } from "./base64.ts";

// The version prefix stamped on every value. Never stripped or changed; a new scheme is "2:".
const VERSION_PREFIX = "1:";

export interface BlindIndexSpec {
  readonly table: string;
  readonly field: string;
  // Versioned: changing the truncation length or the transform is a new indexName, which derives a
  // new subkey, so old and new indexes never collide.
  readonly indexName: string;
  // A transform from ./normalize. Applies NFC plus the field transform and throws NormalizeError on
  // input with nothing to index; that error is allowed to propagate.
  readonly normalize: (value: string) => string;
  readonly lengthBits: 16 | 24 | 32;
}

// Computes the blind index of a plaintext under a caller-supplied HMAC subkey.
//
// The spec's (table, field, indexName) are the caller's contract: they derive the subkey (via the
// key hierarchy's deriveIndexSubkey) and record the stored value's provenance. This function does
// not derive anything — it applies spec.normalize, signs the normalized bytes with the given
// subkey, truncates to spec.lengthBits, and version-prefixes the result.
//
// Algorithm (frozen): value = "1:" + base64( HMAC_SHA384( normalize(plaintext) )[0, lengthBits/8] ).
export async function computeBlindIndex(
  subkey: CryptoKey,
  spec: BlindIndexSpec,
  plaintext: string,
): Promise<string> {
  const normalized = spec.normalize(plaintext);
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", subkey, textEncoder.encode(normalized)),
  );
  const truncated = mac.slice(0, spec.lengthBits / 8);
  return VERSION_PREFIX + base64FromBytes(truncated);
}

const textEncoder = new TextEncoder();
