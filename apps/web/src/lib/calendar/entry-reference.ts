/*
 * Which record a calendar entry points at, and the record once it has been read.
 *
 * Three kinds open in the one entry window, and each is reached two ways: from a chip on the grid,
 * which already knows what it painted, and from an address (`?entry=matterEvent_…`), which carries
 * only the identifier. The identifier's prefix is the kind, so a reference can be read off either
 * door without a lookup — the record identifiers are typed at the source (`matterEvent_`,
 * `matterDeadline_`, `firmEvent_`) and this module leans on that rather than restating it.
 *
 * A DEADLINE HAS NO READ OF ITS OWN. The deadlines listing takes a matter and a window, so a
 * deadline can only be fetched by naming the matter it belongs to and the day it is due; a
 * reference to one therefore carries both where the surface already holds them (the chip on the
 * grid does) and neither where it does not (an address). The window reads what it can and says
 * plainly when it cannot.
 */
import type {
  CalendarDeadline,
  CalendarEvent,
  EventParticipant,
  FirmEvent,
} from "./calendar-api.ts";
import type { CalendarEntry } from "./calendar-entries.ts";

export type EntryReferenceKind = "event" | "deadline" | "firmEvent";

export interface EntryReference {
  readonly kind: EntryReferenceKind;
  /** The record's own identifier, prefix and all. */
  readonly recordId: string;
  /** The matter the record belongs to, where the surface knows it. A deadline is read through it. */
  readonly matterId?: string | null;
  /** The civil day the entry sits on, where the surface knows it. A deadline is read through it. */
  readonly date?: string;
  /**
   * Which day of its series the reference is, where the record repeats and a particular day of it
   * was pressed. The window shows that day and asks, on a change, whether it reaches only that day,
   * that day and every later one, or the whole series.
   */
  readonly occurrenceOn?: string;
}

/** The record a reference resolves to, once its own read has answered. */
export type EntryRecord =
  | {
      readonly kind: "event";
      readonly event: CalendarEvent;
      readonly participants: readonly EventParticipant[];
    }
  | { readonly kind: "deadline"; readonly deadline: CalendarDeadline }
  | {
      readonly kind: "firmEvent";
      readonly event: FirmEvent;
      readonly participants: readonly EventParticipant[];
    };

const KIND_BY_PREFIX: ReadonlyArray<readonly [prefix: string, kind: EntryReferenceKind]> = [
  ["matterEvent_", "event"],
  ["matterDeadline_", "deadline"],
  ["firmEvent_", "firmEvent"],
];

/** The kind an identifier's prefix declares, or null for an identifier this surface does not open. */
export function entryReferenceFromIdentifier(identifier: string | null): EntryReference | null {
  if (identifier === null) return null;
  for (const [prefix, kind] of KIND_BY_PREFIX) {
    if (identifier.startsWith(prefix) && identifier.length > prefix.length) {
      return { kind, recordId: identifier };
    }
  }
  return null;
}

/** The reference behind a painted entry, or null for a kind that opens nowhere here. */
export function entryReferenceOf(entry: CalendarEntry): EntryReference | null {
  if (entry.kind === "other") return null;
  return {
    kind: entry.kind,
    recordId: entry.recordId,
    matterId: entry.matterId,
    date: entry.date,
    occurrenceOn: entry.occurrenceOn,
  };
}

/** One key per reference, so a window can tell "the same record again" from "a different one". */
export function entryReferenceKey(reference: EntryReference): string {
  return [
    reference.kind,
    reference.recordId,
    reference.matterId ?? "",
    reference.date ?? "",
    reference.occurrenceOn ?? "",
  ].join("|");
}

/** The record's title, whichever kind it is. */
export function entryRecordTitle(record: EntryRecord): string {
  return record.kind === "deadline" ? record.deadline.title : record.event.title;
}

/** The civil day the record sits on. */
export function entryRecordDate(record: EntryRecord): string {
  return record.kind === "deadline" ? record.deadline.dueOn : record.event.startsOn;
}

/** The matter the record belongs to, or null for a firm event. */
export function entryRecordMatterId(record: EntryRecord): string | null {
  switch (record.kind) {
    case "event":
      return record.event.matterId;
    case "deadline":
      return record.deadline.matterId;
    case "firmEvent":
      return null;
  }
}

/**
 * The kind as the window's subtitle names it: the type's name where the record has one, else the
 * kind's own word. `firmEventTypeName` resolves a firm event's type through the catalog, because a
 * firm event carries the type's identifier and not its name.
 */
export function entryRecordKindLine(
  record: EntryRecord | null,
  fallbackKind: EntryReferenceKind,
  words: Readonly<Record<EntryReferenceKind, string>>,
  firmEventTypeName: (eventTypeId: string | null) => string | undefined,
): string {
  if (record === null) return words[fallbackKind];
  switch (record.kind) {
    case "event":
      return record.event.eventTypeName ?? words.event;
    case "deadline":
      return words.deadline;
    case "firmEvent":
      return firmEventTypeName(record.event.eventTypeId) ?? words.firmEvent;
  }
}
