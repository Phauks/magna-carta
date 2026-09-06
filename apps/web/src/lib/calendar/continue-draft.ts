/*
 * What a person types to continue a setting: the court moved it, so the new setting takes a new
 * date and, rarely, a new place. The draft is the fourth of the calendar's drafts and the same shape
 * of thing as the other three — a plain object, and every question about it a pure function — so
 * the Continue dialog renders the answers and decides none of them.
 *
 * THE DATE IS THE ONE THING LEFT BLANK. A continuance moves the date and rarely anything else, so
 * the new setting starts from the old one's zone, times, place and court reference, and the date
 * itself is left for the reader to state.
 */
import type { CalendarEvent, ContinueEventRequest } from "./calendar-api.ts";
import { optionalText } from "./draft-text.ts";
import { timingShortfalls, type EventTimingDraft } from "./event-draft.ts";

export interface ContinueDraft extends EventTimingDraft {
  locationText: string;
  courtReference: string;
  /** Why the old setting is not happening; optional. */
  statusReason: string;
}

export function emptyContinueDraft(): ContinueDraft {
  return {
    startsOn: null,
    startsAtTime: "",
    endsOn: null,
    endsAtTime: "",
    timeZone: "",
    locationText: "",
    courtReference: "",
    statusReason: "",
  };
}

/** The draft a continuance of this setting starts from: its zone, times, place and court, no date. */
export function continueDraftFrom(event: CalendarEvent): ContinueDraft {
  return {
    startsOn: null,
    startsAtTime: event.startsAtTime ?? "",
    endsOn: null,
    endsAtTime: event.endsAtTime ?? "",
    timeZone: event.timeZone,
    locationText: event.locationText ?? "",
    courtReference: event.courtReference ?? "",
    statusReason: "",
  };
}

/** Every reason the continuance cannot be recorded yet: the timing rules every event shares. */
export function continueDraftShortfalls(draft: ContinueDraft): string[] {
  return timingShortfalls(draft);
}

/** Whether anything has been entered beyond what the old setting supplied. */
export function continueDraftStarted(draft: ContinueDraft): boolean {
  return draft.startsOn !== null || draft.endsOn !== null || draft.statusReason !== "";
}

/** The request a ready draft becomes. Call only when there are no shortfalls. */
export function continueDraftRequest(draft: ContinueDraft): ContinueEventRequest {
  return {
    startsOn: draft.startsOn ?? "",
    startsAtTime: optionalText(draft.startsAtTime),
    endsOn: draft.endsOn,
    endsAtTime: optionalText(draft.endsAtTime),
    timeZone: draft.timeZone,
    locationText: optionalText(draft.locationText),
    courtReference: optionalText(draft.courtReference),
    statusReason: optionalText(draft.statusReason),
  };
}
