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
 *
 * A layer is a ROW IN THE RAIL, under Dates (calendar-sources.ts), with a read of its own narrowed
 * to exactly these keys. It used to widen the firm's own records read instead, which read the same
 * rows twice and put a custody due-back on the calendar of the firm's matters and deadlines.
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
    label: "Custody Dates",
    sources: ["custodyDueBack", "custodyReviewDue"],
    kindLabels: {
      dueBack: "Due back",
      packetReviewDue: "Packet review due",
      itemReviewDue: "Item review due",
    },
  },
  {
    key: "fileDestruction",
    label: "File Destruction Dates",
    sources: ["matterFileDestruction"],
    kindLabels: {
      fileDestruction: "Destroy after",
    },
  },
];

/** The layer a key names, where one does. */
export function calendarLayer(key: string): CalendarLayer | undefined {
  return CALENDAR_LAYERS.find((layer) => layer.key === key);
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
 * a review date — as a person reads it. The fallback for a kind no layer names, so a source that
 * starts emitting a kind before `CALENDAR_LAYERS` has a word for it renders as something readable
 * rather than as its own key.
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

/**
 * The word each kind of participant is called, wherever one is named: the picker's sources, the
 * bundles the chips are listed under, the record pane. One vocabulary, so a colleague is "Staff"
 * in every one of them (owner, 2026-09-18: "Staff", not "Firm member"; "Other", not "Someone
 * else").
 */
export const PARTICIPANT_KIND_WORDS: Readonly<Record<ParticipantKind, string>> = {
  member: "Staff",
  entity: "Directory",
  external: "Other",
};

/**
 * The roles a participant is OFFERED — offered, and nothing more than that. The record's column is
 * free text on purpose (@magna-carta/database's per-firm schema rules it a short firm-supplied
 * label, because the vocabulary is jurisdiction-specific and nothing downstream reads it), so this
 * list seeds the control and never constrains what is stored. A firm whose practice needs a role
 * nobody here thought of types it and keeps it.
 *
 * Alphabetical, because a list ordered by whoever happened to think of each entry has no order at
 * all. Held by a test, so an addition cannot quietly land in the middle.
 */
export const PARTICIPANT_ROLE_OPTIONS: readonly string[] = [
  "Appearing counsel",
  "Arbitrator",
  "Clerk of court",
  "Client",
  "Co-counsel",
  "Court reporter",
  "Deponent",
  "Expert witness",
  "Guardian ad litem",
  "Interpreter",
  "Judge",
  "Mediator",
  "Observer",
  "Opposing counsel",
  "Paralegal",
  "Process server",
  "Videographer",
  "Witness",
];

/**
 * What a typed role settles to. A role matching an offered spelling in ANY casing settles to the
 * offered spelling, which is the whole of the drift this control exists to stop: a free-text box
 * gave one firm "Court reporter", "court reporter" and "Court Reporter" as three different roles,
 * and a reader narrowing to one of them saw a third of the events. Anything the list does not offer
 * is kept exactly as written, trimmed — the vocabulary is a suggestion, not a gate.
 */
export function settledParticipantRole(typed: string): string {
  const trimmed = typed.trim();
  const lowered = trimmed.toLowerCase();
  return PARTICIPANT_ROLE_OPTIONS.find((role) => role.toLowerCase() === lowered) ?? trimmed;
}
