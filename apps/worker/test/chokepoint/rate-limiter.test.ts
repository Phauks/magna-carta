// Slice 0·5: the rate-limiter seam (design spec, decided up front #4) — named buckets as data,
// an in-memory sliding-window limiter behind the RateLimiter interface. The chokepoint 429
// problem reply is Task 7's job; this module only returns the check verdict.
import { describe, expect, it } from "vitest";
import { BUCKETS, createInMemoryRateLimiter } from "../../src/chokepoint/rate-limiter";

// A controllable epoch-milliseconds clock, matching the repo's injected-function precedent
// (packages/data-access commitEffectBatch takes `now: () => string`; here the limiter needs
// arithmetic, so it takes `now: () => number`).
function controllableClock(startMilliseconds = 0) {
  let currentMilliseconds = startMilliseconds;
  return {
    now: () => currentMilliseconds,
    advanceTo(milliseconds: number) {
      currentMilliseconds = milliseconds;
    },
  };
}

describe("BUCKETS", () => {
  it("registers the slice 0·5 buckets with their deferred-seam defaults", () => {
    expect(BUCKETS).toEqual({
      default: { limit: 100, windowSeconds: 60 },
      auth: { limit: 10, windowSeconds: 60 },
      expensive: { limit: 10, windowSeconds: 60 },
    });
  });
});

describe("createInMemoryRateLimiter", () => {
  it("allows requests under the bucket limit", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    for (let request = 0; request < BUCKETS.auth.limit; request++) {
      expect(rateLimiter.check("auth", "user-1")).toEqual({ allowed: true });
    }
  });

  it("denies the request over the limit with retryAfterSeconds until the oldest timestamp exits", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    for (let request = 0; request < BUCKETS.auth.limit; request++) {
      rateLimiter.check("auth", "user-1");
    }
    clock.advanceTo(10_000);
    // Oldest timestamp is at t=0; it exits the 60s window at t=60_000 — 50s from now.
    expect(rateLimiter.check("auth", "user-1")).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });

  it("rounds retryAfterSeconds up to whole seconds (it feeds the Retry-After header)", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    for (let request = 0; request < BUCKETS.auth.limit; request++) {
      rateLimiter.check("auth", "user-1");
    }
    clock.advanceTo(59_999);
    // 1ms until the oldest timestamp exits — ceil to 1 second, never 0.
    expect(rateLimiter.check("auth", "user-1")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("slides the window: a denied key is allowed again once the oldest timestamp ages out", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    for (let request = 0; request < BUCKETS.auth.limit; request++) {
      rateLimiter.check("auth", "user-1");
    }
    clock.advanceTo(59_999);
    expect(rateLimiter.check("auth", "user-1").allowed).toBe(false);
    clock.advanceTo(60_000);
    expect(rateLimiter.check("auth", "user-1")).toEqual({ allowed: true });
  });

  it("slides timestamp by timestamp, not in fixed-window resets", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    // Nine requests at t=0, the tenth at t=30s — the bucket is full with a staggered log.
    for (let request = 0; request < BUCKETS.auth.limit - 1; request++) {
      rateLimiter.check("auth", "user-1");
    }
    clock.advanceTo(30_000);
    expect(rateLimiter.check("auth", "user-1")).toEqual({ allowed: true });
    expect(rateLimiter.check("auth", "user-1").allowed).toBe(false);
    // At t=60s the nine t=0 timestamps exit; the t=30s one is still inside the window.
    clock.advanceTo(60_000);
    expect(rateLimiter.check("auth", "user-1")).toEqual({ allowed: true });
  });

  it("does not record denied checks, so a denied caller's retry-after never extends itself", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    for (let request = 0; request < BUCKETS.auth.limit; request++) {
      rateLimiter.check("auth", "user-1");
    }
    clock.advanceTo(30_000);
    expect(rateLimiter.check("auth", "user-1").allowed).toBe(false);
    expect(rateLimiter.check("auth", "user-1").allowed).toBe(false);
    // The denied checks above must not count toward the limit at t=60s.
    clock.advanceTo(60_000);
    expect(rateLimiter.check("auth", "user-1")).toEqual({ allowed: true });
  });

  it("isolates buckets for the same key", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    for (let request = 0; request < BUCKETS.auth.limit; request++) {
      rateLimiter.check("auth", "user-1");
    }
    expect(rateLimiter.check("auth", "user-1").allowed).toBe(false);
    expect(rateLimiter.check("expensive", "user-1")).toEqual({ allowed: true });
    expect(rateLimiter.check("default", "user-1")).toEqual({ allowed: true });
  });

  it("isolates keys within the same bucket", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    for (let request = 0; request < BUCKETS.auth.limit; request++) {
      rateLimiter.check("auth", "user-1");
    }
    expect(rateLimiter.check("auth", "user-1").allowed).toBe(false);
    expect(rateLimiter.check("auth", "user-2")).toEqual({ allowed: true });
  });

  it("drops a stale key's state once its window has passed (no per-key memory leak)", () => {
    const clock = controllableClock();
    const rateLimiter = createInMemoryRateLimiter({ now: clock.now });
    rateLimiter.check("auth", "hit-once");
    rateLimiter.check("default", "also-hit-once");
    expect(rateLimiter.trackedKeyCount()).toBe(2);
    // Past both windows AND the sweep interval: a check on an unrelated key must sweep the
    // stale ones out — a route hit once must not occupy memory forever.
    clock.advanceTo(120_001);
    rateLimiter.check("auth", "active");
    expect(rateLimiter.trackedKeyCount()).toBe(1);
  });
});
