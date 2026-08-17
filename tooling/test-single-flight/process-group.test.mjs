import { describe, expect, it } from "vitest";
import {
  KILL_CONFIRM_MILLISECONDS,
  TERMINATE_GRACE_MILLISECONDS,
  reapProcessGroup,
  reapReport,
  shouldLeadOwnProcessGroup,
} from "./process-group.mjs";

describe("shouldLeadOwnProcessGroup", () => {
  it("detaches when nothing can read a controlling terminal", () => {
    expect(shouldLeadOwnProcessGroup({ platform: "linux", stdinIsTerminal: false })).toBe(true);
  });

  it("declines when stdin is a terminal, so a watch run cannot take SIGTTIN", () => {
    // The whole cost of the gate. A detached process that reads the controlling terminal from a
    // background process group is stopped by the kernel, which would wedge `vp test --watch` on its
    // keypress reader. Nothing is lost by declining: an interactive run is in the FOREGROUND group, so
    // Ctrl-C already reaches every descendant.
    expect(shouldLeadOwnProcessGroup({ platform: "linux", stdinIsTerminal: true })).toBe(false);
  });

  it("declines on Windows, which has no process groups to signal", () => {
    expect(shouldLeadOwnProcessGroup({ platform: "win32", stdinIsTerminal: false })).toBe(false);
  });
});

// A clock and a sleep that advance only when asked, so the escalation ladder is tested at its real
// budgets without any test taking real seconds.
function fakeTime() {
  let current = 0;
  return {
    now: () => current,
    sleep: (milliseconds) => {
      current += milliseconds;
      return Promise.resolve();
    },
  };
}

describe("reapProcessGroup", () => {
  it("signals nothing when the group is already empty", async () => {
    const { now, sleep } = fakeTime();
    const signals = [];
    const result = await reapProcessGroup({
      signalGroup: (signal) => signals.push(signal),
      groupIsEmpty: () => true,
      sleep,
      now,
    });
    expect(result).toEqual({ outcome: "already-empty", waitedMilliseconds: 0 });
    expect(signals).toEqual([]);
  });

  it("stops at SIGTERM when the runner closes its own workers", async () => {
    const { now, sleep } = fakeTime();
    const signals = [];
    let alive = true;
    const result = await reapProcessGroup({
      signalGroup: (signal) => {
        signals.push(signal);
        if (signal === "SIGTERM") alive = false;
      },
      groupIsEmpty: () => !alive,
      sleep,
      now,
    });
    expect(signals).toEqual(["SIGTERM"]);
    expect(result.outcome).toBe("terminated");
  });

  it("escalates to SIGKILL when SIGTERM is ignored, and only after the grace window", async () => {
    const { now, sleep } = fakeTime();
    const signals = [];
    const signalledAt = [];
    let alive = true;
    const result = await reapProcessGroup({
      signalGroup: (signal) => {
        signals.push(signal);
        signalledAt.push(now());
        if (signal === "SIGKILL") alive = false;
      },
      groupIsEmpty: () => !alive,
      sleep,
      now,
    });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signalledAt[1]).toBeGreaterThanOrEqual(TERMINATE_GRACE_MILLISECONDS);
    expect(result.outcome).toBe("killed");
  });

  it("gives up rather than holding the lock forever against a survivor", async () => {
    // The bound is the point: a lock held until an unkillable runner dies is exactly the 0%-CPU holder
    // the single-flight guard was written to eliminate.
    const { now, sleep } = fakeTime();
    const result = await reapProcessGroup({
      signalGroup: () => {},
      groupIsEmpty: () => false,
      sleep,
      now,
    });
    expect(result.outcome).toBe("survived");
    expect(result.waitedMilliseconds).toBeLessThanOrEqual(
      TERMINATE_GRACE_MILLISECONDS + KILL_CONFIRM_MILLISECONDS + 200,
    );
  });

  it("re-probes after the final wait, so a group that empties on the last tick counts", async () => {
    const { now, sleep } = fakeTime();
    let probes = 0;
    const result = await reapProcessGroup({
      signalGroup: () => {},
      // Alive for the initial probe and every poll inside the grace window, gone by the time SIGKILL's
      // window closes.
      groupIsEmpty: () => {
        probes += 1;
        return now() >= TERMINATE_GRACE_MILLISECONDS + KILL_CONFIRM_MILLISECONDS;
      },
      sleep,
      now,
    });
    expect(result.outcome).toBe("killed");
    expect(probes).toBeGreaterThan(1);
  });
});

describe("reapReport", () => {
  it("says nothing on the ordinary paths", () => {
    expect(reapReport({ outcome: "already-empty", waitedMilliseconds: 0 })).toBeNull();
    expect(reapReport({ outcome: "terminated", waitedMilliseconds: 120 })).toBeNull();
  });

  it("reports an escalation", () => {
    expect(reapReport({ outcome: "killed", waitedMilliseconds: 2050 })).toContain("was killed");
  });

  it("warns loudly about a survivor, because the next run will meet it", () => {
    const message = reapReport({ outcome: "survived", waitedMilliseconds: 4000 });
    expect(message).toContain("survived SIGKILL");
    expect(message).toContain("contend");
  });
});
