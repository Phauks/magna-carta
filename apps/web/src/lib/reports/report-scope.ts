/*
 * WHAT A REPORT IS ASKED OVER: a period on the effective axis, a knowledge instant on the knowledge
 * axis (or none, which is live), and the subject it is about.
 *
 * THE SCOPE RIDES THE ADDRESS. A report somebody ran is a link somebody else can open, so every
 * half of the scope is read from the URL and written back to it. Nothing here is a screen concern:
 * the arithmetic and the wording live in this module so a test can hold them still.
 *
 * ONE DEFINITION PER PRESET. A preset's name and its span are computed together, on the Time
 * screen's pattern, so "Last quarter" can never read over the wrong ninety days. The day-level
 * helpers are the time sheet's own — one arithmetic for a span across the product.
 */
import { endOfCivilMonth } from "@magna-carta/civil-time/civil-date";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import { CANONICAL_INSTANT_PATTERN } from "@magna-carta/civil-time/instant";
import {
  customRangeOutcome,
  spanLabel,
  type CustomRangeOutcome,
  type SheetScope,
  shiftDays,
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
  return endOfCivilMonth(year, month);
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

// THE KNOWLEDGE INSTANT IS CHOSEN AS A DAY, AND THE DAY ENDS IN THE OFFICE'S ZONE.
//
// A person asks for a report "as things stood on the first of August". That is a civil day, and the
// reporting package's contract takes a UTC instant to the millisecond; the instant a chosen day
// means is the LAST MILLISECOND OF THAT DAY IN THE ZONE OF THE OFFICE THAT HOLDS THE ACCOUNT,
// resolved per trust account (the listing carries the zone), so two members of one firm asking for
// the same day get the same instant, and a Nevada firm's "31 July" ends at midnight in Nevada rather
// than at four the next afternoon. The owner's ruling, 2026-09-07. An office recorded before the
// zone column existed resolves to UTC on the server, in exactly one place; this module only ever
// receives a zone.
//
// No time picker, deliberately: the precision invites a question the document cannot answer well,
// and the full instant is printed on the provenance section for anyone who needs it.

/** The zone a scope reads in before an account, and its office, has been chosen. */
export const DEFAULT_KNOWLEDGE_ZONE = "UTC";

/** The shape the knowledge axis is written in; anything else on the address reads as live. */
const KNOWLEDGE_INSTANT = CANONICAL_INSTANT_PATTERN;

/**
 * The wall-clock reading of an instant in a zone: the civil date and the minutes into that day.
 *
 * The reading itself is `zonedReading` — the platform's one projection of an instant into a zone,
 * and the same one the server's resolver uses, so the two cannot come to different conclusions
 * about which day an instant fell on. Nothing here carries offsets or daylight rules, which is the
 * whole reason an office stores a zone name rather than an offset. The minutes into the day are
 * this module's own, because only this module compares them.
 */
function wallClockIn(instant: Date, timeZone: string): { date: string; minutesOfDay: number } {
  const reading = zonedReading(instant.getTime(), timeZone);
  const [hour, minute] = reading.wallClockTime.split(":").map(Number) as [number, number];
  return { date: reading.civilDate, minutesOfDay: hour * 60 + minute };
}

function utcMidnightOf(isoDate: string): number {
  return Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  );
}

/**
 * The instant at which the NEXT civil day begins in the zone: the first millisecond after the day
 * asked for. Found by taking that day's midnight as if it were UTC and correcting it by however far
 * the zone's wall clock reads from midnight at that guess; a second pass catches a daylight-saving
 * transition that falls between the guess and the answer.
 */
function startOfNextDayIn(isoDate: string, timeZone: string): number {
  const nextDay = shiftDays(isoDate, 1);
  let guess = utcMidnightOf(nextDay);
  for (let pass = 0; pass < 2; pass += 1) {
    const wall = wallClockIn(new Date(guess), timeZone);
    const dayDrift = Math.round((utcMidnightOf(wall.date) - utcMidnightOf(nextDay)) / 86_400_000);
    const driftMinutes = dayDrift * 24 * 60 + wall.minutesOfDay;
    if (driftMinutes === 0) break;
    guess -= driftMinutes * 60_000;
  }
  return guess;
}

/** The instant a chosen day names: the last millisecond of that day, in the zone given. */
export function knowledgeInstantForDate(
  isoDate: string,
  timeZone: string = DEFAULT_KNOWLEDGE_ZONE,
): string {
  return new Date(startOfNextDayIn(isoDate, timeZone) - 1).toISOString();
}

/** The day a knowledge instant falls on in the zone, for the control to show it back. */
export function knowledgeDateOf(
  knownAsOf: string,
  timeZone: string = DEFAULT_KNOWLEDGE_ZONE,
): string {
  return wallClockIn(new Date(knownAsOf), timeZone).date;
}

/**
 * The same chosen day, re-resolved in another zone: what happens to the instant when the reader
 * picks a trust account whose office keeps a different clock. The DAY is what the person chose, so
 * the day survives and the instant moves.
 */
export function knowledgeInstantMovedToZone(
  knownAsOf: string,
  fromZone: string,
  toZone: string,
): string {
  return knowledgeInstantForDate(knowledgeDateOf(knownAsOf, fromZone), toZone);
}

/** The scope a report is run over. `subject` is the report's subject handle where it has one. */
export interface ReportScope {
  readonly period: ReportPeriod;
  /** Null is live: everything known now. */
  readonly knownAsOf: string | null;
  readonly subject: string | null;
  /** The office the rows are narrowed to; null is every office. A filter, never a gate. */
  readonly office: string | null;
}

/**
 * The scope as the address names it, or the default period where the address names none or
 * names one that cannot be answered — a span that reads backwards, a date that is not one. A
 * knowledge instant that is not in the shape the knowledge axis is written in reads as live.
 */
export function readReportScope(
  searchParams: URLSearchParams,
  defaultPeriod: ReportPeriod,
): ReportScope {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  let period = defaultPeriod;
  if (from !== null && to !== null) {
    const outcome = customReportPeriodOutcome(from, to);
    if (outcome.kind === "applied") period = outcome.scope;
  }
  const knownAsOf = searchParams.get("knownAsOf");
  return {
    period,
    knownAsOf: knownAsOf !== null && KNOWLEDGE_INSTANT.test(knownAsOf) ? knownAsOf : null,
    subject: searchParams.get("subject"),
    office: searchParams.get("office"),
  };
}

/** The address a scope writes, on the URL it is given. Absent halves clear their parameter. */
export function writeReportScope(url: URL, scope: ReportScope): URL {
  const next = new URL(url);
  next.searchParams.set("from", scope.period.from);
  next.searchParams.set("to", scope.period.to);
  if (scope.knownAsOf === null) next.searchParams.delete("knownAsOf");
  else next.searchParams.set("knownAsOf", scope.knownAsOf);
  if (scope.subject === null) next.searchParams.delete("subject");
  else next.searchParams.set("subject", scope.subject);
  if (scope.office === null) next.searchParams.delete("office");
  else next.searchParams.set("office", scope.office);
  return next;
}

/** One line for the citation: the period, then whether the answer is fixed or live. */
export function scopeReading(
  scope: ReportScope,
  timeZone: string = DEFAULT_KNOWLEDGE_ZONE,
): string {
  const when =
    scope.knownAsOf === null
      ? "everything known now"
      : `as known at the end of ${knowledgeDateOf(scope.knownAsOf, timeZone)}`;
  return `${periodLabel(scope.period)} · ${when}`;
}
