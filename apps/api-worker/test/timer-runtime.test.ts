// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import {
  beginCommit,
  elapsedMinutes,
  markAbandoned,
  pauseTimer,
  resumeTimer,
  startTimer,
  trimToLastActivity,
  type TimerState,
} from "../src/timer/timer-runtime.ts";

const RUN = "timeEntry_run1";
const t = (minute: number) => `2026-06-22T10:${String(minute).padStart(2, "0")}:00.000Z`;

function started(): TimerState {
  return startTimer({ liveRunId: RUN, now: t(0), binding: { matterId: "matter_a" } });
}

describe("startTimer", () => {
  it("mints a running state carrying the run id, start instant, and binding", () => {
    const state = startTimer({
      liveRunId: RUN,
      now: t(0),
      binding: { matterId: "matter_a", label: "research" },
    });
    expect(state).toEqual({
      liveRunId: RUN,
      startedAt: t(0),
      pausedIntervals: [],
      matterId: "matter_a",
      label: "research",
      narrative: undefined,
      utbmsTaskCodeId: undefined,
      status: "running",
      lastActivityAt: t(0),
    });
  });

  it("starts unbound (a scratch timer needs no matter)", () => {
    const state = startTimer({ liveRunId: RUN, now: t(0) });
    expect(state.matterId).toBeUndefined();
    expect(state.status).toBe("running");
  });
});

describe("pauseTimer / resumeTimer", () => {
  it("opens a paused interval on pause and closes it on resume, advancing last activity", () => {
    const paused = pauseTimer(started(), t(10));
    expect(paused.status).toBe("paused");
    expect(paused.pausedIntervals).toEqual([{ from: t(10), to: null }]);
    expect(paused.lastActivityAt).toBe(t(10));

    const resumed = resumeTimer(paused, t(15));
    expect(resumed.status).toBe("running");
    expect(resumed.pausedIntervals).toEqual([{ from: t(10), to: t(15) }]);
    expect(resumed.lastActivityAt).toBe(t(15));
  });

  it("is idempotent: pausing a paused timer or resuming a running one is a no-op state", () => {
    const paused = pauseTimer(started(), t(10));
    expect(pauseTimer(paused, t(12)).pausedIntervals).toEqual([{ from: t(10), to: null }]);
    expect(resumeTimer(started(), t(5))).toEqual(started());
  });
});

describe("elapsedMinutes", () => {
  it("counts wall minutes since start when never paused", () => {
    expect(elapsedMinutes(started(), t(30))).toBe(30);
  });

  it("excludes a closed paused span", () => {
    const paused = pauseTimer(started(), t(10));
    const resumed = resumeTimer(paused, t(15)); // 5 minutes paused
    expect(elapsedMinutes(resumed, t(30))).toBe(25); // 30 wall - 5 paused
  });

  it("excludes the still-open paused span up to now", () => {
    const paused = pauseTimer(started(), t(10)); // open from 10
    expect(elapsedMinutes(paused, t(30))).toBe(10); // only 0..10 ran
  });

  it("excludes multiple closed paused spans (two 5-minute pauses, 30 active out of 40 wall)", () => {
    // start t(0), pause t(5), resume t(10), pause t(20), resume t(25), elapsed at t(40) → 30
    const s1 = pauseTimer(started(), t(5));
    const s2 = resumeTimer(s1, t(10));
    const s3 = pauseTimer(s2, t(20));
    const s4 = resumeTimer(s3, t(25));
    expect(elapsedMinutes(s4, t(40))).toBe(30);
  });
});

describe("beginCommit (compare-and-set)", () => {
  it("flips running to committing exactly once", () => {
    const first = beginCommit(started());
    expect(first.outcome).toBe("committing");
    expect(first.state.status).toBe("committing");

    const second = beginCommit(first.state);
    expect(second.outcome).toBe("already-committing");
    expect(second.state.status).toBe("committing");
  });

  it("flips a paused timer to committing too (stop from paused is legal)", () => {
    const paused = pauseTimer(started(), t(10));
    expect(beginCommit(paused).outcome).toBe("committing");
  });

  it("refuses an unbound (scratch) timer — state is unchanged, outcome is unbound", () => {
    const scratch = startTimer({ liveRunId: RUN, now: t(0) }); // no matter
    const result = beginCommit(scratch);
    expect(result.outcome).toBe("unbound");
    expect(result.state.status).toBe("running"); // state NOT flipped to committing
    expect(result.state).toEqual(scratch); // fully unchanged
  });

  it("a bound timer's beginCommit returns committing", () => {
    const bound = startTimer({ liveRunId: RUN, now: t(0), binding: { matterId: "matter_b" } });
    expect(beginCommit(bound).outcome).toBe("committing");
  });
});

describe("markAbandoned", () => {
  it("flags a still-live timer abandoned without committing or discarding", () => {
    const state = markAbandoned(started());
    expect(state.status).toBe("abandoned");
  });

  it("never overrides a committing timer (an already-committed run must not be re-flagged)", () => {
    const committing = beginCommit(started()).state;
    expect(markAbandoned(committing).status).toBe("committing");
  });
});

describe("trimToLastActivity", () => {
  it("clamps an open run so elapsed stops at lastActivityAt", () => {
    // Run 0..30 with last activity at 20: trimming closes the tail so elapsed past 20 does not count.
    const active = { ...started(), lastActivityAt: t(20) };
    const trimmed = trimToLastActivity(active);
    expect(elapsedMinutes(trimmed, t(30))).toBe(20);
  });

  it("closes an open paused span at lastActivityAt before clamping", () => {
    const paused = { ...pauseTimer(started(), t(10)), lastActivityAt: t(20) };
    const trimmed = trimToLastActivity(paused);
    // Paused span closes at 20 (the last activity), and the run end clamps to 20 → 10 active minutes.
    expect(elapsedMinutes(trimmed, t(30))).toBe(10);
  });
});
