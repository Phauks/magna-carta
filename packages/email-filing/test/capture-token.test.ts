import { seededRandomSource } from "@magna-carta/identifiers/random";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_TOKEN_LENGTH,
  isWellFormedCaptureToken,
  maskCaptureToken,
  mintUniqueCaptureToken,
  newCaptureToken,
} from "../src/capture-token.ts";

describe("capture token", () => {
  it("mints lowercase alphanumeric tokens of the fixed length", () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const token = newCaptureToken();
      expect(token).toHaveLength(CAPTURE_TOKEN_LENGTH);
      expect(token).toMatch(/^[a-z0-9]+$/);
    }
  });

  // The characters a mail system may rewrite or read as structure. A token carrying one of these can
  // arrive at the receiving worker in a shape that no longer matches what was minted.
  it("never mints a character a forwarder could reinterpret", () => {
    const joined = Array.from({ length: 200 }, () => newCaptureToken()).join("");
    for (const forbidden of [".", "+", "-", "_", "@"]) {
      expect(joined).not.toContain(forbidden);
    }
    expect(joined).toBe(joined.toLowerCase());
  });

  it("recognizes its own shape and rejects anything else", () => {
    expect(isWellFormedCaptureToken(newCaptureToken())).toBe(true);
    expect(isWellFormedCaptureToken("short")).toBe(false);
    expect(isWellFormedCaptureToken("A".repeat(CAPTURE_TOKEN_LENGTH))).toBe(false);
    expect(isWellFormedCaptureToken(`a.${"b".repeat(CAPTURE_TOKEN_LENGTH - 2)}`)).toBe(false);
  });

  it("retries with a fresh candidate when a claim reports a collision", async () => {
    const offered: string[] = [];
    const token = await mintUniqueCaptureToken((candidate) => {
      offered.push(candidate);
      return offered.length > 2; // the first two candidates are refused
    });
    expect(offered).toHaveLength(3);
    expect(token).toBe(offered[2]);
    expect(new Set(offered).size).toBe(3); // every retry used a FRESH candidate, never the same one
  });

  it("fails loud rather than looping when every attempt collides", async () => {
    await expect(mintUniqueCaptureToken(() => false, { maxAttempts: 4 })).rejects.toThrow(
      /4 attempts collided/,
    );
  });

  it("propagates a thrown claim un-retried — a database fault is not a collision", async () => {
    let calls = 0;
    await expect(
      mintUniqueCaptureToken(() => {
        calls++;
        throw new Error("database unavailable");
      }),
    ).rejects.toThrow("database unavailable");
    expect(calls).toBe(1);
  });

  it("is byte-deterministic from a seeded source, for fixtures", () => {
    expect(newCaptureToken(seededRandomSource("capture"))).toBe(
      newCaptureToken(seededRandomSource("capture")),
    );
  });

  it("masks a token down to a prefix that cannot be used", () => {
    const token = newCaptureToken();
    const masked = maskCaptureToken(token);
    expect(masked).toBe(`${token.slice(0, 4)}...`);
    expect(masked.length).toBeLessThan(token.length);
  });
});
