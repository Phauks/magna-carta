/*
 * HOW A PRINTED SHEET SAYS A DATE — declared once, for every sheet.
 *
 * Seven sheets each declared their own version of this seam, and the parameter was named `isoDate`
 * in five of them and `civilDate` in two. That disagreement is not cosmetic: it is a record of
 * nobody being sure what the function took, and it is what let a stored instant be passed to a
 * formatter contracted for a day. Ten surfaces shipped the wrong day that way — two of them on
 * these very sheets, which go to clients.
 *
 * So the two questions are named separately here, once, with the difference stated where a caller
 * reads it. A sheet's own context extends this and adds what only that sheet needs (a currency-bound
 * `money`, a matter title); nothing re-declares a date.
 *
 * WHY A SEAM AT ALL rather than the sheets importing the formatters directly: a sheet is a pure
 * function from a record to a `PrintSheetDocument`, tested against fixed strings with no locale or
 * zone in play. Handing it the formatters keeps that property — and it is the seam a firm-level
 * display setting drives when one exists, without a sheet changing.
 */
import { formatDate, formatInstantDate } from "@magna-carta/design-system/formatters";

/** The two date questions a printed sheet asks, and they are not the same question. */
export interface PrintSheetDates {
  /**
   * A CIVIL DATE — a day the firm wrote down: a work date, a service date, a due date.
   *
   * Pinned to UTC, so the day never moves under the reader. A sheet printed in Reno and the same
   * sheet printed in Boston name the same day, which is the whole point of storing a day rather
   * than a moment.
   */
  readonly date: (civilDate: string) => string;
  /**
   * The day a recorded MOMENT fell on — `createdAt`, `openedAt`, `sentAt`.
   *
   * Read in the reader's own zone, because a moment happened to somebody and the question is which
   * of their days it was. This differs from `date` by a day for roughly a third of every day, and
   * passing an instant to `date` instead is the mistake this pair exists to make hard: a record
   * entered at 18:30 in Los Angeles has a `createdAt` of 01:30Z the next morning.
   */
  readonly instantDate: (instant: string) => string;
}

/**
 * The standard pair, so a caller assembling a sheet's context does not hand-wire two closures — and
 * cannot hand-wire them to the wrong pair of functions, which is how this went wrong the first time.
 *
 * Locale and zone are the viewer's own, which is what the formatters default to. A caller needing
 * fixed ones (a deterministic test, a sheet that must read identically everywhere) builds the
 * object itself; that is a deliberate act rather than an option to pass here.
 */
export function printSheetDates(): PrintSheetDates {
  return { date: formatDate, instantDate: formatInstantDate };
}
