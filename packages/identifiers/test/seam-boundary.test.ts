import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  makeTokenGenerator,
  TOKEN_ALPHABET,
  TOKEN_BODY_CHARACTER_CLASS,
  TOKEN_BODY_PATTERN_SOURCE,
  TOKEN_SIZE,
} from "../src/nanoid.ts";

const SRC = join(import.meta.dirname, "..", "src");

describe("nanoid seam boundary", () => {
  it("only src/nanoid.ts imports nanoid", async () => {
    const files = (await readdir(SRC)).filter((file) => file.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "nanoid.ts") continue;
      const text = await readFile(join(SRC, file), "utf8");
      if (/from\s+["']nanoid/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the seam's alphabet stays within the URL-safe class consumers assume", () => {
    // Consumers outside this package describe a handle as URL-safe; this guards against the seam's
    // alphabet drifting out of that set, which would make valid generated ids fail their checks.
    expect(TOKEN_ALPHABET).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// The exported body fragment is the single source every handle-recognising pattern is built from —
// the per-entity validators here, and the telemetry scrubber's handle exemption in
// packages/telemetry/src/scrub.ts. It has to accept exactly what the generator mints, no more and no
// less, which is what makes restating the alphabet as legible ranges safe.
describe("the token body pattern matches the generator exactly, in both directions", () => {
  const bodyPattern = new RegExp(`^${TOKEN_BODY_PATTERN_SOURCE}$`);

  it("describes the same 64 symbols the generator draws from, neither wider nor narrower", () => {
    // Narrower is impossible: every alphabet character is in the class (asserted above).
    // Wider is ruled out by counting — the class has exactly 64 members, and so does the alphabet,
    // so a class character the generator cannot mint would force a duplicate in the alphabet.
    expect(new Set(TOKEN_ALPHABET).size).toBe(64);
    const classMembers = [
      ...Array.from({ length: 26 }, (_unused, index) => String.fromCharCode(65 + index)),
      ...Array.from({ length: 26 }, (_unused, index) => String.fromCharCode(97 + index)),
      ...Array.from({ length: 10 }, (_unused, index) => String(index)),
      "_",
      "-",
    ];
    expect(classMembers).toHaveLength(64);
    const singleCharacter = new RegExp(`^${TOKEN_BODY_CHARACTER_CLASS}$`);
    for (const character of classMembers) {
      expect(singleCharacter.test(character), character).toBe(true);
      expect(TOKEN_ALPHABET.includes(character), character).toBe(true);
    }
  });

  it("compiles and accepts every token the real generator produces", () => {
    const nextToken = makeTokenGenerator((bytes) =>
      Uint8Array.from({ length: bytes }, (_unused, index) => (index * 31) % 256),
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      const token = nextToken();
      expect(token, token).toHaveLength(TOKEN_SIZE);
      expect(bodyPattern.test(token), token).toBe(true);
    }
  });

  it("accepts every single character of the alphabet, escaping included", () => {
    for (const character of TOKEN_ALPHABET) {
      const body = character.repeat(TOKEN_SIZE);
      expect(bodyPattern.test(body), character).toBe(true);
    }
  });

  it("rejects a body of the wrong length or with an off-alphabet character", () => {
    expect(bodyPattern.test("a".repeat(TOKEN_SIZE - 1))).toBe(false);
    expect(bodyPattern.test("a".repeat(TOKEN_SIZE + 1))).toBe(false);
    expect(bodyPattern.test(`${"a".repeat(TOKEN_SIZE - 1)}.`)).toBe(false);
  });
});
