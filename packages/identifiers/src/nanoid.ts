// THE SEAM. This is the only file in the package that imports nanoid.
// Everything else uses the branded Identifier<T> types and the in-house functions built on this factory.
// If nanoid ever needed replacing, this one file is the swap target — consumers never see the library.
import { customRandom, urlAlphabet } from "nanoid";
import type { RandomSource } from "./random.ts";

// The URL-safe alphabet (64 symbols: A-Za-z0-9_-) and a 21-char token give ~126 bits of entropy —
// UUIDv4-class collision/guess resistance, the IDOR/unguessability bar.
export const TOKEN_ALPHABET = urlAlphabet;
export const TOKEN_SIZE = 21;

// The token body as a regex fragment, and the character class it is built from. Every consumer that
// needs to recognise a minted handle builds its pattern from these rather than restating the shape:
// the per-entity validators in validate.ts, and the telemetry scrubber's handle exemption
// (packages/telemetry/src/scrub.ts), which must leave a whole handle intact or it corrupts the very
// Error ID a failure is keyed by. Changing the alphabet or the length therefore cannot leave a stale
// copy behind in a file nobody thinks to look at.
//
// The class is written as the ranges rather than derived by escaping TOKEN_ALPHABET's 64 scrambled
// characters, because it is not only an internal check: it is emitted verbatim as the `pattern` of
// every identifier field in the OpenAPI document, where a legible `[A-Za-z0-9_-]` is the difference
// between a readable contract and an unreadable one. A conformance test (test/seam-boundary.test.ts)
// pins the two together in both directions — the class and the alphabet describe the same 64 symbols
// — so this stays a restatement that cannot drift, not a second source of truth.
export const TOKEN_BODY_CHARACTER_CLASS = "[A-Za-z0-9_-]";
export const TOKEN_BODY_PATTERN_SOURCE = `${TOKEN_BODY_CHARACTER_CLASS}{${TOKEN_SIZE}}`;

// Build a token generator bound to a random source. customRandom calls the source with the byte count it
// needs; both cryptoRandomSource and seededRandomSource satisfy (bytes) => Uint8Array. The returned
// generator produces a TOKEN_SIZE-char token per call.
export function makeTokenGenerator(randomSource: RandomSource): () => string {
  return customRandom(TOKEN_ALPHABET, TOKEN_SIZE, randomSource);
}

// The same seam for a token that must live in a NARROWER alphabet than the URL-safe default — an
// email local part, for instance, cannot carry the default alphabet's '-'/'_' safely across every
// forwarder. The factory keeps the masking/rejection-sampling that removes modulo bias in one place;
// callers choose only the alphabet and the length (and own the entropy argument for that choice).
export function makeCustomTokenGenerator(
  alphabet: string,
  size: number,
  randomSource: RandomSource,
): () => string {
  return customRandom(alphabet, size, randomSource);
}
