// THE SEAM. This is the only file in the package that imports nanoid.
// Everything else uses the branded Identifier<T> types and the in-house functions built on this factory.
// If nanoid ever needed replacing, this one file is the swap target — consumers never see the library.
import { customRandom, urlAlphabet } from "nanoid";
import type { RandomSource } from "./random.ts";

// The URL-safe alphabet (64 symbols: A-Za-z0-9_-) and a 21-char token give ~126 bits of entropy —
// UUIDv4-class collision/guess resistance, the IDOR/unguessability bar of ADR-0062.
export const TOKEN_ALPHABET = urlAlphabet;
export const TOKEN_SIZE = 21;

// Build a token generator bound to a random source. customRandom calls the source with the byte count it
// needs; both cryptoRandomSource and seededRandomSource satisfy (bytes) => Uint8Array. The returned
// generator produces a TOKEN_SIZE-char token per call.
export function makeTokenGenerator(randomSource: RandomSource): () => string {
  return customRandom(TOKEN_ALPHABET, TOKEN_SIZE, randomSource);
}
