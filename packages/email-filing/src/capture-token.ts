import { makeCustomTokenGenerator } from "@magna-carta/identifiers/token";
import { cryptoRandomSource, type RandomSource } from "@magna-carta/identifiers/random";

// The forward/CC capture token — the whole local part of `<token>@<captureRootDomain>`, and therefore
// both a routing key and a bearer credential: anyone who knows it can post mail into the firm. It is
// always server-minted from the CSPRNG and never client-supplied.
//
// ALPHABET: lowercase letters + digits only.
//   - Lowercase, because the receiving worker lower-cases the local part before it looks the token up
//     (apps/email-worker/src/routing.ts) — a mixed-case token would simply never resolve.
//   - No '.' and no '+': both carry meaning to real mail systems (sub-addressing, dot-insensitivity at
//     some providers), so a token containing either can be rewritten in transit and stop matching.
//   - No '-' or '_' either: they survive less predictably through forwarders that re-wrap addresses,
//     and dropping them costs almost nothing at this length.
const CAPTURE_TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// 20 characters over 36 symbols is ~103 bits — comfortably past the unguessability bar for a bearer
// credential, while still short enough that a person can read one off a screen and type it.
export const CAPTURE_TOKEN_LENGTH = 20;

const defaultCaptureTokenGenerator = makeCustomTokenGenerator(
  CAPTURE_TOKEN_ALPHABET,
  CAPTURE_TOKEN_LENGTH,
  cryptoRandomSource,
);

// Mint one candidate token. Fixtures pass a seeded source for byte-deterministic tokens; everything
// else takes the CSPRNG default (whose generator is built once — the per-construction mask/step math
// would otherwise repeat on every mint).
export function newCaptureToken(randomSource: RandomSource = cryptoRandomSource): string {
  return randomSource === cryptoRandomSource
    ? defaultCaptureTokenGenerator()
    : makeCustomTokenGenerator(CAPTURE_TOKEN_ALPHABET, CAPTURE_TOKEN_LENGTH, randomSource)();
}

// A token is well-formed when it is exactly the minted shape. Used to reject anything that did not
// come out of this module before it is trusted as a routing key.
export function isWellFormedCaptureToken(candidate: string): boolean {
  if (candidate.length !== CAPTURE_TOKEN_LENGTH) return false;
  for (const character of candidate) {
    if (!CAPTURE_TOKEN_ALPHABET.includes(character)) return false;
  }
  return true;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export interface MintCaptureTokenOptions {
  randomSource?: RandomSource;
  maxAttempts?: number;
}

// The bounded UNIQUE-claim idiom, mirroring generateUniqueIdentifier in @magna-carta/identifiers:
// mint a candidate, hand it to `claim`, and retry with a FRESH candidate while `claim` reports the
// token already taken. `claim` returns true when the token is free (or was claimed), false on a
// collision; a THROWN error is fatal and propagates un-retried, because retrying an arbitrary
// database failure would mask a real fault (outage, missing table) as a collision.
//
// The capture token's uniqueness scope is GLOBAL — email_capture_route.token is the control plane's
// primary key across every firm — so the claim probe is what keeps one firm from minting a token that
// already routes to another. At ~103 bits a genuine collision is astronomically rare, so exhausting
// the attempts means the random source is broken (a seeded source reused where uniqueness matters):
// fail loud rather than loop.
export async function mintUniqueCaptureToken(
  claim: (candidate: string) => boolean | Promise<boolean>,
  options: MintCaptureTokenOptions = {},
): Promise<string> {
  const { randomSource = cryptoRandomSource, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = newCaptureToken(randomSource);
    if (await claim(candidate)) return candidate;
  }
  throw new Error(
    `mintUniqueCaptureToken: ${maxAttempts} attempts collided — check the random source`,
  );
}

// How much of a token a list response may show. The token IS the credential, so a list never returns
// it whole; it returns this prefix so a person can tell two addresses apart, plus the metadata. Four
// characters identify a row among a matter's handful of addresses while leaving ~83 bits unknown.
const TOKEN_PREVIEW_LENGTH = 4;

export function maskCaptureToken(token: string): string {
  return `${token.slice(0, TOKEN_PREVIEW_LENGTH)}...`;
}
