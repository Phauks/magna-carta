// A per-isolate fixed-window limiter over the board's writes.
//
// It is deliberately the simplest thing that bounds a burst, and its limitation is worth stating
// rather than discovering: the counters live in one isolate's memory, so they reset on eviction and
// are not shared across isolates. That makes it a brake on a single client hammering one isolate,
// not a global budget.
//
// It is still worth having on day one, and it is not the anti-spam control. The anti-spam control
// is that writing requires a provisioned firm — email verification, a human check, and the whole
// registration flow before one post — and after that a held first post. This limiter stops the
// accidental loop and the impatient retry; a distributed counter fits behind the same interface if
// the board ever attracts traffic that needs one.

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check(bucket: string, key: string): RateLimitVerdict;
}

export interface BucketPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
}

// Two budgets, and the split is the point: a member's own writes are bounded per account, and their
// firm's writes are bounded again as a whole, so a firm cannot spend forty seats' worth of budget on
// one campaign. Reading is not limited at all — the board is public to read, and rationing reads
// would punish the prospect the surface exists to reach.
export const BUCKET_POLICIES: Readonly<Record<string, BucketPolicy>> = {
  // A post is the expensive write: it draws a number, runs the detector, and lands on every list.
  post: { limit: 5, windowSeconds: 3600 },
  // Comments and votes are cheap and are the board working as intended, so they are looser.
  comment: { limit: 30, windowSeconds: 3600 },
  vote: { limit: 120, windowSeconds: 3600 },
  // A report is the one write anybody can aim at somebody else's words, so it is the tightest.
  // Reporting is not a debate mechanism.
  report: { limit: 10, windowSeconds: 3600 },
  profile: { limit: 5, windowSeconds: 3600 },
};

export function createRateLimiter(now: () => number): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    check(bucket: string, key: string): RateLimitVerdict {
      const policy = BUCKET_POLICIES[bucket];
      // An unknown bucket is a programming error, and the safe reading of one is "refuse" rather
      // than "allow anything": a route that names a bucket nobody declared must not turn out to be
      // the unlimited one.
      if (policy === undefined) return { allowed: false, retryAfterSeconds: 60 };
      const instant = now();
      const composite = `${bucket}:${key}`;
      const window = windows.get(composite);
      if (window === undefined || window.resetAt <= instant) {
        windows.set(composite, { count: 1, resetAt: instant + policy.windowSeconds * 1000 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (window.count >= policy.limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - instant) / 1000)),
        };
      }
      window.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
