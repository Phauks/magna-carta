/*
 * The seam between the picker's value and the text a record holds — and the ONE implementation of it.
 *
 * The picker's value is an @internationalized/date CalendarDate; almost everything that stores a date
 * stores the civil-date text (`YYYY-MM-DD`). Every surface with a date field needs both directions,
 * and six of them had written the same six lines, four carrying the same comment word for word.
 *
 * WHY IT LIVES BESIDE THE PICKER rather than in @magna-carta/civil-time, which owns what a date IS:
 * CalendarDate is this component's value type and nothing else's. A package the Worker imports would
 * be taking on a date library it never constructs a value from, to serve a conversion only a browser
 * makes. So the shape question stays in civil-time and the widget question stays here, which is the
 * same line the formatters sit on.
 *
 * These do not re-answer "is this a date" — `parseDate` refusing IS the answer, and a second
 * validator here would be the duplicate this file exists to remove.
 */

import { parseDate, type CalendarDate } from "@internationalized/date";

/**
 * A civil date as the DatePicker holds one, or `undefined` while the field is empty or half-entered.
 *
 * `undefined` rather than a throw, and rather than null, because that is what the picker's `value`
 * takes: a half-typed year is an ordinary state of a form somebody is filling in, not a fault, and a
 * picker handed a broken value would take the whole screen down with it.
 *
 * Accepts the two ways a form holds "nothing" — `null` from a draft and `""` from a bound field —
 * because both are in use and demanding one of them would just move the conditional to every caller.
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
