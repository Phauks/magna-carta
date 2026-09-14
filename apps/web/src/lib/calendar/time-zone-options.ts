/*
 * The zones a record form offers.
 *
 * A hearing's zone is the court's, and nothing about the firm, the matter or the office can work
 * that out, so the form asks — but it asks with the likely answers first: the reader's own zone and
 * the firm's office zones, then everything the runtime can resolve. The list is the runtime's, not
 * a shipped one, because IANA zones are added, renamed and merged under us and the only question
 * that matters is whether THIS runtime can render a date in the one chosen.
 *
 * A fixed offset is never offered and never accepted: an offset is wrong for half the year in every
 * zone that observes daylight saving, and storing one is how a hearing moves by an hour when the
 * clocks change.
 */
import { formatTimeZoneAbbreviation } from "@magna-carta/design-system/formatters";
import { isResolvableTimeZone } from "$lib/dates";

export interface TimeZoneOption {
  readonly value: string;
  /** The zone as a person reads it: "America/Los_Angeles" as "America / Los Angeles". */
  readonly label: string;
}

/*
 * True where the runtime can render a date in the zone; never for a bare offset — the platform's own
 * check, re-exported under this module's name so the form's list and the route's validation cannot
 * come to different conclusions about a zone somebody chose.
 */
export { isResolvableTimeZone };

/** Every zone the runtime can name, or an empty list where it cannot enumerate them. */
export function supportedTimeZones(): readonly string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

export function timeZoneLabel(timeZone: string): string {
  return timeZone.replaceAll("_", " ").replaceAll("/", " / ");
}

/**
 * The options in offering order: the preferred zones first (the reader's, the offices'), each once,
 * then the rest alphabetically. A preferred zone the runtime cannot resolve is dropped rather than
 * offered as something a record could not be read in.
 */
export function timeZoneOptions(
  preferred: readonly string[],
  supported: readonly string[] = supportedTimeZones(),
): TimeZoneOption[] {
  const seen = new Set<string>();
  const options: TimeZoneOption[] = [];
  for (const zone of preferred) {
    if (seen.has(zone) || !isResolvableTimeZone(zone)) continue;
    seen.add(zone);
    options.push({ value: zone, label: timeZoneLabel(zone) });
  }
  for (const zone of supported) {
    if (seen.has(zone)) continue;
    seen.add(zone);
    options.push({ value: zone, label: timeZoneLabel(zone) });
  }
  return options;
}

/**
 * The SHORTCODE a zone is read by on a form — "PST", "EDT", "GMT+5:30" where a zone has no letters
 * of its own (owner ruling, 2026-09-14: "time zones should go by shortcode like PST").
 *
 * The wording is the platform's, not this module's: `formatTimeZoneAbbreviation` in the design
 * system's display vocabulary, where every word a surface prints about a moment is decided once. A
 * formatter built here would be a second answer to a question that has one.
 *
 * The DAY matters and is passed through: an abbreviation is a fact about a zone at a moment, so the
 * same zone is PST in January and PDT in July, and the date the event is on is the date the code is
 * worked out for.
 */
export function timeZoneShortCode(timeZone: string, on: Date = new Date()): string {
  return formatTimeZoneAbbreviation(timeZone, on);
}

/**
 * How a zone reads in the compact control beside a time: the shortcode, with the zone's own name
 * behind it in the list so "CST" is never the whole of what somebody is choosing between.
 */
export function timeZoneShortOption(timeZone: string, on?: Date): TimeZoneOption {
  return {
    value: timeZone,
    label: `${timeZoneShortCode(timeZone, on)} · ${timeZoneLabel(timeZone)}`,
  };
}
