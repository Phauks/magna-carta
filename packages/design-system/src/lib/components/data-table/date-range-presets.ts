/*
 * Quick date-range presets for the date column filter. The control offers one-tap ranges relative to a
 * reference "today" (and a plain "Today") instead of a nested calendar — a calendar popover nested
 * inside the filter popover crashes the floating layer, and presets are the faster choice for the
 * common "recently opened" filters anyway.
 *
 * A preset yields an inclusive [start, end] of `@internationalized/date` CalendarDate; the column
 * filter stores it as the `YYYY-MM-DD` `[from, to]` pair that `dateRangeFilterFn` reads.
 */
import type { CalendarDate } from "@internationalized/date";

export type DateRangePresetId =
  | "today"
  | "last-7-days"
  | "last-30-days"
  | "last-3-months"
  | "last-12-months";

export interface DateRangePreset {
  readonly id: DateRangePresetId;
  readonly label: string;
  /** The inclusive range for this preset, given the reference day. */
  readonly range: (today: CalendarDate) => {
    readonly start: CalendarDate;
    readonly end: CalendarDate;
  };
}

/** The ranges end at today; the "last N" windows are inclusive of today (so "last 7 days" spans 7). */
export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: "today", label: "Today", range: (today) => ({ start: today, end: today }) },
  {
    id: "last-7-days",
    label: "Last 7 days",
    range: (today) => ({ start: today.subtract({ days: 6 }), end: today }),
  },
  {
    id: "last-30-days",
    label: "Last 30 days",
    range: (today) => ({ start: today.subtract({ days: 29 }), end: today }),
  },
  {
    id: "last-3-months",
    label: "Last 3 months",
    range: (today) => ({ start: today.subtract({ months: 3 }), end: today }),
  },
  {
    id: "last-12-months",
    label: "Last 12 months",
    range: (today) => ({ start: today.subtract({ months: 12 }), end: today }),
  },
];

/** A preset's range as the `[from, to]` pair of `YYYY-MM-DD` strings the date filter stores. */
export function presetFilterValue(preset: DateRangePreset, today: CalendarDate): [string, string] {
  const { start, end } = preset.range(today);
  return [start.toString(), end.toString()];
}

/** Which preset (if any) the current `[from, to]` filter value matches, for highlighting the choice. */
export function activeDateRangePresetId(
  value: readonly [string?, string?] | undefined,
  today: CalendarDate,
): DateRangePresetId | undefined {
  if (!value) return undefined;
  const [from, to] = value;
  return DATE_RANGE_PRESETS.find((preset) => {
    const [presetFrom, presetTo] = presetFilterValue(preset, today);
    return presetFrom === from && presetTo === to;
  })?.id;
}
