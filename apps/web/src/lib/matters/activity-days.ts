/*
 * The activity page cut into days.
 *
 * A chronology is read by day, not by row: somebody reconstructing a case asks what happened on the
 * 14th, and a flat list of forty rows with a repeated date on each one answers that question forty
 * times instead of once. So the rows are grouped under the day they belong to, in the order the
 * server already put them in.
 *
 * THE SERVER'S ORDER IS NEVER RE-SORTED HERE. Entries arrive under one comparable sort key across
 * fourteen subsystems, and the cursor that pages them is keyed on that same expression. Re-ordering
 * a page client-side would put rows in an order the next page does not continue, so this only ever
 * cuts the sequence it was handed.
 *
 * TWO SHAPES IN ONE COLUMN. Most sources sort by a civil date (`2026-08-30`) and a few by an instant
 * (`2026-08-30T09:00:00.000Z`), which the server merges under one key deliberately. The day is the
 * first ten characters of either, which is why this takes the sort key rather than parsing a date:
 * reading an instant into a `Date` and formatting it back would shift the day for every reader east
 * or west of the zone it was written in, and a case chronology that moves a filing to the day before
 * depending on who opens it is worse than useless.
 */

/** One day of the chronology: the civil day, and the entries the server placed on it, in its order. */
export interface ActivityDay<Entry> {
  /** The civil date, `YYYY-MM-DD`. The render key, and what the day heading is formatted from. */
  readonly day: string;
  readonly entries: readonly Entry[];
}

/**
 * Cut a page of entries into days, preserving the order they arrived in.
 *
 * Consecutive runs only — the same day appearing twice, separated by another, would be two groups.
 * That cannot happen while the server orders by the same key it cuts pages on, and if it ever did,
 * showing it is right: a chronology that silently merged two runs would be hiding the disorder
 * rather than reporting it.
 */
export function activityDays<Entry extends { readonly sortKey: string }>(
  entries: readonly Entry[],
): readonly ActivityDay<Entry>[] {
  const days: { day: string; entries: Entry[] }[] = [];
  for (const entry of entries) {
    const day = entry.sortKey.slice(0, 10);
    const open = days.at(-1);
    if (open !== undefined && open.day === day) {
      open.entries.push(entry);
      continue;
    }
    days.push({ day, entries: [entry] });
  }
  return days;
}

/**
 * The clock time an entry happened at, or null where its source records only a day.
 *
 * Half the sources sort by a civil date and half by an instant, and the difference is real
 * information: a document arrives at a moment, a deadline falls on a day. So the time is shown
 * where there is one and the column stands empty where there is not, rather than inventing a
 * midnight that would sort and read as a fact nobody recorded.
 *
 * Read off the stored instant in the VIEWER's own zone, like every other instant on a surface here.
 */
export function timeOfDay(sortKey: string): string | null {
  if (sortKey.length <= 10) return null;
  const at = new Date(sortKey);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
