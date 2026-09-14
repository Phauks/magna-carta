/*
 * What a person types to record a setting, and whether it is ready to be recorded.
 *
 * The draft is a plain object and every question about it is a pure function — which answers are
 * still missing, whether anything has been entered, and what the request looks like — so the
 * refusal a form shows beside its commit is asserted without a browser, and the matter-event form
 * and the firm-event form share one set of rules for dates, times and zones rather than two that
 * drift.
 *
 * THREE ANSWERS ARE REQUIRED. A title, a date, and the zone the event happens in. Everything else
 * is optional, and the optional parts are refused only where they contradict each other: an end
 * before a start, an end time on a point event, a time that does not read as a clock.
 */
import type {
  CalendarEvent,
  CreateEventRequest,
  EventParticipant,
  ParticipantInput,
  ParticipantKind,
} from "./calendar-api.ts";
import { isCivilDate } from "./calendar-window.ts";
import { isWallClockTime, optionalText } from "./draft-text.ts";
import { isResolvableTimeZone } from "./time-zone-options.ts";

/** One person on the draft, with the name the form shows beside the handle it will send. */
export interface ParticipantDraft {
  /** A key for the chip's render and removal; the record's own id once one exists. */
  readonly key: string;
  readonly participantKind: ParticipantKind;
  readonly memberUserId: string | null;
  readonly entityId: string | null;
  readonly participantName: string | null;
  /** What the chip reads: the member's or the entity's display name, or the external name. */
  readonly displayName: string;
  readonly role: string;
}

/** The dates, times and zone every kind of event shares. */
export interface EventTimingDraft {
  startsOn: string | null;
  /** HH:MM, or empty for all day. */
  startsAtTime: string;
  endsOn: string | null;
  endsAtTime: string;
  timeZone: string;
}

export interface EventDraft extends EventTimingDraft {
  title: string;
  eventTypeId: string | null;
  description: string;
  /** Where it is HELD: an office, a room, a courthouse. Free text, offered from what the firm has. */
  locationText: string;
  /** Where it is JOINED, where it is online. A different question, so a different field. */
  conferenceUrl: string;
  courtReference: string;
  participants: ParticipantDraft[];
}

export function emptyEventDraft(timeZone: string, startsOn: string | null = null): EventDraft {
  return {
    title: "",
    eventTypeId: null,
    description: "",
    startsOn,
    startsAtTime: "",
    endsOn: null,
    endsAtTime: "",
    timeZone,
    locationText: "",
    conferenceUrl: "",
    courtReference: "",
    participants: [],
  };
}

/** The shortfalls in the timing every event shares, in the order a person meets them. */
export function timingShortfalls(draft: EventTimingDraft): string[] {
  const shortfalls: string[] = [];
  if (draft.startsOn === null || !isCivilDate(draft.startsOn)) {
    shortfalls.push("A date is needed.");
  }
  if (draft.startsAtTime !== "" && !isWallClockTime(draft.startsAtTime)) {
    shortfalls.push("The start time does not read as a time of day.");
  }
  if (draft.endsOn !== null && !isCivilDate(draft.endsOn)) {
    shortfalls.push("The end date does not read as a date.");
  } else if (draft.endsOn !== null && draft.startsOn !== null && draft.endsOn < draft.startsOn) {
    shortfalls.push("The end date is before the start.");
  }
  if (draft.endsAtTime !== "" && !isWallClockTime(draft.endsAtTime)) {
    shortfalls.push("The end time does not read as a time of day.");
  } else if (
    draft.endsAtTime !== "" &&
    draft.startsAtTime !== "" &&
    (draft.endsOn === null || draft.endsOn === draft.startsOn) &&
    draft.endsAtTime <= draft.startsAtTime
  ) {
    shortfalls.push("The end time is not after the start time.");
  }
  if (draft.timeZone.trim() === "") {
    shortfalls.push("A time zone is needed: the one the event happens in.");
  } else if (!isResolvableTimeZone(draft.timeZone)) {
    shortfalls.push("The time zone is not one a date can be read in.");
  }
  return shortfalls;
}

/** Every reason the event cannot be recorded yet. Empty means it can. */
export function eventDraftShortfalls(draft: EventDraft): string[] {
  const shortfalls: string[] = [];
  if (draft.title.trim() === "") shortfalls.push("A title is needed.");
  shortfalls.push(...timingShortfalls(draft));
  shortfalls.push(...conferenceShortfalls(draft.conferenceUrl));
  return shortfalls;
}

/**
 * Whether a typed conference link is one a person could actually follow.
 *
 * Refused rather than stored, because a link that does not open is worse than no link at all: the
 * one moment it is read is the moment somebody is late for the meeting. The check is the platform's
 * own URL parse and a scheme test — `javascript:` and `data:` are not places to join a meeting, and
 * a field that accepted them would be a link a surface then had to be careful about rendering.
 */
export function conferenceShortfalls(conferenceUrl: string): string[] {
  const trimmed = conferenceUrl.trim();
  if (trimmed === "") return [];
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return ["The conference link does not read as a web address."];
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return ["The conference link has to be a web address."];
  }
  return [];
}

export function eventDraftReady(draft: EventDraft): boolean {
  return eventDraftShortfalls(draft).length === 0;
}

/** Whether anything has been entered. A blank form has nothing to lose, so leaving never asks. */
export function eventDraftStarted(draft: EventDraft, since: EventDraft): boolean {
  return (
    draft.title !== since.title ||
    draft.eventTypeId !== since.eventTypeId ||
    draft.description !== since.description ||
    draft.startsOn !== since.startsOn ||
    draft.startsAtTime !== since.startsAtTime ||
    draft.endsOn !== since.endsOn ||
    draft.endsAtTime !== since.endsAtTime ||
    draft.timeZone !== since.timeZone ||
    draft.locationText !== since.locationText ||
    draft.conferenceUrl !== since.conferenceUrl ||
    draft.courtReference !== since.courtReference ||
    draft.participants.length !== since.participants.length ||
    draft.participants.some((participant, index) => {
      const before = since.participants[index];
      return (
        before === undefined || before.key !== participant.key || before.role !== participant.role
      );
    })
  );
}

export function participantInput(participant: ParticipantDraft): ParticipantInput {
  return {
    participantKind: participant.participantKind,
    memberUserId: participant.memberUserId,
    entityId: participant.entityId,
    participantName: participant.participantName,
    role: optionalText(participant.role),
  };
}

/** The request a ready draft becomes. Call only when `eventDraftReady` is true. */
export function eventDraftRequest(draft: EventDraft): CreateEventRequest {
  return {
    title: draft.title.trim(),
    eventTypeId: draft.eventTypeId,
    description: optionalText(draft.description),
    startsOn: draft.startsOn ?? "",
    startsAtTime: optionalText(draft.startsAtTime),
    endsOn: draft.endsOn,
    endsAtTime: optionalText(draft.endsAtTime),
    timeZone: draft.timeZone,
    locationText: optionalText(draft.locationText),
    conferenceUrl: optionalText(draft.conferenceUrl),
    courtReference: optionalText(draft.courtReference),
    participants: draft.participants.map(participantInput),
  };
}

/** A recorded event as a draft, for editing it in place. */
export function eventDraftFrom(
  event: CalendarEvent,
  participants: readonly EventParticipant[],
  displayNames: ReadonlyMap<string, string> = new Map(),
): EventDraft {
  return {
    title: event.title,
    eventTypeId: event.eventTypeId,
    description: event.description ?? "",
    startsOn: event.startsOn,
    startsAtTime: event.startsAtTime ?? "",
    endsOn: event.endsOn,
    endsAtTime: event.endsAtTime ?? "",
    timeZone: event.timeZone,
    locationText: event.locationText ?? "",
    conferenceUrl: event.conferenceUrl ?? "",
    courtReference: event.courtReference ?? "",
    participants: participants.map((participant) =>
      participantDraftFrom(participant, displayNames),
    ),
  };
}

/** A recorded participant as a draft chip. The name is resolved by the caller where it is a handle. */
export function participantDraftFrom(
  participant: EventParticipant,
  displayNames: ReadonlyMap<string, string>,
): ParticipantDraft {
  const handle = participant.memberUserId ?? participant.entityId;
  const displayName =
    participant.participantName ?? (handle === null ? "" : (displayNames.get(handle) ?? handle));
  return {
    key: participant.id,
    participantKind: participant.participantKind,
    memberUserId: participant.memberUserId,
    entityId: participant.entityId,
    participantName: participant.participantName,
    displayName,
    role: participant.role ?? "",
  };
}

/** A firm member as a participant chip. */
export function memberParticipant(userId: string, displayName: string): ParticipantDraft {
  return {
    key: `member:${userId}`,
    participantKind: "member",
    memberUserId: userId,
    entityId: null,
    participantName: null,
    displayName,
    role: "",
  };
}

/** A directory entity as a participant chip. */
export function entityParticipant(entityId: string, displayName: string): ParticipantDraft {
  return {
    key: `entity:${entityId}`,
    participantKind: "entity",
    memberUserId: null,
    entityId,
    participantName: null,
    displayName,
    role: "",
  };
}

/** Somebody who is neither — a judge, a court reporter — named once and never made a record. */
export function externalParticipant(name: string): ParticipantDraft {
  const trimmed = name.trim();
  return {
    key: `external:${trimmed.toLowerCase()}`,
    participantKind: "external",
    memberUserId: null,
    entityId: null,
    participantName: trimmed,
    displayName: trimmed,
    role: "",
  };
}
