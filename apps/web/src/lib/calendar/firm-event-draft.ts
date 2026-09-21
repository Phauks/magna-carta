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
  formatRecurrence,
  parseRecurrence,
  type RecurrenceRule,
} from "@magna-carta/civil-time/recurrence";
import { optionalText } from "./draft-text.ts";
import { shortfall, type Shortfall } from "./shortfall.ts";
import {
  conferenceShortfalls,
  EVENT_FIELDS,
  participantDraftFrom,
  participantInput,
  meetingInput,
  recurrenceChanged,
  timingShortfalls,
  type EventTimingDraft,
  type MeetingChoice,
  type MeetingLobbyChoice,
  type ParticipantDraft,
} from "./event-draft.ts";

export interface FirmEventDraft extends EventTimingDraft {
  title: string;
  eventTypeId: string | null;
  description: string;
  audience: FirmEventAudience;
  locationId: string | null;
  locationText: string;
  /** Where it is JOINED, where it is online. A firm meeting is as likely to be a call as a room. */
  conferenceUrl: string;
  /** The rule this meeting repeats on, or null for a one-off. A staff meeting usually has one. */
  recurrence: RecurrenceRule | null;
  participants: ParticipantDraft[];
  /** Whether this setting is also a meeting, and what kind. The same answer a matter event takes. */
  meeting: MeetingChoice;
  /** And whether that room opens with a door. The same answer, for the same reason. */
  meetingLobby: MeetingLobbyChoice;
}

export function emptyFirmEventDraft(
  timeZone: string,
  startsOn: string | null = null,
  meeting: MeetingChoice = "none",
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
    conferenceUrl: "",
    recurrence: null,
    participants: [],
    meeting,
    meetingLobby: "off",
  };
}

/** Every reason the firm event cannot be recorded yet. Empty means it can. */
export function firmEventDraftShortfalls(draft: FirmEventDraft): Shortfall[] {
  const shortfalls: Shortfall[] = [];
  if (draft.title.trim() === "") {
    shortfalls.push(shortfall(EVENT_FIELDS.title, "A title is needed."));
  }
  shortfalls.push(...timingShortfalls(draft));
  shortfalls.push(...conferenceShortfalls(draft.conferenceUrl));
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
    draft.conferenceUrl !== since.conferenceUrl ||
    draft.meeting !== since.meeting ||
    draft.meetingLobby !== since.meetingLobby ||
    recurrenceChanged(draft.recurrence, since.recurrence) ||
    draft.participants.length !== since.participants.length ||
    draft.participants.some((participant, index) => {
      const before = since.participants[index];
      return (
        before === undefined || before.key !== participant.key || before.role !== participant.role
      );
    })
  );
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
    conferenceUrl: optionalText(draft.conferenceUrl),
    recurrenceRule: draft.recurrence === null ? null : formatRecurrence(draft.recurrence),
    // An all-members event lists nobody: it is on every calendar by construction.
    participants: draft.audience === "all_members" ? [] : draft.participants.map(participantInput),
    meeting: meetingInput(draft.meeting, draft.meetingLobby),
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
    conferenceUrl: event.conferenceUrl ?? "",
    recurrence: parseRecurrence(event.recurrenceRule),
    participants: participants.map((participant) =>
      participantDraftFrom(participant, displayNames),
    ),
    // None, for the reason the matter event's draft gives: a correction never takes a meeting off
    // an event, so this answer can only ever add one.
    meeting: "none",
    meetingLobby: "off",
  };
}
