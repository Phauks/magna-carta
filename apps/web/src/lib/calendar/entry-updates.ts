/*
 * What a correction sends. The record forms send everything; the entry window's Edit sends the
 * fields its pane edits and nothing else, so a deadline's source stays frozen on the record and a
 * window that did not touch who is at a setting cannot change it.
 *
 * Each projection takes the full create request the draft already builds and keeps only the keys
 * the update contract carries. Held here as pure functions so the rules are asserted without a
 * browser.
 *
 * PARTICIPANTS ARE SENT ONLY WHERE THEY WERE EDITED. They used to be dropped unconditionally, which
 * made the invariant easy to state and made it impossible to add somebody to a setting already
 * recorded — the owner hit exactly that (2026-09-14: "in the modal it doesn't allow me to set new
 * participants"). The contract has always taken them: supplying the list replaces it, omitting it
 * leaves it alone. So the rule becomes conditional rather than absolute, and the half that mattered
 * survives intact: a correction that did not touch the participants still sends none, and the
 * caller must SAY it touched them rather than the projection guessing from a comparison it cannot
 * make honestly (the list carries local keys and display names the server never sent).
 */
import type {
  CreateDeadlineRequest,
  CreateEventRequest,
  CreateFirmEventRequest,
  UpdateDeadlineRequest,
  UpdateEventRequest,
  UpdateFirmEventRequest,
} from "./calendar-api.ts";

/** What a correction says about the people at a setting: nothing, or the whole list. */
export interface ParticipantIntent {
  /**
   * Whether the window's participant pane was edited. False — the default — omits participants
   * entirely, which is what leaves the recorded list alone.
   */
  readonly edited: boolean;
}

/** A correction that did not touch who is there, which is most of them. */
export const PARTICIPANTS_UNTOUCHED: ParticipantIntent = { edited: false };

export function eventUpdateOf(
  request: CreateEventRequest,
  participants: ParticipantIntent = PARTICIPANTS_UNTOUCHED,
): UpdateEventRequest {
  return {
    eventTypeId: request.eventTypeId,
    title: request.title,
    description: request.description,
    startsOn: request.startsOn,
    startsAtTime: request.startsAtTime,
    endsOn: request.endsOn,
    endsAtTime: request.endsAtTime,
    timeZone: request.timeZone,
    locationText: request.locationText,
    conferenceUrl: request.conferenceUrl,
    courtReference: request.courtReference,
    ...(participants.edited ? { participants: request.participants } : {}),
  };
}

export function deadlineUpdateOf(request: CreateDeadlineRequest): UpdateDeadlineRequest {
  return {
    title: request.title,
    dueOn: request.dueOn,
    dueAtTime: request.dueAtTime,
    timeZone: request.timeZone,
    authorityText: request.authorityText,
    triggerEventId: request.triggerEventId,
    priority: request.priority,
  };
}

export function firmEventUpdateOf(
  request: CreateFirmEventRequest,
  participants: ParticipantIntent = PARTICIPANTS_UNTOUCHED,
): UpdateFirmEventRequest {
  return {
    eventTypeId: request.eventTypeId,
    title: request.title,
    description: request.description,
    startsOn: request.startsOn,
    startsAtTime: request.startsAtTime,
    endsOn: request.endsOn,
    endsAtTime: request.endsAtTime,
    timeZone: request.timeZone,
    locationId: request.locationId,
    locationText: request.locationText,
    conferenceUrl: request.conferenceUrl,
    ...(participants.edited ? { participants: request.participants } : {}),
  };
}
