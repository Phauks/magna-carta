/*
 * The zones a record form offers, and how one reads wherever it is printed in full.
 *
 * A hearing's zone is the court's, and nothing about the firm, the matter or the office can work
 * that out, so the form asks — but it asks with the likely answers first: the reader's own zone and
 * the firm's office zones, then everything the runtime can resolve. The list is the runtime's, not
 * a shipped one, because IANA zones are added, renamed and merged under us and the only question
 * that matters is whether THIS runtime can render a date in the one chosen.
 *
 * ONE SHAPE FOR EVERY ZONE. The list read "PST · America / Los Angeles" on one row and
 * "GMT+5:30 · Asia / Kolkata" on the next, the field at rest said "America / Los Angeles", the
 * print sheet said the same, and the grid's chips said "(America/Los_Angeles)" (owner, 2026-09-18:
 * "time zone formattings seem all different and unstandardized. you don't even have PST"). Every
 * zone now reads as the design system's one line — "(UTC-08:00) Pacific Standard Time · Los
 * Angeles" — which states the offset from the standard, the zone's own name on the day, and the
 * city a person types. The code ("PST") is not lost: it is what a person searches by, and what the
 * chips print beside an hour.
 *
 * THE REST ARE ORDERED WEST TO EAST, by offset and then by place, the way every operating system's
 * own zone list is. An alphabetical list of identifiers put Adak beside Anchorage and Los Angeles
 * under "America", which is not where anybody looks for the Pacific.
 *
 * A fixed offset is never offered and never accepted: an offset is wrong for half the year in every
 * zone that observes daylight saving, and storing one is how a hearing moves by an hour when the
 * clocks change.
 */
import {
  describeTimeZone,
  formatTimeZone,
  formatTimeZoneAbbreviation,
} from "@magna-carta/design-system/formatters";
import { isResolvableTimeZone } from "$lib/dates";

export interface TimeZoneOption {
  readonly value: string;
  /** The one line the zone reads as: "(UTC-08:00) Pacific Standard Time · Los Angeles". */
  readonly label: string;
  /**
   * Every word a person might find the zone by, lower-cased and space-separated: its code on the
   * day, its name and its generic name, its place, its offset, and the identifier with its
   * underscores read as spaces. "pst", "pacific", "los angeles", "-08" and "los_angeles" all land.
   */
  readonly haystack: string;
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

/**
 * How a zone reads wherever it is printed in full — the record pane, the print sheet, the offices
 * table, the field at rest. The display vocabulary's one line, on the day given or today.
 */
export function timeZoneLabel(timeZone: string, on: Date = new Date()): string {
  return formatTimeZone(timeZone, on);
}

function optionFor(zone: string, on: Date): TimeZoneOption {
  const described = describeTimeZone(zone, on);
  return {
    value: zone,
    label: formatTimeZone(zone, on),
    haystack: [
      described.abbreviation,
      described.name,
      described.genericName,
      described.place,
      described.offset,
      zone.replaceAll("_", " "),
      zone,
    ]
      .join(" ")
      .toLowerCase(),
  };
}

/**
 * The options in offering order: the preferred zones first (the reader's, the offices'), each once,
 * then the rest west to east and by place within an offset. A preferred zone the runtime cannot
 * resolve is dropped rather than offered as something a record could not be read in.
 *
 * `on` is the day the codes, names and offsets are worked out for — the record's own, because the
 * same zone is PST in January and PDT in July.
 */
export function timeZoneOptions(
  preferred: readonly string[],
  supported: readonly string[] = supportedTimeZones(),
  on: Date = new Date(),
): TimeZoneOption[] {
  const seen = new Set<string>();
  const options: TimeZoneOption[] = [];
  for (const zone of preferred) {
    if (seen.has(zone) || !isResolvableTimeZone(zone)) continue;
    seen.add(zone);
    options.push(optionFor(zone, on));
  }
  const rest: { option: TimeZoneOption; offsetMinutes: number; place: string }[] = [];
  for (const zone of supported) {
    if (seen.has(zone)) continue;
    seen.add(zone);
    const described = describeTimeZone(zone, on);
    rest.push({
      option: optionFor(zone, on),
      offsetMinutes: described.offsetMinutes,
      place: described.place,
    });
  }
  rest.sort(
    (left, right) =>
      left.offsetMinutes - right.offsetMinutes || left.place.localeCompare(right.place),
  );
  return [...options, ...rest.map((held) => held.option)];
}

/**
 * The options whose words carry what was typed. Every word of the query has to land somewhere in
 * the option's haystack, so "pacific la" finds Los Angeles and "central" finds all three Centrals
 * with their places beside them to choose by.
 */
export function matchingTimeZones(
  options: readonly TimeZoneOption[],
  query: string,
): TimeZoneOption[] {
  const words = query.trim().toLowerCase().replaceAll("_", " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((option) => words.every((word) => option.haystack.includes(word)));
}

/**
 * The SHORTCODE a zone is read by beside an hour — "PST", "EDT", "GMT+5:30" where a zone has no
 * letters of its own (owner ruling, 2026-09-14: "time zones should go by shortcode like PST").
 *
 * The wording is the platform's, not this module's: `formatTimeZoneAbbreviation` in the design
 * system's display vocabulary, where every word a surface prints about a moment is decided once.
 *
 * The DAY matters and is passed through: an abbreviation is a fact about a zone at a moment, so the
 * same zone is PST in January and PDT in July, and the date the event is on is the date the code is
 * worked out for.
 */
export function timeZoneShortCode(timeZone: string, on: Date = new Date()): string {
  return formatTimeZoneAbbreviation(timeZone, on);
}
