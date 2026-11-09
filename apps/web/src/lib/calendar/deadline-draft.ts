/*
 * What a person types to record a deadline, and whether it is ready.
 *
 * A deadline is a different record from an event because two things are true of it that are not
 * true of a hearing: it can be satisfied, and it came from somewhere. So the form asks for the
 * authority in the person's own words (the rule, the statute, the order) and never parses it, and
 * it lets the event that started the clock be linked, as a link and never as an input to any
 * calculation — moving that event does not move the deadline.
 *
 * THREE ANSWERS ARE REQUIRED: a title, a date, and a zone. A time is optional and load-bearing: many
 * filing deadlines are five in the afternoon, and one whose hour nobody wrote down is due at the
 * end of its day, never at midnight.
 *
 * A HALF-TYPED TIME IS NOT AN EMPTY ONE. The field is the platform's time control, which can only
 * hold a time of day, but a control holding "5:" reports the same empty value as one nobody touched.
 * Read alone, that empty value would record a five-in-the-afternoon filing as due at the end of the
 * day. So the form tells the draft when the control holds something it cannot read
 * (`timeEntryUnfinished`), and that is a shortfall in its own words rather than a silent blank.
 */
import type { CalendarDeadline, CreateDeadlineRequest, DeadlineSource } from "./calendar-api.ts";
import { isCivilDate } from "./calendar-window.ts";
import { shortfall, type Shortfall } from "./shortfall.ts";
import { isWallClockTime, optionalText } from "./draft-text.ts";
import { isResolvableTimeZone } from "./time-zone-options.ts";

/** The priority scale the record takes: 1 is the most urgent, 9 the least. */
export const DEADLINE_PRIORITY_MAX = 9;

export interface DeadlineDraft {
  title: string;
  dueOn: string | null;
  /** HH:MM, or empty for the end of the day. */
  dueAtTime: string;
  timeZone: string;
  source: DeadlineSource;
  authorityText: string;
  triggerEventId: string | null;
  /** Empty for none; otherwise the digit as typed. */
  priority: string;
}

export function emptyDeadlineDraft(timeZone: string, dueOn: string | null = null): DeadlineDraft {
  return {
    title: "",
    dueOn,
    dueAtTime: "",
    timeZone,
    source: "member",
    authorityText: "",
    triggerEventId: null,
    priority: "",
  };
}

/**
 * Where a deadline came from, as its Source field reads: the short names the owner chose
 * (2026-11-09). The stored values are unchanged; only the words a person reads are these.
 */
const SOURCE_LABELS: Record<DeadlineSource, string> = {
  court_order: "Court Order",
  member: "Firm",
};

export function deadlineSourceLabel(source: DeadlineSource): string {
  return SOURCE_LABELS[source];
}

/** The fields a deadline draft asks about, as a shortfall names them. */
export const DEADLINE_FIELDS = {
  title: "title",
  dueOn: "dueOn",
  dueAtTime: "dueAtTime",
  timeZone: "timeZone",
  priority: "priority",
} as const;

/** What the form knows about its controls that the typed values alone cannot say. */
export interface DeadlineEntryState {
  /** The time control holds a partial entry, so its empty value is not "no time". */
  readonly timeEntryUnfinished?: boolean;
}

/** Every reason the deadline cannot be recorded yet. Empty means it can. */
export function deadlineDraftShortfalls(
  draft: DeadlineDraft,
  entry: DeadlineEntryState = {},
): Shortfall[] {
  const shortfalls: Shortfall[] = [];
  if (draft.title.trim() === "") {
    shortfalls.push(shortfall(DEADLINE_FIELDS.title, "A title is needed."));
  }
  if (draft.dueOn === null || !isCivilDate(draft.dueOn)) {
    shortfalls.push(shortfall(DEADLINE_FIELDS.dueOn, "A due date is needed."));
  }
  const dueAtTime = draft.dueAtTime.trim();
  if (dueAtTime === "" && entry.timeEntryUnfinished === true) {
    shortfalls.push(
      shortfall(
        DEADLINE_FIELDS.dueAtTime,
        "The time is not finished: give the hour and the minute, or clear it for the end of the day.",
      ),
    );
  } else if (dueAtTime !== "" && !isWallClockTime(dueAtTime)) {
    shortfalls.push(
      shortfall(DEADLINE_FIELDS.dueAtTime, "The time does not read as a time of day."),
    );
  }
  if (draft.timeZone.trim() === "") {
    shortfalls.push(
      shortfall(
        DEADLINE_FIELDS.timeZone,
        "A time zone is needed: the one the deadline is measured in.",
      ),
    );
  } else if (!isResolvableTimeZone(draft.timeZone)) {
    shortfalls.push(
      shortfall(DEADLINE_FIELDS.timeZone, "The time zone is not one a date can be read in."),
    );
  }
  if (draft.priority !== "") {
    const priority = Number(draft.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > DEADLINE_PRIORITY_MAX) {
      shortfalls.push(
        shortfall(
          DEADLINE_FIELDS.priority,
          `Priority is a whole number from 1 to ${String(DEADLINE_PRIORITY_MAX)}.`,
        ),
      );
    }
  }
  return shortfalls;
}

export function deadlineDraftReady(draft: DeadlineDraft, entry: DeadlineEntryState = {}): boolean {
  return deadlineDraftShortfalls(draft, entry).length === 0;
}

export function deadlineDraftStarted(draft: DeadlineDraft, since: DeadlineDraft): boolean {
  return (
    draft.title !== since.title ||
    draft.dueOn !== since.dueOn ||
    draft.dueAtTime !== since.dueAtTime ||
    draft.timeZone !== since.timeZone ||
    draft.source !== since.source ||
    draft.authorityText !== since.authorityText ||
    draft.triggerEventId !== since.triggerEventId ||
    draft.priority !== since.priority
  );
}

/** The request a ready draft becomes. Call only when `deadlineDraftReady` is true. */
export function deadlineDraftRequest(draft: DeadlineDraft): CreateDeadlineRequest {
  return {
    title: draft.title.trim(),
    dueOn: draft.dueOn ?? "",
    dueAtTime: optionalText(draft.dueAtTime),
    timeZone: draft.timeZone,
    source: draft.source,
    authorityText: optionalText(draft.authorityText),
    triggerEventId: draft.triggerEventId,
    priority: draft.priority === "" ? null : Number(draft.priority),
  };
}

/** A recorded deadline as a draft, for editing it in place. The source is frozen on the record. */
export function deadlineDraftFrom(deadline: CalendarDeadline): DeadlineDraft {
  return {
    title: deadline.title,
    dueOn: deadline.dueOn,
    dueAtTime: deadline.dueAtTime ?? "",
    timeZone: deadline.timeZone,
    source: deadline.source === "court_order" ? "court_order" : "member",
    authorityText: deadline.authorityText ?? "",
    triggerEventId: deadline.triggerEventId,
    priority: deadline.priority === null ? "" : String(deadline.priority),
  };
}
