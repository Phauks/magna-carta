/*
 * The Time Sheet's date scope: which days the sheet is showing, and how it says so.
 *
 * ONE DEFINITION PER PRESET. A preset's name and its span are computed together and read from the
 * same place by the menu and by whatever applies it, so a preset can never say "This week" over
 * three days. The firm's first weekday is an argument rather than a constant, because a firm that
 * starts its week on Sunday and a firm that starts it on Monday are both right and the sheet has to
 * ask rather than assume.
 *
 * THE SCOPE WIDENS RATHER THAN HIDING. A row somebody just created or re-dated is never dropped out
 * of view by the range that was in play a second earlier: the range grows to include it and the
 * caption says why. Widening is the only honest move, because the alternative is a row that saved
 * and then vanished, which reads as work lost.
 *
 * Everything here is pure. The surface holds the current scope and renders it; the arithmetic and
 * the wording of a span live here so a test can hold them still.
 */
import { civilDateOf, endOfCivilMonth } from "@magna-carta/civil-time/civil-date";

/** A span of days the sheet is showing, and how the sheet names it. */
export interface SheetScope {
  /** The first day in view, as an ISO calendar date. */
  readonly from: string;
  /** The last day in view, inclusive. */
  readonly to: string;
  /** What the scope control reads. */
  readonly label: string;
  /** Why the range is wider than the reader asked for, when something widened it. */
  readonly note?: string;
}

/** The named spans the SHEET's scope menu offers above the custom range. */
export const SCOPE_PRESET_IDENTIFIERS = ["today", "yesterday", "week"] as const;

/**
 * The named spans the PERIOD ledger offers — the sheet's three, plus the ones only a review surface
 * asks for.
 *
 * Two menus, one arithmetic. The sheet is a capture surface and a person captures into today,
 * yesterday or the week they are in; the period ledger is where a month gets read back, reconciled
 * and billed from, and a menu that stopped at seven days would send that reader to the custom range
 * every single time. Both lists resolve through `scopePreset`, so a span can never mean one thing
 * on one surface and something else on the other.
 */
export const PERIOD_PRESET_IDENTIFIERS = [
  "today",
  "yesterday",
  "week",
  "lastWeek",
  "month",
  "lastMonth",
] as const;

export type ScopePresetIdentifier = (typeof PERIOD_PRESET_IDENTIFIERS)[number];

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** An ISO calendar date shifted by whole days, still as an ISO calendar date. */
export function shiftDays(isoDate: string, days: number): string {
  const moment = new Date(`${isoDate}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return civilDateOf(moment);
}

/** "Aug 26" — the short form a span is written in. */
export function monthDay(isoDate: string): string {
  const month = MONTH_NAMES[Number(isoDate.slice(5, 7)) - 1] ?? "";
  return `${month} ${String(Number(isoDate.slice(8, 10)))}`;
}

/** How a span reads: one day, days inside one month, or a run across two. */
export function spanLabel(from: string, to: string): string {
  if (from === to) return monthDay(from);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${monthDay(from)} to ${String(Number(to.slice(8, 10)))}`;
  }
  return `${monthDay(from)} to ${monthDay(to)}`;
}

/**
 * A named span, computed against the day the reader is having.
 *
 * `firstWeekdayOfTheFirmsWeek` is 0 for Sunday through 6 for Saturday. It is a firm setting in the
 * product; until that setting is served, the caller passes the platform default and the label still
 * describes the span it actually produced. It is read by the week spans alone — a month begins on
 * its first day at every firm.
 */
export function scopePreset(
  identifier: ScopePresetIdentifier,
  today: string,
  firstWeekdayOfTheFirmsWeek: number,
): SheetScope {
  if (identifier === "today") {
    return { from: today, to: today, label: `Today, ${monthDay(today)}` };
  }
  if (identifier === "yesterday") {
    const yesterday = shiftDays(today, -1);
    return { from: yesterday, to: yesterday, label: `Yesterday, ${monthDay(yesterday)}` };
  }
  if (identifier === "month" || identifier === "lastMonth") {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    // The month asked for, as a 1-based month in its own year: December of the previous year when
    // "last month" is asked in January.
    const wanted = identifier === "month" ? month : month === 1 ? 12 : month - 1;
    const wantedYear = identifier === "month" || month > 1 ? year : year - 1;
    const first = `${String(wantedYear)}-${String(wanted).padStart(2, "0")}-01`;
    // Day zero of the NEXT month is the last day of this one, so no month-length table is needed
    // and February gets its leap years right for free.
    const last = endOfCivilMonth(wantedYear, wanted);
    return {
      from: first,
      to: last,
      label: `${identifier === "month" ? "This month" : "Last month"}, ${spanLabel(first, last)}`,
    };
  }
  const daysIntoTheWeek =
    (new Date(`${today}T00:00:00Z`).getUTCDay() - firstWeekdayOfTheFirmsWeek + 7) % 7;
  const thisWeek = shiftDays(today, -daysIntoTheWeek);
  const from = identifier === "lastWeek" ? shiftDays(thisWeek, -7) : thisWeek;
  const to = shiftDays(from, 6);
  return {
    from,
    to,
    label: `${identifier === "lastWeek" ? "Last week" : "This week"}, ${spanLabel(from, to)}`,
  };
}

/** Whether a preset is the span currently in view, so the menu can mark it. */
export function isScopeShowing(scope: SheetScope, preset: SheetScope): boolean {
  return scope.from === preset.from && scope.to === preset.to;
}

/** Whether a date falls inside the span the sheet is showing. */
export function scopeHolds(scope: SheetScope, isoDate: string): boolean {
  return isoDate >= scope.from && isoDate <= scope.to;
}

/**
 * The scope grown to hold a date it does not, or null when it already holds it.
 *
 * `becauseOf` names the row in the reader's terms ("row you just added"), and it is completed into
 * the caption here so every widening is worded the same way.
 */
export function widenedScope(
  scope: SheetScope,
  isoDate: string,
  becauseOf: string,
): SheetScope | null {
  if (scopeHolds(scope, isoDate)) return null;
  const from = isoDate < scope.from ? isoDate : scope.from;
  const to = isoDate > scope.to ? isoDate : scope.to;
  return {
    from,
    to,
    label: spanLabel(from, to),
    note: `widened to include the ${becauseOf} on ${monthDay(isoDate)}`,
  };
}

/** What a hand-picked range does: it applies, or it says why it cannot. */
export type CustomRangeOutcome =
  | { readonly kind: "applied"; readonly scope: SheetScope }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * A hand-picked range, applied as it is picked.
 *
 * There is no Apply control by design, so the refusals have to carry their own explanation: a range
 * that reads backwards is not silently swapped, because swapping it would hide a mis-click behind a
 * result the reader did not ask for.
 */
export function customRangeOutcome(from: string, to: string): CustomRangeOutcome {
  if (from === "" || to === "") {
    return {
      kind: "refused",
      reason: "Pick both a start and an end. The range applies as you pick it.",
    };
  }
  if (from > to) {
    return {
      kind: "refused",
      reason: "The start is after the end, so the range isn't applied.",
    };
  }
  return { kind: "applied", scope: { from, to, label: spanLabel(from, to) } };
}
