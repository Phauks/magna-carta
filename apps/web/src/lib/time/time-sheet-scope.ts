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

/** The named spans the scope menu offers above the custom range. */
export const SCOPE_PRESET_IDENTIFIERS = ["today", "yesterday", "week"] as const;

export type ScopePresetIdentifier = (typeof SCOPE_PRESET_IDENTIFIERS)[number];

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
  return moment.toISOString().slice(0, 10);
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
 * describes the span it actually produced.
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
  const daysIntoTheWeek =
    (new Date(`${today}T00:00:00Z`).getUTCDay() - firstWeekdayOfTheFirmsWeek + 7) % 7;
  const from = shiftDays(today, -daysIntoTheWeek);
  const to = shiftDays(from, 6);
  return { from, to, label: `This week, ${spanLabel(from, to)}` };
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
      reason: "The start is after the end, so the range is not applied until it reads forwards.",
    };
  }
  return { kind: "applied", scope: { from, to, label: spanLabel(from, to) } };
}
