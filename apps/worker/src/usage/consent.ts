import {
  readMemberOptedOut,
  readUsageAnalyticsEnabled,
} from "@magna-carta/data-access/usage-consent-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// Effective usage-analytics consent, resolved off the hot path. The effective value is
// firm-enabled AND not-user-opted-out; either off suppresses the user's events. Reads are cached
// isolate-locally per (firmId, userId) for a short TTL, so after warmup the common request does no
// D1 read; a firm disable or a user opt-out takes effect within one TTL.
const DEFAULT_TTL_MILLISECONDS = 60_000;

interface CacheEntry {
  readonly value: boolean;
  readonly expiresAt: number;
}

export function createUsageConsentResolver(options?: { ttlMs?: number; clock?: () => number }): {
  resolve(database: SqlDatabase, firmId: string, userId: string): Promise<boolean>;
} {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MILLISECONDS;
  const clock = options?.clock ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  return {
    async resolve(database, firmId, userId) {
      const cacheKey = `${firmId} ${userId}`;
      const now = clock();
      const cached = cache.get(cacheKey);
      if (cached !== undefined && cached.expiresAt > now) return cached.value;

      const [enabled, optedOut] = await Promise.all([
        readUsageAnalyticsEnabled(database),
        readMemberOptedOut(database, userId),
      ]);
      const value = enabled && !optedOut;
      cache.set(cacheKey, { value, expiresAt: now + ttlMs });
      return value;
    },
  };
}
