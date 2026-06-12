// Rate-limiter seam (design spec, decided up front #4): named buckets as data, enforcement
// behind the RateLimiter interface. The chokepoint position and the 429 problem shape are the
// contract being locked in slice 0·5; the limiter implementation is swappable. The Phase 0
// implementation below is a per-isolate in-memory sliding-window log.
//
// Honest limitation: state is PER WORKERS ISOLATE — it resets on isolate eviction/redeploy and
// is not shared across isolates, so the effective global limit is (limit x live isolates). That
// is acceptable for the Phase 0 abuse backstop these generous defaults are; a distributed
// limiter (Durable Objects or KV) is a later adapter behind this same interface, swapped at the
// chokepoint with no route or contract change.
import type { RateLimitBucket } from "../contracts/route-meta";

// Bucket names are data (RateLimitBucket, contracts/route-meta.ts — declared per route as
// meta.rateLimit). The values here are the deferred seam: generous Phase 0 defaults, tightened
// per bucket when real traffic shapes them — not a product decision being made now.
export const BUCKETS: Record<RateLimitBucket, { limit: number; windowSeconds: number }> = {
  default: { limit: 100, windowSeconds: 60 },
  auth: { limit: 10, windowSeconds: 60 },
  expensive: { limit: 10, windowSeconds: 60 },
};

export interface RateLimitVerdict {
  allowed: boolean;
  // Present only when denied: whole seconds (rounded up, never 0) until the oldest in-window
  // timestamp ages out — feeds the Retry-After header at the chokepoint.
  retryAfterSeconds?: number;
}

// The seam the chokepoint depends on. check() returns the verdict only; replying with the 429
// rate-limited problem is the chokepoint's job.
export interface RateLimiter {
  check(bucket: RateLimitBucket, key: string): RateLimitVerdict;
}

// The in-memory limiter additionally exposes its tracked-key count so tests (and diagnostics)
// can prove stale state is dropped; the chokepoint depends on RateLimiter only.
export interface InMemoryRateLimiter extends RateLimiter {
  trackedKeyCount(): number;
}

// Injected epoch-milliseconds clock (repo precedent: injected now() functions in
// packages/data-access and packages/ledger; the limiter needs arithmetic, so number not string).
export interface InMemoryRateLimiterOptions {
  now?: () => number;
}

// Sweep cadence for stale keys: the widest bucket window — by then every timestamp a stale key
// could hold has aged out.
const SWEEP_INTERVAL_MILLISECONDS =
  Math.max(...Object.values(BUCKETS).map((bucket) => bucket.windowSeconds)) * 1000;

// A true sliding-window log: per bucket+key, the epoch-millisecond timestamps of allowed
// requests inside the window. Denied checks are NOT recorded — recording them would let a
// hammering client extend its own retry-after indefinitely.
//
// Memory strategy (documented per the slice plan): prune-on-touch (stale timestamps drop from a
// key whenever it is checked) plus a periodic sweep (at most once per SWEEP_INTERVAL, the next
// check walks all keys, prunes, and deletes empty entries) — so a key hit once does not occupy
// memory forever after its window passes.
export function createInMemoryRateLimiter(
  options: InMemoryRateLimiterOptions = {},
): InMemoryRateLimiter {
  const now = options.now ?? Date.now;
  const timestampsByBucket = new Map<RateLimitBucket, Map<string, number[]>>();
  let nextSweepAtMilliseconds = now() + SWEEP_INTERVAL_MILLISECONDS;

  // Timestamps still inside the window: strictly newer than the window start, so a timestamp
  // exactly windowSeconds old has exited (a full bucket frees a slot at oldest + window, not
  // one millisecond later).
  function prune(timestamps: number[], windowStartMilliseconds: number): number[] {
    return timestamps.filter((timestamp) => timestamp > windowStartMilliseconds);
  }

  function sweep(nowMilliseconds: number): void {
    for (const [bucket, timestampsByKey] of timestampsByBucket) {
      const windowStartMilliseconds = nowMilliseconds - BUCKETS[bucket].windowSeconds * 1000;
      for (const [key, timestamps] of timestampsByKey) {
        const remaining = prune(timestamps, windowStartMilliseconds);
        if (remaining.length === 0) {
          timestampsByKey.delete(key);
        } else if (remaining.length !== timestamps.length) {
          timestampsByKey.set(key, remaining);
        }
      }
      if (timestampsByKey.size === 0) {
        timestampsByBucket.delete(bucket);
      }
    }
  }

  return {
    check(bucket, key) {
      const nowMilliseconds = now();
      if (nowMilliseconds >= nextSweepAtMilliseconds) {
        sweep(nowMilliseconds);
        nextSweepAtMilliseconds = nowMilliseconds + SWEEP_INTERVAL_MILLISECONDS;
      }

      const { limit, windowSeconds } = BUCKETS[bucket];
      const windowMilliseconds = windowSeconds * 1000;
      const timestampsByKey = timestampsByBucket.get(bucket) ?? new Map<string, number[]>();
      const inWindow = prune(timestampsByKey.get(key) ?? [], nowMilliseconds - windowMilliseconds);

      if (inWindow.length >= limit) {
        timestampsByKey.set(key, inWindow);
        const oldestTimestamp = inWindow[0] as number;
        return {
          allowed: false,
          // How long until the oldest timestamp exits the window, rounded up to whole seconds.
          // Always >= 1: prune kept only timestamps strictly inside the window.
          retryAfterSeconds: Math.ceil(
            (oldestTimestamp + windowMilliseconds - nowMilliseconds) / 1000,
          ),
        };
      }

      inWindow.push(nowMilliseconds);
      timestampsByKey.set(key, inWindow);
      timestampsByBucket.set(bucket, timestampsByKey);
      return { allowed: true };
    },

    trackedKeyCount() {
      let count = 0;
      for (const timestampsByKey of timestampsByBucket.values()) {
        count += timestampsByKey.size;
      }
      return count;
    },
  };
}
