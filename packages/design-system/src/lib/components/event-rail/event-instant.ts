/*
 * The rail's instant vocabulary, and how a rail is put in order.
 *
 * The formatting itself is NOT here. It is the platform's shared instant formatter — one answer for
 * every surface that shows a stored moment — and this file only carries the rail's own names for it,
 * so that a consumer holding those names keeps working. Local time and never elapsed time are that
 * module's rules; see `lib/formatters/instant.ts`.
 */
import {
  formatInstant,
  instantAttribute,
  readInstant,
  type Instant,
} from "../../formatters/instant.ts";

/** The rail's name for the shared instant options. */
export type { InstantOptions as EventInstantOptions } from "../../formatters/instant.ts";

/** The rail's name for the shared instant formatter. */
export const eventInstantText = formatInstant;

/** The rail's name for the shared `<time datetime="…">` value. */
export const eventInstantAttribute = instantAttribute;

/**
 * Put events oldest first — the rail's reading order, so a history reads the way it happened.
 *
 * The rail itself renders exactly the order it is handed, because two events can share an instant
 * and the order they were recorded in is then the only truth about which came first. This helper is
 * for a caller whose source arrives newest-first: the sort is STABLE, so events sharing an instant
 * keep the order they were given, and an unreadable instant compares as no difference and therefore
 * also stays where it was recorded.
 */
export function orderedOldestFirst<Event extends { at: Instant }>(
  events: readonly Event[],
): Event[] {
  return events
    .map((event, position) => ({ event, position }))
    .sort((left, right) => {
      const difference =
        (readInstant(left.event.at)?.getTime() ?? Number.NaN) -
        (readInstant(right.event.at)?.getTime() ?? Number.NaN);
      return difference || left.position - right.position;
    })
    .map(({ event }) => event);
}
