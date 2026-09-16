/*
 * Which of the window's entries a reader wants in front of them.
 *
 * NOT EVERY SETTING MATTERS AT ONCE. A firm's week holds hearings, depositions, filings, deadlines,
 * staff meetings and room reservations, and a person reading it is almost always reading it for one
 * of those (owner, 2026-09-16: "not every schedule matters, so users need to be able to filter to
 * what is important for the scheduling"). The rail already answers WHOSE calendar; this answers
 * WHAT KIND, which is the other half of the same question and the one nothing on the screen asked.
 *
 * IT NARROWS WHAT WAS READ, AND MAKES NO REQUEST. The window's entries are already in the browser,
 * so a narrowing answers as fast as it is pressed. That is deliberate and it is also the honest
 * limit: this reaches exactly as far as the window on screen, never the whole record, and the
 * control says so by living beside the window's own navigation rather than beside a search.
 *
 * A NARROWING IS NEVER A READ. Turning a calendar off in the rail stops a request; turning a KIND
 * off does not, because every kind arrives in the same reads. Keeping them apart is what stops a
 * reader from thinking they have made the screen cheaper when they have made it shorter — and it is
 * why this is a filter over `visibleEntries` rather than another arm of the read plan.
 *
 * EMPTY MEANS EVERYTHING. A narrowing nobody set shows the whole window, and a reader who turns off
 * every kind is shown the whole window rather than an empty grid: an empty answer to "show me
 * nothing" is technically right and useless, and the one thing a calendar must not do is look empty
 * when it is not.
 */
import type { CalendarEntry, CalendarEntryKind } from "./calendar-entries.ts";

/** What a reader can narrow the window to, and what each is called. */
export const SCHEDULE_KINDS: readonly { kind: CalendarEntryKind; label: string }[] = [
  { kind: "event", label: "Case settings" },
  { kind: "deadline", label: "Deadlines" },
  { kind: "firmEvent", label: "Firm events" },
  { kind: "other", label: "Dates" },
];

/** Whether anything is being held back — what a Clear control renders on, and nothing else. */
export function isNarrowed(kinds: ReadonlySet<CalendarEntryKind>): boolean {
  return kinds.size > 0 && kinds.size < SCHEDULE_KINDS.length;
}

/**
 * The entries a narrowing keeps.
 *
 * An empty set, or one holding every kind, is no narrowing at all and the window is returned
 * untouched — same object, so a grid that was not narrowed does no work for a control nobody used.
 */
export function narrowToKinds(
  entries: readonly CalendarEntry[],
  kinds: ReadonlySet<CalendarEntryKind>,
): readonly CalendarEntry[] {
  if (!isNarrowed(kinds)) return entries;
  return entries.filter((entry) => kinds.has(entry.kind));
}

/** Turn one kind on or off, as a new set. */
export function toggleKind(
  kinds: ReadonlySet<CalendarEntryKind>,
  kind: CalendarEntryKind,
): ReadonlySet<CalendarEntryKind> {
  // An untouched narrowing holds nothing and means everything, so the first press has to start from
  // "everything" and remove one — otherwise pressing Deadlines would hide the deadlines.
  const from = kinds.size === 0 ? new Set(SCHEDULE_KINDS.map((each) => each.kind)) : new Set(kinds);
  if (from.has(kind)) {
    from.delete(kind);
  } else {
    from.add(kind);
  }
  return from;
}

/** How many of the window's entries a narrowing is holding back, for the line that says so. */
export function heldBack(
  entries: readonly CalendarEntry[],
  kinds: ReadonlySet<CalendarEntryKind>,
): number {
  return entries.length - narrowToKinds(entries, kinds).length;
}
