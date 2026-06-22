import { describe, expect, it } from "vitest";
import { lookupScanCache, recordScanCacheStatement } from "../src/scan-cache.ts";
import { freshDatabase } from "./support.ts";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const ENGINE = "clamav+yara-x/1.18.0+heuristics/1";
const NEWER_ENGINE = "clamav+yara-x/1.18.0+heuristics/2";

describe("scan_cache (content dedup, scan-once)", () => {
  it("returns null on a miss", async () => {
    const database = freshDatabase();
    expect(await lookupScanCache(database, HASH, ENGINE)).toBeNull();
  });

  it("records then reads back a clean verdict for the same content + engine", async () => {
    const database = freshDatabase();
    await database.batch([
      recordScanCacheStatement(database, {
        contentSha256: HASH,
        engineVersion: ENGINE,
        verdict: "clean",
        signature: null,
        scannedAt: "2026-06-22T00:00:00.000Z",
      }),
    ]);
    expect(await lookupScanCache(database, HASH, ENGINE)).toEqual({
      verdict: "clean",
      signature: null,
    });
  });

  it("records an infected verdict with its signature", async () => {
    const database = freshDatabase();
    await database.batch([
      recordScanCacheStatement(database, {
        contentSha256: HASH,
        engineVersion: ENGINE,
        verdict: "infected",
        signature: "Eicar-Test-Signature",
        scannedAt: "2026-06-22T00:00:00.000Z",
      }),
    ]);
    expect(await lookupScanCache(database, HASH, ENGINE)).toEqual({
      verdict: "infected",
      signature: "Eicar-Test-Signature",
    });
  });

  it("a DIFFERENT engine version is a MISS — a DB update invalidates the cache (no stale clean)", async () => {
    const database = freshDatabase();
    await database.batch([
      recordScanCacheStatement(database, {
        contentSha256: HASH,
        engineVersion: ENGINE,
        verdict: "clean",
        signature: null,
        scannedAt: "2026-06-22T00:00:00.000Z",
      }),
    ]);
    // The same content under a newer engine must NOT hit — it gets re-scanned under the new signatures.
    expect(await lookupScanCache(database, HASH, NEWER_ENGINE)).toBeNull();
    // And it does not leak to a different content hash.
    expect(await lookupScanCache(database, OTHER_HASH, ENGINE)).toBeNull();
  });

  it("upserts on conflict — re-recording the same (content, engine) keeps one row", async () => {
    const database = freshDatabase();
    const entry = {
      contentSha256: HASH,
      engineVersion: ENGINE,
      verdict: "clean" as const,
      signature: null,
      scannedAt: "2026-06-22T00:00:00.000Z",
    };
    await database.batch([recordScanCacheStatement(database, entry)]);
    await database.batch([
      recordScanCacheStatement(database, { ...entry, scannedAt: "2026-06-22T01:00:00.000Z" }),
    ]);
    const { results } = await database
      .prepare("SELECT content_sha256, scanned_at FROM scan_cache WHERE content_sha256 = ?1")
      .bind(HASH)
      .all<{ content_sha256: string; scanned_at: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.scanned_at).toBe("2026-06-22T01:00:00.000Z");
  });
});
