/*
 * What a repeating task says about itself: the rule as a sentence, and when its next copy is due and
 * appears. The server makes the copy (packages/tasks/src/recurrence-service.ts); this reads the same
 * rule the same way, through @magna-carta/civil-time, so the window never promises a date the
 * server would not use.
 */
import { addCalendarDays } from "@magna-carta/civil-time/civil-date";
import {
  MAX_INTERVAL,
  movedLikeOccurrence,
  occurrencesOf,
  parseRecurrence,
  type RecurrenceRule,
} from "@magna-carta/civil-time/recurrence";
import { formatDate } from "@magna-carta/design-system/data-table";
import type { TaskRecurrenceMode } from "./tasks-api.ts";

// How far ahead the next day is looked for: past a rule every fifty-two years, as the server looks.
const LOOK_AHEAD_DAYS = 366 * MAX_INTERVAL + 62;

/** The next copy's due date and start date, or null where the series ends with this copy. */
export function nextCopyDates(
  rule: RecurrenceRule,
  occurrenceOn: string,
  dueOn: string | null,
  startsOn: string | null,
): { dueOn: string; startsOn: string | null } | null {
  const following = occurrencesOf(rule, occurrenceOn, {
    from: addCalendarDays(occurrenceOn, 1),
    to: addCalendarDays(occurrenceOn, LOOK_AHEAD_DAYS),
  })[0];
  if (following === undefined) return null;
  return {
    dueOn: following,
    startsOn:
      startsOn === null ? null : movedLikeOccurrence(startsOn, dueOn ?? occurrenceOn, following),
  };
}

/** The line under the Repeat answer: when the next one is due, and when it will appear. */
export function nextCopySentence(
  rule: RecurrenceRule,
  mode: TaskRecurrenceMode,
  occurrenceOn: string,
  dueOn: string | null,
  startsOn: string | null,
): string {
  const next = nextCopyDates(rule, occurrenceOn, dueOn, startsOn);
  if (next === null) return "This is the last one.";
  const due = `Next due ${formatDate(next.dueOn)}`;
  return mode === "completed"
    ? `${due}, made when this one is marked complete.`
    : `${due}, appears on ${formatDate(next.startsOn ?? next.dueOn)} whether or not this one is done.`;
}

/** The rule a stored line describes, or null where it does not repeat or cannot be shown. */
export function storedRule(line: string | null | undefined): RecurrenceRule | null {
  return line === null || line === undefined ? null : parseRecurrence(line);
}
