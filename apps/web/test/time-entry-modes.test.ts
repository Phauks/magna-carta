/*
 * The three ways a person can say how long they worked, and the rounding that turns any of them
 * into what the firm bills.
 *
 * These are pure functions over text, which is exactly why they are worth pinning: every one of
 * them sits directly under a field somebody types into at speed, and each has a shape that reads
 * as obviously right and is wrong. "9-5" is eight hours and not four. An end time earlier than a
 * start time is a night shift, not an error. Two units of a firm that bills in quarters is half an
 * hour and not twelve minutes. A billed figure is the worked one rounded on the firm's own policy,
 * which is why nothing here has a constant in it.
 */
import { describe, expect, it } from "vitest";
import {
  parseClockTime,
  parseTimeSpan,
  roundToIncrement,
  type RoundingPolicy,
} from "$lib/time/time-operations.ts";
import { TIME_ENTRY_MODES, TIME_ENTRY_MODE_LABELS } from "$lib/time/time-preferences.svelte.ts";

const tenths: RoundingPolicy = { incrementMinutes: 6, roundingDirection: "nearest" };
const quarters: RoundingPolicy = { incrementMinutes: 15, roundingDirection: "nearest" };

describe("a clock time somebody typed", () => {
  it("reads the shapes people actually type", () => {
    expect(parseClockTime("9")).toBe(9 * 60);
    expect(parseClockTime("9:30")).toBe(9 * 60 + 30);
    expect(parseClockTime("0930")).toBe(9 * 60 + 30);
    expect(parseClockTime("09:30")).toBe(9 * 60 + 30);
    expect(parseClockTime("14:05")).toBe(14 * 60 + 5);
  });

  it("reads a meridiem, including the two that trip every naive conversion", () => {
    expect(parseClockTime("9am")).toBe(9 * 60);
    expect(parseClockTime("9 pm")).toBe(21 * 60);
    expect(parseClockTime("12:30 am")).toBe(30); // midnight half past, not noon
    expect(parseClockTime("12:30 pm")).toBe(12 * 60 + 30); // noon half past, not midnight
  });

  it("refuses what is not a time, rather than inventing one", () => {
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime("half nine")).toBeNull();
    expect(parseClockTime("25:00")).toBeNull();
    expect(parseClockTime("9:75")).toBeNull();
    expect(parseClockTime("13pm")).toBeNull();
  });
});

describe("the span between two times", () => {
  it("is the elapsed time, not the difference between the hour numbers", () => {
    expect(parseTimeSpan("9:00", "10:30")).toBe(90);
    // The one everybody gets wrong on a first pass: nine to five is eight hours.
    expect(parseTimeSpan("9", "17")).toBe(8 * 60);
    expect(parseTimeSpan("9am", "5pm")).toBe(8 * 60);
  });

  it("reads an end earlier than its start as crossing midnight, because that is a real evening", () => {
    expect(parseTimeSpan("23:00", "01:00")).toBe(120);
    expect(parseTimeSpan("22:30", "00:15")).toBe(105);
  });

  it("has no answer for a span of no time, or for a half-typed one", () => {
    expect(parseTimeSpan("9:00", "9:00")).toBeNull();
    expect(parseTimeSpan("9:00", "")).toBeNull();
    expect(parseTimeSpan("", "10:00")).toBeNull();
    expect(parseTimeSpan("breakfast", "lunch")).toBeNull();
  });
});

describe("rounding worked time to what the firm bills", () => {
  it("rounds to the nearest increment", () => {
    expect(roundToIncrement(64, tenths)).toBe(66);
    expect(roundToIncrement(62, tenths)).toBe(60);
    expect(roundToIncrement(64, quarters)).toBe(60);
    expect(roundToIncrement(68, quarters)).toBe(75);
  });

  it("rounds the way the firm said, not the way that is convenient", () => {
    expect(roundToIncrement(61, { incrementMinutes: 6, roundingDirection: "up" })).toBe(66);
    expect(roundToIncrement(65, { incrementMinutes: 6, roundingDirection: "down" })).toBe(60);
  });

  it("leaves a duration that already lands on an increment exactly where it is", () => {
    expect(roundToIncrement(60, tenths)).toBe(60);
    expect(roundToIncrement(60, quarters)).toBe(60);
  });

  it("is the same arithmetic that decides what a unit is worth, which is why it is not a constant", () => {
    // Two units at a firm billing in tenths is twelve minutes; at a firm billing in quarters it is
    // half an hour. A screen that assumed one of these would mis-record time at the other.
    expect(2 * tenths.incrementMinutes).toBe(12);
    expect(2 * quarters.incrementMinutes).toBe(30);
  });
});

describe("the ways of entering time a reader can choose between", () => {
  it("names all three, and each has words for the menu that offers it", () => {
    expect(TIME_ENTRY_MODES).toEqual(["hours", "units", "span"]);
    for (const mode of TIME_ENTRY_MODES) {
      expect(TIME_ENTRY_MODE_LABELS[mode].length).toBeGreaterThan(0);
    }
  });
});
