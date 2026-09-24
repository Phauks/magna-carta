import { describe, expect, it } from "vitest";
import {
  LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS,
  planLiveSession,
  sessionContinued,
  type LiveSessionRecord,
} from "../src/live-session.ts";

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const held = (openedAt: number): LiveSessionRecord => ({ sessionId: "s-1", openedAt });

describe("planLiveSession", () => {
  it("launches when the member has no browser yet", () => {
    expect(planLiveSession(null, NOW)).toEqual({ kind: "launch", reason: "none-recorded" });
  });

  it("reuses a held browser, which is the entire point of holding one", () => {
    // Launching here would silently drop the cookies a consent flow depends on, and the next page
    // would simply ask again — a failure that looks like the site's behaviour, not ours.
    expect(planLiveSession(held(NOW - 1000), NOW)).toEqual({ kind: "connect", sessionId: "s-1" });
  });

  it("relaunches rather than failing when the recorded session has been reaped", () => {
    // The service reaps idle sessions on its own schedule, so a stale id is nobody's fault. The
    // member loses their cookies; they must not lose the navigation.
    expect(planLiveSession(held(NOW - 1000), NOW, true)).toEqual({
      kind: "launch",
      reason: "stale",
    });
  });

  it("retires a browser that has been held too long even while in use", () => {
    const openedAt = NOW - LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS;
    expect(planLiveSession(held(openedAt), NOW)).toEqual({ kind: "launch", reason: "expired" });
  });

  it("keeps a browser that is one tick short of the ceiling", () => {
    const openedAt = NOW - LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS + 1;
    expect(planLiveSession(held(openedAt), NOW).kind).toBe("connect");
  });

  it("reports whether the member's cookies survived, so the screen can say so", () => {
    expect(sessionContinued(planLiveSession(held(NOW - 1000), NOW))).toBe(true);
    expect(sessionContinued(planLiveSession(null, NOW))).toBe(false);
  });
});
