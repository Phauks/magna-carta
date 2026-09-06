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
import type { EventType, ParticipantKind } from "./calendar-api.ts";
import type { EntryReferenceKind } from "./entry-reference.ts";

/**
 * The SOURCE KEYS a firm-scope federated read is narrowed to. The read's `kind` filter names a
 * source in the registry (`matterEvent`), not the kind word a row carries (`event`); a key the
 * registry does not hold is refused rather than ignored. Deadlines come from their own read, which
 * carries titles, and firm events from the firm's own listing.
 */
export const FIRM_CALENDAR_KINDS: readonly string[] = ["matterEvent"];

/**
 * A LAYER is a set of the timeline's other sources a reader can turn on over the firm calendar.
 * Only sources whose rows are DATES belong here: a custody due-back and a review date are things
 * that fall due, so they read on a calendar; a time entry, a filed email or a trust movement is
 * history, and belongs to the matter timeline rather than to a month grid it would flood.
 *
 * Each layer names its source keys (the read's `kind` filter takes source keys, and refuses one
 * the registry does not hold) and the word each of those sources' kinds paints as.
 */
export interface CalendarLayer {
  readonly key: string;
  /** The toggle's word. */
  readonly label: string;
  readonly sources: readonly string[];
  /** The kind word a row of this layer carries, to the word a person reads. */
  readonly kindLabels: Readonly<Record<string, string>>;
}

export const CALENDAR_LAYERS: readonly CalendarLayer[] = [
  {
    key: "custody",
    label: "Custody dates",
    sources: ["custodyDueBack", "custodyReviewDue"],
    kindLabels: {
      dueBack: "Due back",
      packetReviewDue: "Packet review due",
      itemReviewDue: "Item review due",
    },
  },
];

/** The layer a key names, where one does. */
export function calendarLayer(key: string): CalendarLayer | undefined {
  return CALENDAR_LAYERS.find((layer) => layer.key === key);
}

/** The source keys a firm read is narrowed to: the base kinds plus every layer turned on. */
export function firmCalendarKinds(layerKeys: ReadonlySet<string>): readonly string[] {
  const kinds = [...FIRM_CALENDAR_KINDS];
  for (const layer of CALENDAR_LAYERS) {
    if (layerKeys.has(layer.key)) kinds.push(...layer.sources);
  }
  return kinds;
}

/** The word a layered kind paints as; a kind no layer names falls back to its humanized key. */
export function layeredKindLabel(kind: string): string {
  for (const layer of CALENDAR_LAYERS) {
    const label = layer.kindLabels[kind];
    if (label !== undefined) return label;
  }
  return humanizeKind(kind);
}

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

/** The word each kind of record is called where nothing more specific is known. */
export const ENTRY_KIND_WORDS: Readonly<Record<EntryReferenceKind, string>> = {
  event: "Event",
  deadline: "Deadline",
  firmEvent: "Firm Event",
};

/** The word each kind of participant is called in the Participants tab. */
export const PARTICIPANT_KIND_WORDS: Readonly<Record<ParticipantKind, string>> = {
  member: "Firm member",
  entity: "Directory record",
  external: "External",
};
