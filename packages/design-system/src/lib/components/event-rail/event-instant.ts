/*
 * How an event's instant is read, and how a rail is put in order.
 *
 * Two rules govern this file and neither is negotiable:
 *
 *   1. A timestamp renders in the VIEWER'S LOCAL time. Instants are stored UTC; a person reading a
 *      history is asking when something happened to them, in the hours their own day is measured
 *      in, so the conversion happens here at render rather than anywhere upstream.
 *   2. NEVER elapsed time. "Just now", "2 hours ago" and their family are banned outright: they
 *      decay while the reader looks at them, they cannot be compared between two rows, and a
 *      history is a record. State the actual instant.
 *
 * The formatting is deliberately a small, replaceable default. When the platform's shared instant
 * formatter lands, this becomes a one-line re-export and every rail moves with it — which is also
 * why the component takes the formatter as a prop.
 */
import type { EventInstant } from "./types.ts";

export interface EventInstantOptions {
  /** BCP-47 locale. Defaults to the runtime's own, which is what a viewer's browser reports. */
  locale?: string;
  /**
   * IANA time zone. Defaults to the viewer's own zone — that default is the point of the rule, so
   * pass this only where a caller genuinely needs a fixed zone (a deterministic test, a printed
   * sheet that must read the same everywhere).
   */
  timeZone?: string;
}

/** Parse an instant into a `Date`, or `null` when the value is not a readable instant. */
function readInstant(at: EventInstant): Date | null {
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The instant as a reader sees it: an absolute date and time in local time.
 *
 * An unreadable value renders as the raw text it arrived as. Showing what the data actually says
 * makes a bad instant visible as the defect it is, where a silent blank or a cheerful "Invalid
 * Date" would hide it.
 */
export function eventInstantText(at: EventInstant, options: EventInstantOptions = {}): string {
  const date = readInstant(at);
  if (date === null) return String(at);
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: options.timeZone,
  }).format(date);
}

/**
 * The machine-readable form for a `<time datetime="…">` attribute — the UTC instant, so assistive
 * technology and any copy-out reads the same moment the display does. `undefined` where the value
 * is not a readable instant, which leaves the attribute off rather than writing a lie.
 */
export function eventInstantAttribute(at: EventInstant): string | undefined {
  const date = readInstant(at);
  return date === null ? undefined : date.toISOString();
}

/**
 * Put events oldest first — the rail's reading order, so a history reads the way it happened.
 *
 * The rail itself renders exactly the order it is handed, because two events can share an instant
 * and the order they were recorded in is then the only truth about which came first. This helper is
 * for a caller whose source arrives newest-first: the sort is STABLE, so events sharing an instant
 * keep the order they were given, and an unreadable instant compares as no difference and therefore
 * also stays where it was recorded.
 */
export function orderedOldestFirst<Event extends { at: EventInstant }>(
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
