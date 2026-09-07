/*
 * WHAT A REPORT IS ASKED OVER: a period on the effective axis, a knowledge instant on the knowledge
 * axis (or none, which is live), the subject it is about, and any options the report offers.
 *
 * THE SCOPE RIDES THE ADDRESS. A report somebody ran is a link somebody else can open, so every
 * half of the scope is read from the URL and written back to it. Nothing here is a screen concern:
 * the arithmetic and the wording live in this module so a test can hold them still.
 *
 * ONE DEFINITION PER PRESET. A preset's name and its span are computed together, on the Time
 * screen's pattern, so "Last quarter" can never read over the wrong ninety days. The day-level
 * helpers are the time sheet's own — one arithmetic for a span across the product.
 */
import {
  customRangeOutcome,
  spanLabel,
  type CustomRangeOutcome,
  type SheetScope,
} from "$lib/time/time-sheet-scope.ts";

/** A span of days a report covers, and how the control names it. */
export type ReportPeriod = SheetScope;

export const REPORT_PERIOD_PRESET_IDENTIFIERS = [
  "month",
  "lastMonth",
  "quarter",
  "lastQuarter",
  "year",
  "lastYear",
] as const;

export type ReportPeriodPresetIdentifier = (typeof REPORT_PERIOD_PRESET_IDENTIFIERS)[number];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function lastDayOf(year: number, month: number): string {
  // Day zero of the NEXT month is the last day of this one, so February's leap years are free.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function firstDayOf(year: number, month: number): string {
  return `${String(year)}-${String(month).padStart(2, "0")}-01`;
}

/** A named span, computed against the day the reader is having (an ISO calendar date). */
export function reportPeriodPreset(
  identifier: ReportPeriodPresetIdentifier,
  today: string,
): ReportPeriod {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (identifier) {
    case "month":
    case "lastMonth": {
      const wanted = identifier === "month" ? month : month === 1 ? 12 : month - 1;
      const wantedYear = identifier === "month" || month > 1 ? year : year - 1;
      const from = firstDayOf(wantedYear, wanted);
      const to = lastDayOf(wantedYear, wanted);
      const name = identifier === "month" ? "This month" : "Last month";
      return { from, to, label: `${name}, ${MONTH_NAMES[wanted - 1]} ${String(wantedYear)}` };
    }
    case "quarter":
    case "lastQuarter": {
      // Quarters are calendar quarters: a firm with a fiscal year is a later setting, and a
      // control that guessed one would print "Q3" over the wrong months.
      let quarter = Math.floor((month - 1) / 3) + 1;
      let quarterYear = year;
      if (identifier === "lastQuarter") {
        quarter -= 1;
        if (quarter === 0) {
          quarter = 4;
          quarterYear -= 1;
        }
      }
      const firstMonth = (quarter - 1) * 3 + 1;
      const from = firstDayOf(quarterYear, firstMonth);
      const to = lastDayOf(quarterYear, firstMonth + 2);
      const name = identifier === "quarter" ? "This quarter" : "Last quarter";
      return { from, to, label: `${name}, Q${String(quarter)} ${String(quarterYear)}` };
    }
    case "year":
    case "lastYear": {
      const wantedYear = identifier === "year" ? year : year - 1;
      const name = identifier === "year" ? "This year" : "Last year";
      return {
        from: firstDayOf(wantedYear, 1),
        to: lastDayOf(wantedYear, 12),
        label: `${name}, ${String(wantedYear)}`,
      };
    }
  }
}

/** A hand-picked range, applied as it is picked — the time sheet's own rule and wording. */
export function customReportPeriodOutcome(from: string, to: string): CustomRangeOutcome {
  return customRangeOutcome(from, to);
}

/** Whether a preset is the period in view, so the menu can mark it. */
export function isPeriodShowing(period: ReportPeriod, preset: ReportPeriod): boolean {
  return period.from === preset.from && period.to === preset.to;
}

/** How a period reads in a citation: "Jul 1 to 31", "Jan 1 to Dec 31". */
export function periodLabel(period: ReportPeriod): string {
  return spanLabel(period.from, period.to);
}

// THE KNOWLEDGE INSTANT IS CHOSEN AS A DAY. The question a person asks is "as things stood on the
// first of August", and the reporting package's contract takes a UTC instant to the millisecond;
// the instant a chosen day means is the last instant of that day in UTC, stated as such beside the
// control. Whether it should be the end of the day in the office's zone waits on the office time
// zone being a served setting — flagged in the design, not decided here.
const END_OF_DAY = "T23:59:59.999Z";

/** The instant a chosen day names: the last millisecond of that day, in UTC. */
export function knowledgeInstantForDate(isoDate: string): string {
  return `${isoDate}${END_OF_DAY}`;
}

/** The day a knowledge instant was chosen as, for the control to show it back. */
export function knowledgeDateOf(knownAsOf: string): string {
  return knownAsOf.slice(0, 10);
}

/** The scope a report is run over. `subject` is the report's subject handle where it has one. */
export interface ReportScope {
  readonly period: ReportPeriod;
  /** A UTC instant, or null for live — everything known now. */
  readonly knownAsOf: string | null;
  readonly subject: string | null;
  /** The report's own options, keyed as the report declares them; absent means the default. */
  readonly options: Readonly<Record<string, string>>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The scope an address names, over the default period for a reader who named none.
 *
 * An address carrying a span that reads backwards or a date that is not one falls back to the
 * default rather than to a refusal: the link was written by somebody else's hand, and a screen
 * that opens on a sensible period is a better answer than one that opens on an error.
 */
export function readReportScope(
  searchParams: URLSearchParams,
  defaultPeriod: ReportPeriod,
  optionKeys: readonly string[],
): ReportScope {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  let period = defaultPeriod;
  if (from !== null && to !== null && ISO_DATE.test(from) && ISO_DATE.test(to)) {
    const outcome = customRangeOutcome(from, to);
    if (outcome.kind === "applied") period = outcome.scope;
  }
  const knownAsOf = searchParams.get("knownAsOf");
  const options: Record<string, string> = {};
  for (const key of optionKeys) {
    const value = searchParams.get(key);
    if (value !== null) options[key] = value;
  }
  return {
    period,
    knownAsOf: knownAsOf !== null && ISO_INSTANT.test(knownAsOf) ? knownAsOf : null,
    subject: searchParams.get("subject"),
    options,
  };
}

/** The address a scope writes, on the URL it is given. Absent halves clear their parameter. */
export function writeReportScope(url: URL, scope: ReportScope, optionKeys: readonly string[]): URL {
  const next = new URL(url);
  next.searchParams.set("from", scope.period.from);
  next.searchParams.set("to", scope.period.to);
  if (scope.knownAsOf === null) next.searchParams.delete("knownAsOf");
  else next.searchParams.set("knownAsOf", scope.knownAsOf);
  if (scope.subject === null) next.searchParams.delete("subject");
  else next.searchParams.set("subject", scope.subject);
  for (const key of optionKeys) {
    const value = scope.options[key];
    if (value === undefined) next.searchParams.delete(key);
    else next.searchParams.set(key, value);
  }
  return next;
}

/** One line for the citation: the period, then whether the answer is fixed or live. */
export function scopeReading(scope: ReportScope): string {
  const when =
    scope.knownAsOf === null
      ? "everything known now"
      : `as known at the end of ${knowledgeDateOf(scope.knownAsOf)}`;
  return `${periodLabel(scope.period)} · ${when}`;
}
