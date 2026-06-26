import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RawScanResult } from "./scan-port.ts";

// The per-firm content-addressed scan cache (the "scan-once" dedup). A raw scan result for a content
// hash under a specific engine version: identical bytes scanned by the SAME engine yield the same
// raw result, so a re-scan or bulk migration can reuse it instead of running the engine again. The engine
// version is part of the key, so a signature-database update is a cache MISS — the content is re-scanned
// under the new engine, never served a stale result. Only results from a real engine are cached:
// callers pass a non-null engineVersion RawScanResult; the no-engine adapter is never written here.
export const SCAN_CACHE_TABLE = "scan_cache";

// Reads the cached raw scan result for a content hash under a given engine version, or undefined on
// a miss. Keyed on BOTH columns: a hit means this exact content was already scanned by this exact
// engine, so the raw result is sound to reuse.
export function lookupScanCacheStatement(
  database: SqlDatabase,
  contentSha256: string,
  engineVersion: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT raw_result FROM ${SCAN_CACHE_TABLE} WHERE content_sha256 = ?1 AND engine_version = ?2`,
    )
    .bind(contentSha256, engineVersion);
}

export async function lookupScanCache(
  database: SqlDatabase,
  contentSha256: string,
  engineVersion: string,
): Promise<RawScanResult | undefined> {
  const { results } = await lookupScanCacheStatement(database, contentSha256, engineVersion).all<{
    raw_result: string;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return JSON.parse(row.raw_result) as RawScanResult;
}

// The upsert composed INTO the commit batch, so the cache entry lands atomically with the version it
// records (and an idempotent replay no-ops with the rest of the batch). On the rare re-scan of the same
// (content, engine) it overwrites — the raw result is deterministic for identical bytes under the same
// engine, so the value is unchanged anyway. The caller MUST only build this for a real engine scan
// (raw.engineVersion non-null); the no-engine adapter is never cached (a cache of "we did not scan it"
// would be worse than useless).
export function recordScanCacheStatement(
  database: SqlDatabase,
  contentSha256: string,
  raw: RawScanResult,
  scannedAt: string,
): SqlStatement {
  if (raw.engineVersion === null) {
    throw new Error(
      "recordScanCacheStatement: raw.engineVersion must be non-null; the no-engine adapter is never cached",
    );
  }
  return database
    .prepare(
      `INSERT INTO ${SCAN_CACHE_TABLE} (content_sha256, engine_version, raw_result, scanned_at) ` +
        `VALUES (?1, ?2, ?3, ?4) ` +
        `ON CONFLICT (content_sha256, engine_version) DO UPDATE SET ` +
        `raw_result = excluded.raw_result, scanned_at = excluded.scanned_at`,
    )
    .bind(contentSha256, raw.engineVersion, JSON.stringify(raw), scannedAt);
}
