/*
 * The readings this app makes of a date, and the one place it makes them.
 *
 * Three questions come up on almost every form that carries a date, and each of them had been
 * answered separately, several times over:
 *
 *   1. "Is this typed text a date?" — five implementations, one per subsystem, agreeing by luck.
 *   2. "What does the date picker hold for this stored string?" — six copies of the same six lines,
 *      four of them carrying the same comment word for word.
 *   3. "Which zone is the reader in?" — four inline `Intl.DateTimeFormat().resolvedOptions()` calls.
 *
 * None of them was wrong. That is the point: a duplicate that is wrong gets fixed, and a duplicate
 * that is right sits there until somebody corrects one copy of it.
 *
 * WHAT LIVES WHERE. The SHAPE of a date is @magna-carta/civil-time's — it is the same shape on the
 * server, and a browser-only answer to "is this a date" is how a form and its route come to disagree.
 * How a date READS is @magna-carta/design-system/formatters'. This module is only the seam between
 * those two and the widgets a screen actually holds: the picker's `CalendarDate`, and the text a
 * request carries.
 */
import { parseDate, type CalendarDate } from "@internationalized/date";
import { isCivilDate } from "@magna-carta/civil-time/civil-date";

export { isCivilDate, todayInUtc } from "@magna-carta/civil-time/civil-date";
export { isWallClockTime } from "@magna-carta/civil-time/wall-clock";
export { isResolvableTimeZone, viewerTimeZone } from "@magna-carta/civil-time/time-zone";

/**
 * A civil date as the DatePicker holds one, or `undefined` while the field is empty or half-entered.
 *
 * `undefined` rather than a throw, and rather than null, because that is what the picker's `value`
 * takes: a half-typed year is an ordinary state of a form somebody is filling in, not a fault, and a
 * picker handed a broken value would take the whole screen down with it.
 *
 * Accepts the two ways a form holds "nothing" — `null` from a draft and `""` from a bound input —
 * because both existed in the copies this replaces and demanding one of them would just move the
 * conditional to every caller.
 */
export function civilDateValue(text: string | null | undefined): CalendarDate | undefined {
  if (text === null || text === undefined || text === "") return undefined;
  try {
    return parseDate(text);
  } catch {
    return undefined;
  }
}

/**
 * What the picker's value becomes as stored text: the civil date, or `null` where the field was
 * cleared. The mirror of `civilDateValue`, here so the pair cannot drift apart.
 */
export function civilDateText(value: { toString(): string } | undefined): string | null {
  return value === undefined ? null : value.toString();
}

/**
 * The same, for the forms that hold an empty field as `""` rather than as `null`. Both spellings
 * are in use and neither is wrong; what would be wrong is a screen inventing a third.
 */
export function civilDateTextOrEmpty(value: { toString(): string } | undefined): string {
  return value === undefined ? "" : value.toString();
}

/** Whether typed text reads as a date this app will send. Re-stated in the app's own vocabulary. */
export function readsAsCivilDate(text: string | null | undefined): text is string {
  return isCivilDate(text);
}
