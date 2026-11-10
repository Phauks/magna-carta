import type { PaletteColorName } from "../../palette/index.ts";

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
   * Which lane of a Day this entry sits in — the key of one of the Day's `lanes`. Absent, or
   * naming a lane the Day was not given, puts it in the first lane; a Day with no lanes is one
   * column and ignores this entirely. Month, week and agenda never read it: a day column there is
   * a DAY, and an entry is on the day it is on whoever it belongs to.
   */
  lane?: string;
  /**
   * How many minutes past midnight the entry starts, in its own row's zone — the numeric twin of
   * the already-formatted `time`. The Day's hour rows need a number and cannot get one out of a
   * string somebody else formatted; absent means all day, which is what a filing is, and the Day
   * puts it in the band above the hours. Never derived here: the caller has the wall clock.
   */
  startMinute?: number;
  /** Where it ends, on the same scale. Absent where nothing was recorded. */
  endMinute?: number;
  /** The colour of the calendar it came from, where the reader gave that calendar one. */
  color?: CalendarGridColor;
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
   * One day of a series that repeats. Marked with the repeat glyph before the time and said in
   * words to a reader who cannot see it, because a weekly conference and a one-off hearing on the
   * same Tuesday are different facts about what moving one of them will do.
   */
  repeats?: boolean;
  /**
   * Where activating the entry goes, when it goes somewhere: the chip renders as a link. A caller
   * that opens a window instead leaves this absent and handles `onActivate`.
   */
  href?: string;
}

/**
 * The colour a calendar the entry came FROM was given, which is a different question from `tone`
 * and answered by a different person. `tone` is the status register the product decides — an open
 * deadline past its day is `danger` whoever owns it — while the colour is the member's own answer
 * to "which of my calendars is this", chosen in the rail and carried here. They never fight,
 * because the colour paints only the chip's leading rule and the tone paints the chip.
 *
 * The names are the product's one palette (`lib/palette/index.ts`); the calendar offers the
 * subset of them that reads on a chip (`CALENDAR_COLORS`).
 */
export type CalendarGridColor = PaletteColorName;

/**
 * One column of a Day: a calendar the reader turned on, in the order the rail lists them.
 *
 * A lane is how a day of parallel scheduling becomes legible — six attorneys in four places at
 * once is six columns, not one list of eighteen rows. The grid knows nothing about what a lane IS;
 * the caller names it and hands every entry the key of the lane it belongs in.
 */
export interface CalendarGridLane {
  /** Stable identity, and what an entry's `lane` names. */
  key: string;
  /** The column head's word: a person's name, a room's name, "The firm". */
  label: string;
  /** The colour the column head and its entries wear, where the reader gave the calendar one. */
  color?: CalendarGridColor;
}
