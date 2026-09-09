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
import { isCivilDate } from "@magna-carta/civil-time/civil-date";

export { isCivilDate, todayInUtc } from "@magna-carta/civil-time/civil-date";
export { isWallClockTime } from "@magna-carta/civil-time/wall-clock";
export { isResolvableTimeZone, viewerTimeZone } from "@magna-carta/civil-time/time-zone";

/*
 * The picker's own conversions are re-exported, not restated. They moved to sit beside the DatePicker
 * once the design system needed them too — a column filter's date range is a picker in a menu, and a
 * component cannot import an app. Screens keep importing them from `$lib/dates`, which is the point:
 * one import path for every date reading this app makes, whichever package answers it.
 */
export {
  civilDateText,
  civilDateTextOrEmpty,
  civilDateValue,
} from "@magna-carta/design-system/date-picker";

/** Whether typed text reads as a date this app will send. Re-stated in the app's own vocabulary. */
export function readsAsCivilDate(text: string | null | undefined): text is string {
  return isCivilDate(text);
}
