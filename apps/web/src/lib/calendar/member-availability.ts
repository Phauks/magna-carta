/*
 * WHO IS ALREADY BUSY AT THE HOUR THE FORM IS PROPOSING.
 *
 * A member picking a time for a meeting is asking one question about each colleague they have put
 * on it, and until now the only answer on the screen was the day schedule beside the form — which
 * shows whichever calendars the reader happens to have on, and says nothing about the person they
 * just added to the Who tab.
 *
 * IT STATES AND IT NEVER REFUSES. Two things at once is routinely correct — a partner signs an
 * order at nine while an associate takes a deposition — and a scheduling form that would not let a
 * member book over a colleague is a form people stop using. This is the same posture the resource
 * booking takes ("lands even when it double-books, and says so in `conflicts`") and the same one
 * `schedule-conflicts.ts` already writes sentences for.
 *
 * WHAT IT PRINTS IS WHAT THE GRID PAINTS, WHICH IS NOT A TITLE. The federated read declares
 * non-privileged labels by contract: a matter event reads as its type ("Hearing"), and only a firm
 * event carries its own title, because a firm event has no matter to be privileged about. Printing
 * a matter event's title on somebody else's availability line would put one matter's content on
 * another matter's form, for a reader who may be entitled to neither — so the busy line is the
 * entry's own painted word and never more than that.
 *
 * IT COMPARES CIVIL DAYS AND WALL CLOCKS, never instants, exactly as the grid and the conflict
 * count do. Converting would move half the records to the day before for a reader two zones east.
 */
import { wallClockMinutes } from "@magna-carta/design-system/calendar-grid";
import type { CalendarEntry } from "./calendar-entries.ts";
import type { EventTimingDraft, ParticipantDraft } from "./event-draft.ts";
import { scheduleConflicts, type ProposedOccurrence } from "./schedule-conflicts.ts";

/** One colleague's answer: who they are, and what is already on their calendar at that hour. */
export interface MemberAvailability {
  readonly userId: string;
  readonly displayName: string;
  /**
   * What their calendar already holds at the proposed hour, in the words the grid paints. Empty
   * means nothing is there — which is a different fact from not having read yet.
   */
  readonly busy: readonly string[];
  /** Whether their calendar has been read. Nothing is claimed about a member nobody asked about. */
  readonly read: boolean;
}

/** The colleagues on a draft, in the order they were added; nobody else is asked about. */
export function memberParticipantsOf(
  participants: readonly ParticipantDraft[],
): readonly { userId: string; displayName: string }[] {
  const seen = new Set<string>();
  return participants.flatMap((participant) => {
    const userId = participant.memberUserId;
    if (participant.participantKind !== "member" || userId === null || seen.has(userId)) return [];
    seen.add(userId);
    return [{ userId, displayName: participant.displayName }];
  });
}

/**
 * The hour the form is proposing, as the one occurrence a colleague is asked about.
 *
 * ONE DAY, NOT A SERIES. A repeating setting's collisions are the whole-series count
 * `schedule-conflicts.ts` already states above the commit; this answers "is this person free when
 * we are starting", which is what somebody scheduling a meeting is looking at. Null until a day has
 * been chosen, because there is nothing to ask about yet.
 */
export function proposedOccurrenceOf(draft: EventTimingDraft): ProposedOccurrence | null {
  if (draft.startsOn === null) return null;
  const startMinute = draft.startsAtTime === "" ? undefined : minutesOf(draft.startsAtTime);
  const endMinute = draft.endsAtTime === "" ? undefined : minutesOf(draft.endsAtTime);
  return { date: draft.startsOn, startMinute, endMinute };
}

/**
 * What one colleague's entries say about the proposed hour.
 *
 * Deduplicated by the word rather than by the record: the same hearing reaching this list twice —
 * once as theirs, once as the firm's — is one thing they are doing, and printing "Hearing, Hearing"
 * reads as two.
 */
export function busyLabels(
  entries: readonly CalendarEntry[],
  occurrence: ProposedOccurrence,
): readonly string[] {
  const conflicts = scheduleConflicts([occurrence], entries);
  return [...new Set(conflicts.map((conflict) => conflict.entry.label))];
}

/**
 * The line beside a colleague's name.
 *
 * It says "Busy" and then what with, never a bare count: a number alone is an alarm rather than an
 * answer, and the thing a person scheduling wants to know is whether the clash is a hearing or a
 * lunch. A member nobody has read for says nothing at all rather than "free", because claiming
 * somebody is available on a read that has not come back is the one wrong answer here.
 */
export function availabilitySentence(availability: MemberAvailability): string | null {
  if (!availability.read) return null;
  if (availability.busy.length === 0) return "Free";
  return `Busy: ${availability.busy.join(", ")}`;
}

function minutesOf(time: string): number | undefined {
  return wallClockMinutes(time) ?? undefined;
}
