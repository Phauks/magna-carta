/*
 * How every kind of calendar entry reads: its word, its second line, and its colour register. One
 * table, so the firm calendar, the matter section and the dashboard's card cannot call the same
 * hearing three things.
 *
 * Tones are the SUBTLE status register (design-corrections.md: on a work surface, status colour
 * comes as a pale same-hue chip, never a saturated block). Only a firm entry takes the accent,
 * because a firm-wide entry is an edge on a calendar of matters rather than one of the matters.
 */
import type { CalendarGridTone } from "@magna-carta/design-system/calendar-grid";
import type { EventType } from "./calendar-api.ts";

/**
 * The SOURCE KEYS a firm-scope federated read is narrowed to. The read's `kind` filter names a
 * source in the registry (`matterEvent`), not the kind word a row carries (`event`); a key the
 * registry does not hold is refused rather than ignored. Deadlines come from their own read, which
 * carries titles, and firm events from the firm's own listing.
 */
export const FIRM_CALENDAR_KINDS: readonly string[] = ["matterEvent"];

/**
 * The platform type codes whose events are court settings a person has to be at. They take the
 * info register so a hearing is told from a filing at a glance; everything else stays neutral.
 */
const APPEARANCE_CODES: ReadonlySet<string> = new Set([
  "HEARING",
  "TRIAL",
  "DEPO",
  "MEDIATION",
  "ARBITRATION",
  "SETTLEMENT",
  "STATUS",
]);

/** The tone an event of this platform type takes. */
export function eventTypeTone(code: string | null): CalendarGridTone {
  return code !== null && APPEARANCE_CODES.has(code.toUpperCase()) ? "info" : "neutral";
}

/** The word a firm-wide chip shows for an event whose type is unknown or firm-authored. */
export const UNCLASSIFIED_EVENT_LABEL = "Event";
/** The word a firm-wide chip shows for a firm event whose type is unknown. */
export const UNCLASSIFIED_FIRM_EVENT_LABEL = "Firm event";

/** A catalog keyed by code, for turning a federated label (a platform type code) into a name. */
export function eventTypesByCode(types: readonly EventType[]): ReadonlyMap<string, EventType> {
  const byCode = new Map<string, EventType>();
  for (const type of types) {
    if (type.code !== null) byCode.set(type.code.toUpperCase(), type);
  }
  return byCode;
}

/** A catalog keyed by identifier, for the record forms and the entry window. */
export function eventTypesById(types: readonly EventType[]): ReadonlyMap<string, EventType> {
  return new Map(types.map((type) => [type.id, type]));
}

/** The name a platform type code resolves to, or the unclassified word where it resolves to nothing. */
export function eventTypeNameForCode(
  code: string | null,
  byCode: ReadonlyMap<string, EventType>,
): string {
  if (code === null) return UNCLASSIFIED_EVENT_LABEL;
  return byCode.get(code.toUpperCase())?.name ?? UNCLASSIFIED_EVENT_LABEL;
}

/**
 * A federated kind that is neither an event nor a deadline nor a firm event — a custody due-back,
 * a review date — as a person reads it. Slice 2 turns these on; the word is decided now so a kind
 * arriving early renders as something rather than as its key.
 */
export function humanizeKind(kind: string): string {
  const spaced = kind
    .replaceAll("_", " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
