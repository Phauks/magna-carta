import { describe, expect, it } from "vitest";
import {
  atOccurrence,
  effectiveScope,
  occurrenceOf,
  seriesChangeChoices,
  seriesChangeRefusal,
  seriesWideFields,
} from "$lib/calendar/occurrence-change.ts";
import { lastOccurrenceSentence } from "$lib/calendar/recurrence-sentence.ts";
import { weeklyRecurrence } from "@magna-carta/civil-time/recurrence";

const series = { startsOn: "2026-09-01", endsOn: "2026-09-02", recurrenceRule: "FREQ=WEEKLY" };

describe("one day of a repeating setting", () => {
  it("opens on the day pressed, carrying the series' own length", () => {
    expect(atOccurrence(series, "2026-09-15")).toEqual({
      startsOn: "2026-09-15",
      endsOn: "2026-09-16",
      recurrenceRule: "FREQ=WEEKLY",
    });
    expect(atOccurrence(series, "2026-09-01")).toBe(series);
  });

  it("reads the day from the reference, and nothing for a record that does not repeat", () => {
    const record = { kind: "event", event: series } as unknown as Parameters<
      typeof occurrenceOf
    >[0];
    expect(occurrenceOf(record, { occurrenceOn: "2026-09-08" } as never)).toBe("2026-09-08");
    expect(occurrenceOf(record, null)).toBe("2026-09-01");
    const once = { kind: "event", event: { ...series, recurrenceRule: null } } as never;
    expect(occurrenceOf(once, { occurrenceOn: "2026-09-08" } as never)).toBeNull();
  });

  it("moves the whole series by the days this one moved, when the change is to every day", () => {
    const change: { startsOn?: string; endsOn?: string | null; title: string } = {
      startsOn: "2026-09-16",
      endsOn: "2026-09-17",
      title: "Status call",
    };
    const fields = seriesWideFields(
      change,
      { startsOn: "2026-09-01", endsOn: "2026-09-02" },
      "2026-09-15",
    );
    expect(fields).toEqual({ startsOn: "2026-09-02", endsOn: "2026-09-03", title: "Status call" });
    const untimed: { startsOn?: string; title: string } = { title: "x" };
    expect(seriesWideFields(untimed, series, "2026-09-15")).toEqual({ title: "x" });
  });

  it("offers three answers, worded for the day pressed", () => {
    expect(seriesChangeChoices("2026-09-15").map((choice) => choice.value)).toEqual([
      "this",
      "following",
      "all",
    ]);
  });

  it("refuses a change to how it repeats on one day alone", () => {
    expect(seriesChangeRefusal("this", true)).toMatch(/more than one day/);
    expect(seriesChangeRefusal("following", true)).toBeUndefined();
    expect(seriesChangeRefusal("this", false)).toBeUndefined();
  });

  it("sends this-and-later from the first day as the ordinary edit", () => {
    expect(effectiveScope("following", "2026-09-01", series)).toBe("all");
    expect(effectiveScope("following", "2026-09-08", series)).toBe("following");
    expect(effectiveScope("this", "2026-09-01", series)).toBe("this");
  });
});

describe("the line under Ends", () => {
  it("names the day the last one falls on", () => {
    const rule = { ...weeklyRecurrence(), end: { kind: "after" as const, count: 3 } };
    expect(lastOccurrenceSentence(rule, "2026-09-01")).toMatch(/^Last one .*2026\.$/);
    expect(lastOccurrenceSentence(rule, "2026-09-01")).toContain("15");
  });

  it("says there is no end, and says nothing without a start", () => {
    expect(lastOccurrenceSentence(weeklyRecurrence(), "2026-09-01")).toBe("No end date.");
    const rule = { ...weeklyRecurrence(), end: { kind: "after" as const, count: 3 } };
    expect(lastOccurrenceSentence(rule, null)).toBe("");
  });
});
