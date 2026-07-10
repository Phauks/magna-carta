import { expect, test } from "vitest";
import { appendSample, historyDayKeys, summarizeHistory, utcDayKey } from "../src/history.ts";
import { emptyHistory, HISTORY_WINDOW_DAYS, type StatusHistory } from "../src/schema.ts";

const NOW = "2026-07-09T12:00:00.000Z";

function historyWith(days: StatusHistory["days"]): StatusHistory {
  return { ...emptyHistory(NOW), days };
}

test("a sample increments today's counter for each component", () => {
  const once = appendSample(emptyHistory(NOW), { api: "operational", ocr: "degraded" }, NOW);
  expect(once.days["2026-07-09"]).toEqual({
    api: { operational: 1 },
    ocr: { degraded: 1 },
  });
  const twice = appendSample(once, { api: "operational", ocr: "operational" }, NOW);
  expect(twice.days["2026-07-09"]).toEqual({
    api: { operational: 2 },
    ocr: { degraded: 1, operational: 1 },
  });
});

test("days outside the window are pruned on append", () => {
  const inWindow = historyDayKeys(NOW)[0] as string; // exactly 90 days back
  const stale = utcDayKey(
    new Date(Date.parse(NOW) - HISTORY_WINDOW_DAYS * 86_400_000).toISOString(),
  );
  const history = historyWith({
    [stale]: { api: { operational: 144 } },
    [inWindow]: { api: { operational: 144 } },
  });
  const appended = appendSample(history, { api: "operational" }, NOW);
  expect(appended.days[stale]).toBeUndefined();
  expect(appended.days[inWindow]).toBeDefined();
});

test("a day's tick is the worst status observed, however few its samples", () => {
  const today = utcDayKey(NOW);
  const history = historyWith({ [today]: { api: { operational: 143, major_outage: 1 } } });
  const summary = summarizeHistory(history, ["api"], NOW);
  const ticks = summary["api"]?.ticks ?? [];
  expect(ticks[ticks.length - 1]).toBe("major_outage");
});

test("uptime is sample-counted, so a brief outage costs only its own share", () => {
  const today = utcDayKey(NOW);
  const history = historyWith({ [today]: { api: { operational: 99, major_outage: 1 } } });
  expect(summarizeHistory(history, ["api"], NOW)["api"]?.uptimeRatio).toBeCloseTo(0.99, 10);
});

test("maintenance leaves the ratio untouched but still colors its day", () => {
  const today = utcDayKey(NOW);
  const history = historyWith({ [today]: { api: { operational: 100, maintenance: 44 } } });
  const summary = summarizeHistory(history, ["api"], NOW);
  // 100 operational of 100 countable samples: the 44 maintenance samples leave both sides.
  expect(summary["api"]?.uptimeRatio).toBe(1);
  const ticks = summary["api"]?.ticks ?? [];
  expect(ticks[ticks.length - 1]).toBe("maintenance");
});

test("a missed cron is an uncounted sample, never a green one", () => {
  // One run recorded an outage; the runs that should have followed never happened. Uptime must
  // read 0%, not "mostly fine" — absent samples cannot vote.
  const today = utcDayKey(NOW);
  const history = historyWith({ [today]: { api: { major_outage: 1 } } });
  expect(summarizeHistory(history, ["api"], NOW)["api"]?.uptimeRatio).toBe(0);
});

test("a component with no countable samples reads as no data, never 100%", () => {
  const summary = summarizeHistory(emptyHistory(NOW), ["api"], NOW);
  expect(summary["api"]?.uptimeRatio).toBeNull();
  expect(summary["api"]?.ticks.every((tick) => tick === null)).toBe(true);
  // Maintenance alone is not countable either: excluding it from both sides leaves nothing.
  const today = utcDayKey(NOW);
  const onlyMaintenance = historyWith({ [today]: { api: { maintenance: 12 } } });
  expect(summarizeHistory(onlyMaintenance, ["api"], NOW)["api"]?.uptimeRatio).toBeNull();
});

test("the window is exactly one tick per day, oldest first, ending today", () => {
  const summary = summarizeHistory(emptyHistory(NOW), ["api"], NOW);
  expect(summary["api"]?.ticks.length).toBe(HISTORY_WINDOW_DAYS);
  const keys = historyDayKeys(NOW);
  expect(keys.length).toBe(HISTORY_WINDOW_DAYS);
  expect(keys[keys.length - 1]).toBe("2026-07-09");
  expect(keys[0]).toBe("2026-04-11");
  // Ordered, and crossing month boundaries correctly.
  expect([...keys].sort()).toEqual(keys);
});

test("a status key from outside the vocabulary is ignored rather than voiding the day", () => {
  const today = utcDayKey(NOW);
  const history = historyWith({
    [today]: { api: { operational: 9, from_a_future_vocabulary: 1 } as Record<string, number> },
  });
  const summary = summarizeHistory(history, ["api"], NOW);
  expect(summary["api"]?.uptimeRatio).toBe(1);
  const ticks = summary["api"]?.ticks ?? [];
  expect(ticks[ticks.length - 1]).toBe("operational");
});
