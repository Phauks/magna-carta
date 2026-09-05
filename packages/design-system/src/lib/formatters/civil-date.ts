/*
 * A CALENDAR DAY, as the reader sees it — a work date, a due date, the day a cost was incurred.
 *
 * This is deliberately not the same question as an instant (formatters/instant.ts), and the
 * difference is the whole reason both exist. An instant is a moment that happened to somebody, so
 * it renders in the VIEWER'S OWN zone. A civil date is a day the firm wrote down; it belongs to no
 * zone, and rendering it in the viewer's would let the same work date read as the 12th in one
 * office and the 11th in another. So it is pinned to UTC, and the day never moves.
 *
 * The short month is what a dense ledger row can carry without wrapping, and it is unambiguous
 * across the locales this product serves in a way a numeric day/month order is not.
 */

/** A civil date in any of the forms a caller is likely to hold one. */
export type CivilDateInput = Date | string | number;

/** How a civil date is named. */
export interface CivilDateOptions {
  /** BCP-47 locale. Defaults to the runtime's own, which is what a viewer's browser reports. */
  locale?: string;
}

/** A calendar day, pinned to UTC so it reads the same in every office. */
export function formatDate(value: CivilDateInput, options: CivilDateOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(options.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
