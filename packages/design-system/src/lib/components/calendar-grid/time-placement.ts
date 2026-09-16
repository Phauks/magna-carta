/*
 * Where a timed entry sits on an hour axis, and how it shares the column with whatever runs at the
 * same time. The arithmetic behind the Day and the Week, kept out of both for the reason every
 * other answer in this family is: the questions a reader would argue about — what a fifteen-minute
 * call looks like, what happens when three things start at ten, where an entry with no end goes —
 * are answered here, in functions a test reads without a browser.
 *
 * AN ENTRY IS A BLOCK FROM ITS START TO ITS END, not a mark at its start. The grid used to put a
 * chip in the row of the hour it began in and say how long it ran in words, on the argument that a
 * two-pixel sliver is unreadable; the owner overturned it (2026-09-14: "start and end time need to
 * properly show themselves on the calendar, not just on the start, should stretch accordingly").
 * The sliver is answered by a MINIMUM height rather than by refusing to stretch at all: a block is
 * never shorter than one that can hold a line of text, so a fifteen-minute call reads, and an entry
 * that outgrows its true duration says so by overlapping what follows it, which is the truth about
 * a day with a fifteen-minute call in it.
 *
 * AN ENTRY WITH NO END IS A POINT, and a point gets the minimum. Half the entries a firm calendar
 * paints arrive through the federated read, which declares a time of day and no duration; a grid
 * that guessed an hour for them would draw a fact nobody recorded.
 *
 * MINUTES, NEVER CLOCKS — as everywhere else on this grid. The caller holds the wall clock and the
 * zone it is read in; this module is handed numbers and returns fractions.
 */
import { HOURS_IN_DAY, MINUTES_IN_HOUR } from "./day-axis.ts";
import type { CalendarGridEntry } from "./types.ts";

/**
 * How entries that run at the same time share their column.
 *
 * - `side-by-side` divides the column between them: three things at ten o'clock are three narrow
 *   blocks, and the width says how crowded the hour is.
 * - `overlap` lets them lie over one another, each stepped in from the one before so every block
 *   is still reachable and the stack still reads as a stack. Wider blocks, a busier picture.
 *
 * A closed set, and the reader's own choice rather than the grid's (owner ruling, 2026-09-14).
 */
export type CalendarGridConcurrency = "side-by-side" | "overlap";

/** The presentation a grid takes when its caller says nothing: the honest one, where nothing hides. */
export const DEFAULT_CONCURRENCY: CalendarGridConcurrency = "side-by-side";

/**
 * The shortest block the grid will draw, in minutes of the axis. Not a duration anybody recorded —
 * a block this size stands for anything from a point to half an hour — but the floor under which a
 * chip cannot hold its own label, which is the one thing a block on a calendar has to do.
 */
export const MINIMUM_BLOCK_MINUTES = 30;

/** How far each successive block in an overlapping stack is stepped in, as a fraction of the column. */
const OVERLAP_STEP = 0.12;
/** The most of the column an overlapping stack will give away to its steps, however deep it runs. */
const OVERLAP_MAX_INSET = 0.6;

/** One entry, placed on the axis and given its share of the column. */
export interface PlacedTimeEntry {
  readonly entry: CalendarGridEntry;
  /** Where the block starts, as a fraction of the drawn axis from its top. */
  readonly start: number;
  /** How tall the block is, as a fraction of the drawn axis. Never zero. */
  readonly size: number;
  /** Where the block starts across the column, as a fraction of its width. */
  readonly inset: number;
  /** How much of the column's width the block takes, as a fraction. */
  readonly width: number;
  /** Paint order within a stack, so a later block lies over an earlier one rather than under it. */
  readonly depth: number;
}

/** The minutes an entry occupies on the axis, after the minimum and the day's own bounds. */
export interface TimeSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * What an entry occupies: its own minutes, floored at the minimum block and clipped to the day.
 *
 * An end at or before the start is read as no end at all — a record whose end was never filled in,
 * or filled in wrong — because a block of zero or negative height is not a smaller truth than a
 * block of the minimum, it is an entry that vanished.
 */
export function timeSpanOf(entry: CalendarGridEntry): TimeSpan | null {
  const start = entry.startMinute;
  if (start === undefined || !Number.isFinite(start)) return null;
  const from = clampMinute(start);
  const end = entry.endMinute;
  const recorded =
    end !== undefined && Number.isFinite(end) && end > from ? clampMinute(end) : from;
  const to = Math.max(recorded, from + MINIMUM_BLOCK_MINUTES);
  return { from, to: Math.min(to, MINUTES_IN_DAY) };
}

/**
 * Place one column's timed entries on the axis the grid is drawing.
 *
 * The entries are grouped into CLUSTERS — runs where each entry overlaps something already in the
 * run — and the column is divided within a cluster rather than across the whole day, so a busy
 * morning never narrows a quiet afternoon. Inside a cluster, columns are handed out greedily to
 * the first that is free, which is the arrangement every calendar settled on: it keeps a thing that
 * follows another in the same column as it, so a reader's eye tracks down one lane.
 */
export function placeTimeEntries(
  entries: readonly CalendarGridEntry[],
  axis: TimeSpan,
  concurrency: CalendarGridConcurrency = DEFAULT_CONCURRENCY,
): PlacedTimeEntry[] {
  const span = Math.max(axis.to - axis.from, 1);
  const timed = entries
    .map((entry) => ({ entry, at: timeSpanOf(entry) }))
    .filter((held): held is { entry: CalendarGridEntry; at: TimeSpan } => held.at !== null)
    // By start, then longest first: a cluster's widest thing is the one a reader wants behind the
    // rest, and a stable order is what keeps two renders of one day identical.
    .toSorted((left, right) => left.at.from - right.at.from || right.at.to - left.at.to);

  const placed: PlacedTimeEntry[] = [];
  for (const cluster of clustersOf(timed)) {
    const lanes = assignLanes(cluster);
    const laneCount = Math.max(...lanes.map((held) => held.lane)) + 1;
    for (const held of lanes) {
      const share = shareOf(held.lane, laneCount, concurrency);
      placed.push({
        entry: held.entry,
        start: (held.at.from - axis.from) / span,
        size: (held.at.to - held.at.from) / span,
        inset: share.inset,
        width: share.width,
        depth: held.lane,
      });
    }
  }
  return placed;
}

/** How much of the column one lane of a cluster takes, and where it starts across it. */
function shareOf(
  lane: number,
  laneCount: number,
  concurrency: CalendarGridConcurrency,
): { inset: number; width: number } {
  if (concurrency === "side-by-side") {
    const width = 1 / laneCount;
    return { inset: lane * width, width };
  }
  // Overlapping: every block runs to the column's far edge and starts one step further in than the
  // one behind it, so the stack reads as a stack and its last block is still the widest thing in it.
  const inset = Math.min(lane * OVERLAP_STEP, OVERLAP_MAX_INSET);
  return { inset, width: 1 - inset };
}

/** Runs of entries that overlap something already in the run. Each is divided on its own. */
function clustersOf(
  timed: readonly { entry: CalendarGridEntry; at: TimeSpan }[],
): { entry: CalendarGridEntry; at: TimeSpan }[][] {
  const clusters: { entry: CalendarGridEntry; at: TimeSpan }[][] = [];
  let current: { entry: CalendarGridEntry; at: TimeSpan }[] = [];
  let reach = Number.NEGATIVE_INFINITY;
  for (const held of timed) {
    if (current.length > 0 && held.at.from >= reach) {
      clusters.push(current);
      current = [];
      reach = Number.NEGATIVE_INFINITY;
    }
    current.push(held);
    reach = Math.max(reach, held.at.to);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Hand each entry in a cluster the first lane free at its start. A thing that begins when another
 * ends inherits that lane, which is what keeps a back-to-back morning reading as one column.
 */
function assignLanes(
  cluster: readonly { entry: CalendarGridEntry; at: TimeSpan }[],
): { entry: CalendarGridEntry; at: TimeSpan; lane: number }[] {
  const freeFrom: number[] = [];
  return cluster.map((held) => {
    let lane = freeFrom.findIndex((endsAt) => endsAt <= held.at.from);
    if (lane === -1) lane = freeFrom.length;
    freeFrom[lane] = held.at.to;
    return { ...held, lane };
  });
}

/** How many minutes a day holds — the ceiling a block is clipped to. */
const MINUTES_IN_DAY = HOURS_IN_DAY * MINUTES_IN_HOUR;

function clampMinute(minute: number): number {
  return Math.min(Math.max(Math.trunc(minute), 0), MINUTES_IN_DAY);
}
