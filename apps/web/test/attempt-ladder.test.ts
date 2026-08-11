import { describe, expect, it } from "vitest";
import {
  ATTEMPT_LIMIT,
  attemptWarning,
  lockoutCountdown,
  lockoutMessage,
} from "../src/lib/auth/attempt-ladder.ts";

// The shared failed-attempt ladder. What is pinned here is the SHAPE of the escalation, not the
// wording: a count that never changes tone trains people to ignore it, and a lockout notice that
// omits the way out sends someone to support for something an administrator can undo.
describe("attemptWarning", () => {
  it("says nothing before an attempt has failed", () => {
    expect(attemptWarning(ATTEMPT_LIMIT, "this account")).toBeNull();
  });

  it("says nothing once the budget is spent, because the lockout notice speaks instead", () => {
    // Two notices about the same failure make the visitor read both to find the one that applies.
    expect(attemptWarning(0, "this account")).toBeNull();
    expect(attemptWarning(-1, "this account")).toBeNull();
  });

  it("escalates its tone as the count drops", () => {
    expect(attemptWarning(3, "this account")?.tone).toBe("neutral");
    expect(attemptWarning(2, "this account")?.tone).toBe("warning");
    expect(attemptWarning(1, "this account")?.tone).toBe("final");
  });

  it("names what will be locked, in the caller's own terms", () => {
    expect(attemptWarning(3, "this sign-in")?.message).toContain("this sign-in");
    expect(attemptWarning(1, "this account")?.message).toContain("this account");
  });

  it("never states or implies which half of the credential was wrong", () => {
    for (let remaining = 1; remaining <= ATTEMPT_LIMIT; remaining += 1) {
      const message = attemptWarning(remaining, "this account")?.message ?? "";
      expect(message).not.toMatch(/password|email|address|code/i);
    }
  });
});

describe("lockoutCountdown", () => {
  it("reads as a clock, because it is read repeatedly against one", () => {
    expect(lockoutCountdown(298)).toBe("4:58");
    expect(lockoutCountdown(60)).toBe("1:00");
    expect(lockoutCountdown(9)).toBe("0:09");
  });

  it("floors at zero rather than counting backwards past it", () => {
    expect(lockoutCountdown(0)).toBe("0:00");
    expect(lockoutCountdown(-30)).toBe("0:00");
  });
});

describe("lockoutMessage", () => {
  it("says the wait is over rather than showing a spent countdown", () => {
    expect(lockoutMessage(0)).toBe("You can try again now.");
  });

  it("carries the countdown while the window is open", () => {
    expect(lockoutMessage(298)).toContain("4:58");
  });
});
