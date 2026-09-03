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
 */
import type { CalendarDeadline, CreateDeadlineRequest, DeadlineSource } from "./calendar-api.ts";
import { isCivilDate } from "./calendar-window.ts";
import { isResolvableTimeZone } from "./time-zone-options.ts";

const WALL_CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
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

const SOURCE_LABELS: Record<DeadlineSource, string> = {
  member: "Recorded by the firm",
  court_order: "Set by a court order",
};

export function deadlineSourceLabel(source: DeadlineSource): string {
  return SOURCE_LABELS[source];
}

/** Every reason the deadline cannot be recorded yet. Empty means it can. */
export function deadlineDraftShortfalls(draft: DeadlineDraft): string[] {
  const shortfalls: string[] = [];
  if (draft.title.trim() === "") shortfalls.push("A title is needed.");
  if (draft.dueOn === null || !isCivilDate(draft.dueOn)) shortfalls.push("A due date is needed.");
  if (draft.dueAtTime !== "" && !WALL_CLOCK_TIME.test(draft.dueAtTime)) {
    shortfalls.push("The time does not read as a time of day.");
  }
  if (draft.timeZone.trim() === "") {
    shortfalls.push("A time zone is needed: the one the deadline is measured in.");
  } else if (!isResolvableTimeZone(draft.timeZone)) {
    shortfalls.push("The time zone is not one a date can be read in.");
  }
  if (draft.priority !== "") {
    const priority = Number(draft.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > DEADLINE_PRIORITY_MAX) {
      shortfalls.push(`Priority is a whole number from 1 to ${String(DEADLINE_PRIORITY_MAX)}.`);
    }
  }
  return shortfalls;
}

export function deadlineDraftReady(draft: DeadlineDraft): boolean {
  return deadlineDraftShortfalls(draft).length === 0;
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

function optionalText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
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
