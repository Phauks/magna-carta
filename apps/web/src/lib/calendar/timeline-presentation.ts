/*
 * How a row of the matter's federated timeline reads on the matter's Timeline view.
 *
 * The read carries a source key, a kind word, a sort key (a canonical instant), a declared
 * non-privileged label or none, an actor and a deep link. This module turns those into the words
 * a row shows: the kind as a person reads it (through the calendar's one vocabulary, so a due-back
 * on the timeline is the same word as a due-back on the calendar), the day it happened on, and
 * what the label is for. It decides nothing about privilege: a source that declared no label has
 * none here, and the row reads by kind alone.
 */
import type { TimelineEntry } from "./calendar-api.ts";
import { CALENDAR_LAYERS, humanizeKind } from "./calendar-vocabulary.ts";

/** The words every source key's rows lead with, where the kind alone would not say enough. */
const SOURCE_WORDS: Readonly<Record<string, string>> = {
  matterEvent: "Event",
  matterDeadline: "Deadline",
  firmEvent: "Firm event",
  emailFiled: "Email filed",
  documentAssembly: "Document assembled",
  documentFiled: "Document filed",
  matterNote: "Note",
  timeEntry: "Time recorded",
  costEntry: "Cost recorded",
  conflictsCheck: "Conflicts check",
  matterLifecycle: "Matter",
  custodyMovement: "Custody",
  custodyReviewDue: "Custody review",
  custodyDueBack: "Custody",
  trustMovement: "Trust",
};

const KIND_WORDS: Readonly<Record<string, string>> = {
  event: "Event",
  cancelledEvent: "Event cancelled",
  deadline: "Deadline",
  firmEvent: "Firm event",
};

export interface TimelineRowPresentation {
  /** The row's own identity for a render key: the source and its row. */
  readonly key: string;
  /** The civil day the sort key falls on, as `YYYY-MM-DD`. */
  readonly date: string;
  /** What kind of thing it is, in a person's words. */
  readonly kind: string;
  /** The source's declared label, where it declared one; null reads by kind alone. */
  readonly label: string | null;
  /** The record's own home. */
  readonly link: string;
  readonly actorUserId: string | null;
}

/**
 * The kind word for a row: the kind's own word where one is known, then the word a calendar layer
 * gives the kind (so a due-back reads the same here as on the calendar), then its source's word,
 * and last its humanized key.
 */
export function timelineKindWord(entry: Pick<TimelineEntry, "sourceKey" | "kind">): string {
  const layered = CALENDAR_LAYERS.map((layer) => layer.kindLabels[entry.kind]).find(
    (label) => label !== undefined,
  );
  return (
    KIND_WORDS[entry.kind] ?? layered ?? SOURCE_WORDS[entry.sourceKey] ?? humanizeKind(entry.kind)
  );
}

export function presentTimelineRow(entry: TimelineEntry): TimelineRowPresentation {
  return {
    key: `${entry.sourceKey}:${entry.rowId}`,
    date: entry.sortKey.slice(0, 10),
    kind: timelineKindWord(entry),
    label: entry.label,
    link: entry.link,
    actorUserId: entry.actorUserId,
  };
}

/**
 * Rows grouped by the civil day they fall on, in the order handed over (newest first from the read).
 * A day heading per group is what makes a long history scannable.
 */
export function groupTimelineByDay(
  rows: readonly TimelineRowPresentation[],
): ReadonlyArray<{ date: string; rows: readonly TimelineRowPresentation[] }> {
  const groups: { date: string; rows: TimelineRowPresentation[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.date === row.date) {
      last.rows.push(row);
    } else {
      groups.push({ date: row.date, rows: [row] });
    }
  }
  return groups;
}
