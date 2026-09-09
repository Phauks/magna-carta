/*
 * When a message was sent, written out rather than abbreviated.
 *
 * A date on a security screen is read once, under stress, usually to answer one question: is the
 * mail in front of me the one this page just sent, or the one from twenty minutes ago? So the month
 * is spelled ("September 4, 2026", never 09/04/26 — which half the world reads as 9 April anyway),
 * the clock is 24-hour so there is no AM/PM to miss, and the zone is carried twice: the
 * abbreviation, because that is what people read, and the UTC offset, because abbreviations are
 * reused around the world and the offset is what makes the value resolvable by anyone, later,
 * anywhere. Both are DERIVED from the zone being rendered, so a summer instant prints PDT and a
 * winter one prints PST without anybody remembering to change it.
 *
 * Pure, and here rather than inline in a screen, so the shape is unit-tested against a fixed zone
 * instead of eyeballed on whatever machine happened to render it.
 */
import { viewerTimeZone } from "@magna-carta/civil-time/time-zone";
import { formatInstantDate } from "@magna-carta/design-system/formatters";

const LOCALE = "en-US";

function zonePart(when: Date, timeZone: string, style: "short" | "longOffset"): string {
  const parts = new Intl.DateTimeFormat(LOCALE, { timeZone, timeZoneName: style }).formatToParts(
    when,
  );
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/** The date alone, written out in full: `September 4, 2026`. */
export function longDate(when: Date, timeZone?: string): string {
  return formatInstantDate(when, { locale: LOCALE, timeZone, length: "long" });
}

/**
 * A full instant with its zone: `September 4, 2026, 14:03 PDT (UTC-07:00)`.
 *
 * Omit `timeZone` for the viewer's own — their mailbox, their clock. Pass one only for an instant
 * that must not move as it is passed between people.
 */
export function sentStamp(when: Date, timeZone?: string): string {
  const zone = timeZone ?? viewerTimeZone();
  const date = longDate(when, zone);
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(when);
  const abbreviation = zonePart(when, zone, "short");
  const rawOffset = zonePart(when, zone, "longOffset");
  // A zone sitting exactly on UTC reports a bare "GMT" with no numbers on it; spell the zero out
  // rather than printing a name where every other zone prints an offset.
  const offset = /[+-]\d{2}:\d{2}$/.test(rawOffset)
    ? rawOffset.replace(/^GMT/, "UTC")
    : "UTC+00:00";
  return `${date}, ${time} ${abbreviation} (${offset})`;
}
