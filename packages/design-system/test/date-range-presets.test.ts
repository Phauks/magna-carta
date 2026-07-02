import { CalendarDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  activeDateRangePresetId,
  DATE_RANGE_PRESETS,
  presetFilterValue,
} from "../src/lib/components/data-table/date-range-presets.ts";

/*
 * Quick date-range presets. A fixed reference day keeps the assertions deterministic (the component
 * passes the real `today`). The "last N" windows are inclusive of today.
 */
const TODAY = new CalendarDate(2026, 6, 17);
const preset = (id: string) => DATE_RANGE_PRESETS.find((candidate) => candidate.id === id)!;

describe("date-range presets — the [from, to] each yields", () => {
  it("Today is the single day", () => {
    expect(presetFilterValue(preset("today"), TODAY)).toEqual(["2026-06-17", "2026-06-17"]);
  });

  it("Last 7 days spans seven days inclusive of today", () => {
    expect(presetFilterValue(preset("last-7-days"), TODAY)).toEqual(["2026-06-11", "2026-06-17"]);
  });

  it("Last 30 days spans thirty days inclusive of today", () => {
    expect(presetFilterValue(preset("last-30-days"), TODAY)).toEqual(["2026-05-19", "2026-06-17"]);
  });

  it("Last 3 months ends today", () => {
    expect(presetFilterValue(preset("last-3-months"), TODAY)).toEqual(["2026-03-17", "2026-06-17"]);
  });

  it("Last 12 months ends today", () => {
    expect(presetFilterValue(preset("last-12-months"), TODAY)).toEqual([
      "2025-06-17",
      "2026-06-17",
    ]);
  });
});

describe("date-range presets — recognising the active preset", () => {
  it("matches a stored value back to its preset", () => {
    expect(activeDateRangePresetId(["2026-06-17", "2026-06-17"], TODAY)).toBe("today");
    expect(activeDateRangePresetId(["2026-03-17", "2026-06-17"], TODAY)).toBe("last-3-months");
  });

  it("returns undefined for no value or a custom range matching no preset", () => {
    expect(activeDateRangePresetId(undefined, TODAY)).toBeUndefined();
    expect(activeDateRangePresetId(["2024-01-01", "2024-02-01"], TODAY)).toBeUndefined();
  });
});
