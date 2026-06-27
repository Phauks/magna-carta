import { describe, expect, it } from "vitest";
import type { RawScanResult } from "../src/scan-port.ts";
import { lookupScanCache, recordScanCacheStatement } from "../src/scan-cache.ts";
import { freshDatabase } from "./support.ts";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const ENGINE = "clamav+yara-x/1.18.0+heuristics/1";
const NEWER_ENGINE = "clamav+yara-x/1.18.0+heuristics/2";

const CLEAN_RAW: RawScanResult = {
  engineVersion: ENGINE,
  clam: { state: "clean" },
  heuristic: { kind: "none" },
  matches: [],
  timings: { clamdMs: 3, yaraMs: 2 },
};

const INFECTED_RAW: RawScanResult = {
  engineVersion: ENGINE,
  clam: { state: "infected", signature: "Eicar-Test-Signature" },
  heuristic: { kind: "none" },
  matches: [],
  timings: { clamdMs: 4, yaraMs: 1 },
};

describe("scan_cache (content dedup, scan-once)", () => {
  it("returns undefined on a miss", async () => {
    const database = freshDatabase();
    expect(await lookupScanCache(database, HASH, ENGINE)).toBeUndefined();
  });

  it("round-trip: records a RawScanResult then reads it back equal", async () => {
    const database = freshDatabase();
    await database.batch([
      recordScanCacheStatement(database, HASH, CLEAN_RAW, "2026-06-25T00:00:00.000Z"),
    ]);
    expect(await lookupScanCache(database, HASH, ENGINE)).toEqual(CLEAN_RAW);
  });

  it("records an infected raw result with its signature and reads it back equal", async () => {
    const database = freshDatabase();
    await database.batch([
      recordScanCacheStatement(database, HASH, INFECTED_RAW, "2026-06-25T00:00:00.000Z"),
    ]);
    expect(await lookupScanCache(database, HASH, ENGINE)).toEqual(INFECTED_RAW);
  });

  it("a DIFFERENT engine version is a MISS — a DB update invalidates the cache (no stale result)", async () => {
    const database = freshDatabase();
    await database.batch([
      recordScanCacheStatement(database, HASH, CLEAN_RAW, "2026-06-25T00:00:00.000Z"),
    ]);
    // The same content under a newer engine must NOT hit — it gets re-scanned under the new signatures.
    expect(await lookupScanCache(database, HASH, NEWER_ENGINE)).toBeUndefined();
    // And it does not leak to a different content hash.
    expect(await lookupScanCache(database, OTHER_HASH, ENGINE)).toBeUndefined();
  });

  it("upserts on conflict — re-recording the same (content, engine) keeps one row", async () => {
    const database = freshDatabase();
    await database.batch([
      recordScanCacheStatement(database, HASH, CLEAN_RAW, "2026-06-25T00:00:00.000Z"),
    ]);
    await database.batch([
      recordScanCacheStatement(database, HASH, CLEAN_RAW, "2026-06-25T01:00:00.000Z"),
    ]);
    const { results } = await database
      .prepare("SELECT content_sha256, scanned_at FROM scan_cache WHERE content_sha256 = ?1")
      .bind(HASH)
      .all<{ content_sha256: string; scanned_at: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.scanned_at).toBe("2026-06-25T01:00:00.000Z");
  });

  it("preserves all fields of a complex RawScanResult (heuristic + rule matches)", async () => {
    const complexRaw: RawScanResult = {
      engineVersion: ENGINE,
      clam: { state: "clean" },
      heuristic: { kind: "active-content" },
      matches: [{ ruleId: "rule_x", tier: "extended", score: 80, isSuspicious: true }],
      timings: { clamdMs: 10, yaraMs: 5 },
    };
    const database = freshDatabase();
    await database.batch([
      recordScanCacheStatement(database, HASH, complexRaw, "2026-06-25T00:00:00.000Z"),
    ]);
    expect(await lookupScanCache(database, HASH, ENGINE)).toEqual(complexRaw);
  });

  it("throws when attempting to cache a no-engine result (engineVersion is null)", () => {
    const database = freshDatabase();
    const noEngineRaw: RawScanResult = {
      engineVersion: null,
      clam: { state: "unavailable" },
      heuristic: { kind: "none" },
      matches: [],
      timings: { clamdMs: 0, yaraMs: 0 },
    };
    expect(() =>
      recordScanCacheStatement(database, HASH, noEngineRaw, "2026-06-25T00:00:00.000Z"),
    ).toThrow();
  });
});
