import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// The per-firm content-addressed scan cache (the "scan-once" dedup). A definitive verdict for a content
// hash under a specific engine version: identical bytes scanned by the SAME engine yield the same
// verdict, so a re-scan or bulk migration can reuse it instead of running the engine again. The engine
// version is part of the key, so a signature-database update is a cache MISS — the content is re-scanned
// under the new engine, never served a stale clean. Only DEFINITIVE verdicts are cached: callers pass
// 'clean'/'infected' from a real engine; 'unscanned' (no engine ran) is never written here.
export const SCAN_CACHE_TABLE = "scan_cache";

// A cached verdict — `clean` or `infected` (never `unscanned`); `signature` carries the malware name for
// an infected hit, and is null for clean.
export interface CachedVerdict {
  readonly verdict: "clean" | "infected";
  readonly signature: string | null;
}

export interface ScanCacheEntry {
  readonly contentSha256: string;
  readonly engineVersion: string;
  readonly verdict: "clean" | "infected";
  readonly signature: string | null;
  readonly scannedAt: string;
}

// Reads the cached verdict for a content hash under a given engine version, or null on a miss. Keyed on
// BOTH columns: a hit means this exact content was already scanned by this exact engine, so the verdict
// is sound to reuse.
export function lookupScanCacheStatement(
  database: SqlDatabase,
  contentSha256: string,
  engineVersion: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT verdict, signature FROM ${SCAN_CACHE_TABLE} WHERE content_sha256 = ?1 AND engine_version = ?2`,
    )
    .bind(contentSha256, engineVersion);
}

export async function lookupScanCache(
  database: SqlDatabase,
  contentSha256: string,
  engineVersion: string,
): Promise<CachedVerdict | null> {
  const { results } = await lookupScanCacheStatement(
    database,
    contentSha256,
    engineVersion,
  ).all<{ verdict: "clean" | "infected"; signature: string | null }>();
  const row = results[0];
  if (row === undefined) return null;
  return { verdict: row.verdict, signature: row.signature };
}

// The upsert composed INTO the commit batch, so the cache entry lands atomically with the version it
// records (and an idempotent replay no-ops with the rest of the batch). On the rare re-scan of the same
// (content, engine) it overwrites — the verdict is deterministic, so the value is unchanged anyway. The
// caller MUST only build this for a definitive verdict (clean/infected) with a real engine version;
// `unscanned`/no-engine is never cached (a cache of "we did not scan it" would be worse than useless).
export function recordScanCacheStatement(
  database: SqlDatabase,
  entry: ScanCacheEntry,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SCAN_CACHE_TABLE} (content_sha256, engine_version, verdict, signature, scanned_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5) ` +
        `ON CONFLICT (content_sha256, engine_version) DO UPDATE SET ` +
        `verdict = excluded.verdict, signature = excluded.signature, scanned_at = excluded.scanned_at`,
    )
    .bind(
      entry.contentSha256,
      entry.engineVersion,
      entry.verdict,
      entry.signature,
      entry.scannedAt,
    );
}
