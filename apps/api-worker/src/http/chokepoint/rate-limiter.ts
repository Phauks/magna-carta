// Rate-limiter seam: named buckets as data, enforcement
// behind the RateLimiter interface. The chokepoint position and the 429 problem shape are the
// contract; the limiter implementation is swappable. The current
// implementation below is a per-isolate in-memory sliding-window log.
//
// Honest limitation: state is PER WORKERS ISOLATE — it resets on isolate eviction/redeploy and
// is not shared across isolates, so the effective global limit is (limit x live isolates). That
// is acceptable for the abuse backstop these generous defaults are; a distributed
// limiter (Durable Objects or KV) is a later adapter behind this same interface, swapped at the
// chokepoint with no route or contract change.
import type { RateLimitBucket } from "../contracts/route-meta";

// Bucket names are data (RateLimitBucket, contracts/route-meta.ts — declared per route as
// meta.rateLimit). The values here are the deferred seam: generous defaults, tightened
// per bucket when real traffic shapes them — not a product decision being made now.
export const BUCKETS: Record<RateLimitBucket, { limit: number; windowSeconds: number }> = {
  default: { limit: 100, windowSeconds: 60 },
  // Deliberately ABOVE the credential ladder's ATTEMPT_LIMIT (auth-attempt-budget.ts), because the
  // two bound the same visitor by different means and only one of them is spoken aloud: the joining
  // answers PUBLISH the ladder's remaining count. Whichever limit is lower is the one a visitor
  // actually meets, so a bucket at or below the ladder makes that published number a lie — the
  // screen says three attempts left and the next request is refused by a limiter it never mentioned.
  // Keep this the outer bound on burst and let the ladder be the one that speaks; raising the ladder
  // means raising this too.
  auth: { limit: 20, windowSeconds: 60 },
  expensive: { limit: 10, windowSeconds: 60 },
  // Incident reports accept user-authored content; a tight bucket bounds abuse.
  "incident-report": { limit: 5, windowSeconds: 300 },
};

// Definition-time guard: the deny branch reads the oldest in-window timestamp assuming a full
// window holds at least one entry, which is only true while every bucket's limit >= 1; a
// windowSeconds < 1 would make the sweep cadence and retry-after arithmetic degenerate. Validate
// once at module scope so a future bucket edit (e.g. limit: 0) fails loudly at startup instead
// of silently producing a NaN retry-after.
for (const [bucketName, bucket] of Object.entries(BUCKETS)) {
  if (!Number.isInteger(bucket.limit) || bucket.limit < 1) {
    throw new Error(
      `BUCKETS.${bucketName}.limit must be an integer >= 1 (got ${String(bucket.limit)})`,
    );
  }
  if (!Number.isInteger(bucket.windowSeconds) || bucket.windowSeconds < 1) {
    throw new Error(
      `BUCKETS.${bucketName}.windowSeconds must be an integer >= 1 (got ${String(bucket.windowSeconds)})`,
    );
  }
}

export interface RateLimitVerdict {
  allowed: boolean;
  // Present only when denied: whole seconds (rounded up, never 0) until the oldest in-window
  // timestamp ages out — feeds the Retry-After header at the chokepoint.
  retryAfterSeconds?: number;
  // THE BUDGET, published on every verdict. A 429 that says only "too many" leaves a caller — and a
  // sign-in screen counting down beside it — with nothing to state but a guess, and a count the
  // server does not agree with is worse than no count. `limit` is the bucket's ceiling and
  // `remaining` is what is left of it after this request, so a client can warn before it is
  // refused rather than only afterwards.
  limit: number;
  remaining: number;
}

// The seam the chokepoint depends on. check() returns the verdict only; replying with the 429
// rate-limited problem is the chokepoint's job. The return is sync-or-promise:
// the distributed adapter (Durable Objects or KV) must await I/O, so a
// sync-only signature would force a breaking seam change at adapter time. The chokepoint
// always awaits the result — awaiting a plain value is free — so the in-memory implementation
// stays synchronous with no overhead.
export interface RateLimiter {
  check(bucket: RateLimitBucket, key: string): RateLimitVerdict | Promise<RateLimitVerdict>;
}

// The in-memory limiter additionally exposes its tracked-key count so tests (and diagnostics)
// can prove stale state is dropped; the chokepoint depends on RateLimiter only. check() is
// narrowed back to synchronous: this implementation never awaits, and tests read the verdict
// directly.
export interface InMemoryRateLimiter extends RateLimiter {
  check(bucket: RateLimitBucket, key: string): RateLimitVerdict;
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
// Memory strategy: prune-on-touch (stale timestamps drop from a
// key whenever it is checked) plus a periodic sweep (at most once per SWEEP_INTERVAL, the next
// check walks all keys, prunes, and deletes empty entries) — so a key hit once does not occupy
// memory forever after its window passes.
//
// Bounds (golden rule 10 honesty): between sweeps the map grows with the number of unique
// (bucket, key) pairs checked, each holding at most `limit` timestamps; the one request that
// triggers a sweep pays O(tracked keys x limit) for the walk. Both are bounded by what a single
// isolate serves within one sweep interval — acceptable for the per-isolate backstop
// with these generous limits, revisited when the distributed adapter lands.
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
        // The cast is safe because limit >= 1 (the definition-time guard on BUCKETS above), so a
        // full window holds at least one timestamp. Treating inWindow[0] as the oldest assumes a
        // monotone (non-decreasing) clock keeps the log append-sorted; under a backwards-jumping
        // now() the log may be unsorted and retry-after over-reports — conservatively, never
        // negative (every kept timestamp satisfies timestamp + window > now). Workers'
        // request-scoped clock is non-decreasing within an isolate.
        const oldestTimestamp = inWindow[0] as number;
        return {
          allowed: false,
          // How long until the oldest timestamp exits the window, rounded up to whole seconds.
          // Always >= 1: prune kept only timestamps strictly inside the window.
          retryAfterSeconds: Math.ceil(
            (oldestTimestamp + windowMilliseconds - nowMilliseconds) / 1000,
          ),
          limit,
          remaining: 0,
        };
      }

      inWindow.push(nowMilliseconds);
      timestampsByKey.set(key, inWindow);
      timestampsByBucket.set(bucket, timestampsByKey);
      return { allowed: true, limit, remaining: Math.max(0, limit - inWindow.length) };
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
