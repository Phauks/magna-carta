/**
 * The colour register an entry wears. Every tone is the SUBTLE register — a pale same-hue tint,
 * deep same-hue text and a soft hairline — because the grid is a work surface and a saturated block
 * on it fights the data. `accent` is the gold pair, for an entry that is an edge rather than a
 * record (a firm-wide moment); `neutral` is the resting register.
 */
export type CalendarGridTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

/**
 * One entry on a CalendarGrid: what it says, which civil day it sits on, and how it reads.
 *
 * The shape is deliberately domain-free. The same grid presents a firm's calendar, a matter's
 * dates and whatever else has days on it, so nothing here may name a hearing, a deadline or a
 * matter — a caller states what the entry says in `label` and the grid presents it.
 */
export interface CalendarGridEntry {
  /** Stable identity for this entry. Used as the render key, so it is unique within a grid. */
  id: string;
  /**
   * The civil day the entry sits on, as `YYYY-MM-DD`. Never an instant: a civil day is a fact
   * about the record and does not shift under the viewer's zone, so the grid never converts one.
   */
  date: string;
  /**
   * The last civil day of a span, as `YYYY-MM-DD`; absent for a point. A span paints on every day
   * it covers, marked on its first and last day. An end before the start is read as a point.
   */
  endDate?: string;
  /** What it says, in the caller's own words: "Hearing", "Response due", "Firm meeting". */
  label: string;
  /** The second line: a matter number, a place, an audience. Shown where the cell has room. */
  detail?: string;
  /**
   * The wall-clock time, ALREADY formatted by the caller. The grid never formats a time: which
   * zone a time is stated in, and whether that zone is named, are facts about the domain the grid
   * does not know.
   */
  time?: string;
  /** The colour register. */
  tone: CalendarGridTone;
  /**
   * Struck through: a setting that was called off, a deadline that was vacated. Shown and struck,
   * never hidden, because a thing that was cancelled and a thing that never existed are different
   * facts.
   */
  struck?: boolean;
  /**
   * Where activating the entry goes, when it goes somewhere: the chip renders as a link. A caller
   * that opens a window instead leaves this absent and handles `onActivate`.
   */
  href?: string;
}
