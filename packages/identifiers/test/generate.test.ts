import { describe, expect, it } from "vitest";
import { deriveIdentifier, generateUniqueIdentifier, newIdentifier } from "../src/generate.ts";
import { seededRandomSource } from "../src/random.ts";
import { identifierPattern, isIdentifier } from "../src/validate.ts";
import type { MatterId } from "../src/types.ts";

describe("newIdentifier", () => {
  it("builds a <prefix>_<token> handle with the registered prefix", () => {
    const id = newIdentifier("matter");
    expect(id).toMatch(/^matter_[A-Za-z0-9_-]{21}$/);
    expect(newIdentifier("document")).toMatch(/^document_[A-Za-z0-9_-]{21}$/);
  });

  it("returns the entity's brand (compile-time) and is assignable to string", () => {
    const matterId: MatterId = newIdentifier("matter"); // must compile (correct brand)
    const asString: string = matterId; // branded id flows into string
    expect(typeof asString).toBe("string");
  });

  it("is deterministic with a seeded source: same seed -> same id sequence", () => {
    const sequence = (seed: string) => {
      const source = seededRandomSource(seed);
      return [newIdentifier("matter", source), newIdentifier("matter", source)];
    };
    expect(sequence("a")).toEqual(sequence("a"));
    expect(sequence("a")).not.toEqual(sequence("b"));
  });
});

describe("generateUniqueIdentifier", () => {
  it("returns the candidate on the first successful insert", async () => {
    let calls = 0;
    const id = await generateUniqueIdentifier("matter", () => {
      calls++;
      return true;
    });
    expect(calls).toBe(1);
    expect(id).toMatch(/^matter_/);
  });

  it("retries on collision with a fresh candidate each time, then succeeds", async () => {
    const candidates: string[] = [];
    const id = await generateUniqueIdentifier("matter", (candidate) => {
      candidates.push(candidate);
      return candidates.length >= 3; // first two "collide", third "inserts"
    });
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates).size).toBe(3); // each retry generated a distinct candidate
    expect(id).toBe(candidates[2]);
  });

  it("supports an async tryInsert", async () => {
    const id = await generateUniqueIdentifier("invoice", async () => Promise.resolve(true));
    expect(id).toMatch(/^invoice_/);
  });

  it("throws after exhausting maxAttempts (signals a broken random source)", async () => {
    await expect(
      generateUniqueIdentifier("matter", () => false, { maxAttempts: 3 }),
    ).rejects.toThrow(/3 attempts/);
  });

  it("propagates a thrown tryInsert error immediately — a throw is fatal, not a collision", async () => {
    let calls = 0;
    const databaseFailure = new Error("D1_ERROR: no such table");
    await expect(
      generateUniqueIdentifier("matter", () => {
        calls++;
        throw databaseFailure;
      }),
    ).rejects.toBe(databaseFailure);
    expect(calls).toBe(1); // no retry — retrying arbitrary database errors would mask real failures
  });
});

describe("deriveIdentifier", () => {
  it("builds a handle indistinguishable in shape from a minted one", async () => {
    const derived = await deriveIdentifier("indexSplit", "file_abc:1");
    expect(derived).toMatch(identifierPattern("indexSplit"));
    expect(isIdentifier(derived, "indexSplit")).toBe(true);
  });

  it("is reproducible — the same seed always yields the same handle", async () => {
    const first = await deriveIdentifier("indexSplit", "file_abc:1");
    const second = await deriveIdentifier("indexSplit", "file_abc:1");
    expect(second).toBe(first);
  });

  it("separates seeds that differ by one character", async () => {
    const version1 = await deriveIdentifier("indexSplit", "file_abc:1");
    const version2 = await deriveIdentifier("indexSplit", "file_abc:2");
    expect(version2).not.toBe(version1);
    // Hashed, not encoded: neighbouring seeds must not produce neighbouring tokens, or the handle
    // would leak the structure of what it was derived from.
    const token1 = version1.slice("indexSplit_".length);
    const token2 = version2.slice("indexSplit_".length);
    expect(token1.slice(0, 4)).not.toBe(token2.slice(0, 4));
  });

  it("keys off the entity type, so one seed cannot be read as two kinds of handle", async () => {
    const asSplit = await deriveIdentifier("indexSplit", "shared-seed");
    const asMatter = await deriveIdentifier("matter", "shared-seed");
    expect(isIdentifier(asSplit, "matter")).toBe(false);
    expect(isIdentifier(asMatter, "indexSplit")).toBe(false);
  });
});
