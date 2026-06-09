import { describe, expect, it } from "vitest";
import { generateUniqueIdentifier, newIdentifier } from "../src/generate.ts";
import { seededRandomSource } from "../src/random.ts";
import type { MatterId } from "../src/types.ts";

describe("newIdentifier", () => {
  it("builds a <prefix>_<token> handle with the registered prefix", () => {
    const id = newIdentifier("matter");
    expect(id).toMatch(/^mat_[A-Za-z0-9_-]{21}$/);
    expect(newIdentifier("document")).toMatch(/^doc_[A-Za-z0-9_-]{21}$/);
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
    expect(id).toMatch(/^mat_/);
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
    expect(id).toMatch(/^inv_/);
  });

  it("throws after exhausting maxAttempts (signals a broken random source)", async () => {
    await expect(
      generateUniqueIdentifier("matter", () => false, { maxAttempts: 3 }),
    ).rejects.toThrow(/3 attempts/);
  });
});
