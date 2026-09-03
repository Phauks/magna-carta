/*
 * What a person types to record a firm event: the same timing an event shares, plus the one thing a
 * case event never needed, an audience. All members puts it on everyone's calendar with no list to
 * decay; participants puts it on the calendars of the people listed.
 *
 * The office is optional and so is the venue, because a firm event usually happens at one of the
 * firm's own offices (the office also says which rooms are nearby) and sometimes offsite.
 */
import type {
  CreateFirmEventRequest,
  EventParticipant,
  FirmEvent,
  FirmEventAudience,
} from "./calendar-api.ts";
import {
  participantDraftFrom,
  participantInput,
  timingShortfalls,
  type EventTimingDraft,
  type ParticipantDraft,
} from "./event-draft.ts";

export interface FirmEventDraft extends EventTimingDraft {
  title: string;
  eventTypeId: string | null;
  description: string;
  audience: FirmEventAudience;
  locationId: string | null;
  locationText: string;
  participants: ParticipantDraft[];
}

export function emptyFirmEventDraft(
  timeZone: string,
  startsOn: string | null = null,
): FirmEventDraft {
  return {
    title: "",
    eventTypeId: null,
    description: "",
    startsOn,
    startsAtTime: "",
    endsOn: null,
    endsAtTime: "",
    timeZone,
    audience: "participants",
    locationId: null,
    locationText: "",
    participants: [],
  };
}

/** Every reason the firm event cannot be recorded yet. Empty means it can. */
export function firmEventDraftShortfalls(draft: FirmEventDraft): string[] {
  const shortfalls: string[] = [];
  if (draft.title.trim() === "") shortfalls.push("A title is needed.");
  shortfalls.push(...timingShortfalls(draft));
  return shortfalls;
}

export function firmEventDraftReady(draft: FirmEventDraft): boolean {
  return firmEventDraftShortfalls(draft).length === 0;
}

export function firmEventDraftStarted(draft: FirmEventDraft, since: FirmEventDraft): boolean {
  return (
    draft.title !== since.title ||
    draft.eventTypeId !== since.eventTypeId ||
    draft.description !== since.description ||
    draft.startsOn !== since.startsOn ||
    draft.startsAtTime !== since.startsAtTime ||
    draft.endsOn !== since.endsOn ||
    draft.endsAtTime !== since.endsAtTime ||
    draft.timeZone !== since.timeZone ||
    draft.audience !== since.audience ||
    draft.locationId !== since.locationId ||
    draft.locationText !== since.locationText ||
    draft.participants.length !== since.participants.length ||
    draft.participants.some((participant, index) => {
      const before = since.participants[index];
      return (
        before === undefined || before.key !== participant.key || before.role !== participant.role
      );
    })
  );
}

function optionalText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The request a ready draft becomes. Call only when `firmEventDraftReady` is true. */
export function firmEventDraftRequest(draft: FirmEventDraft): CreateFirmEventRequest {
  return {
    title: draft.title.trim(),
    eventTypeId: draft.eventTypeId,
    description: optionalText(draft.description),
    startsOn: draft.startsOn ?? "",
    startsAtTime: optionalText(draft.startsAtTime),
    endsOn: draft.endsOn,
    endsAtTime: optionalText(draft.endsAtTime),
    timeZone: draft.timeZone,
    audience: draft.audience,
    locationId: draft.locationId,
    locationText: optionalText(draft.locationText),
    // An all-members event lists nobody: it is on every calendar by construction.
    participants: draft.audience === "all_members" ? [] : draft.participants.map(participantInput),
  };
}

/** A recorded firm event as a draft, for editing it in place. */
export function firmEventDraftFrom(
  event: FirmEvent,
  participants: readonly EventParticipant[],
  displayNames: ReadonlyMap<string, string> = new Map(),
): FirmEventDraft {
  return {
    title: event.title,
    eventTypeId: event.eventTypeId,
    description: event.description ?? "",
    startsOn: event.startsOn,
    startsAtTime: event.startsAtTime ?? "",
    endsOn: event.endsOn,
    endsAtTime: event.endsAtTime ?? "",
    timeZone: event.timeZone,
    audience: event.audience,
    locationId: event.locationId,
    locationText: event.locationText ?? "",
    participants: participants.map((participant) =>
      participantDraftFrom(participant, displayNames),
    ),
  };
}
