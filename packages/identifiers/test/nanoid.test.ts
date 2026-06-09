import { describe, expect, it } from "vitest";
import { makeTokenGenerator, TOKEN_ALPHABET, TOKEN_SIZE } from "../src/nanoid.ts";
import { cryptoRandomSource, seededRandomSource } from "../src/random.ts";

describe("nanoid seam", () => {
  it("uses a 64-char URL-safe alphabet and a 21-char token (~126 bits)", () => {
    expect(TOKEN_SIZE).toBe(21);
    expect(TOKEN_ALPHABET).toHaveLength(64);
    expect(TOKEN_ALPHABET).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a token of TOKEN_SIZE chars from the alphabet", () => {
    const token = makeTokenGenerator(cryptoRandomSource)();
    expect(token).toHaveLength(TOKEN_SIZE);
    expect(token).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  it("is deterministic under a seeded source", () => {
    expect(makeTokenGenerator(seededRandomSource("seed"))()).toBe(
      makeTokenGenerator(seededRandomSource("seed"))(),
    );
  });
});
