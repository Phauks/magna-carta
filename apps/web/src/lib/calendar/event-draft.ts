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
  EventMeetingInput,
  EventParticipant,
  ParticipantInput,
  ParticipantKind,
} from "./calendar-api.ts";
import {
  formatRecurrence,
  parseRecurrence,
  type RecurrenceRule,
} from "@magna-carta/civil-time/recurrence";
import { isCivilDate } from "./calendar-window.ts";
import { shortfall, type Shortfall } from "./shortfall.ts";
import { isWallClockTime, optionalText } from "./draft-text.ts";
import { isResolvableTimeZone } from "./time-zone-options.ts";
import { PARTICIPANT_KIND_WORDS } from "./calendar-vocabulary.ts";

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

/**
 * WHETHER THE SETTING IS ALSO A MEETING, and what kind. Scheduling a meeting here is recording an
 * event with a medium on it — there is no second form and no second record — so this is one more
 * answer on the form somebody was filling in anyway, and the entry window offers Join from the
 * moment the event exists.
 *
 * `none` is the answer for almost every event: a hearing happens in a courtroom.
 */
export type MeetingChoice = "none" | "video" | "audio";

export const MEETING_CHOICE_OPTIONS: readonly { value: MeetingChoice; label: string }[] = [
  { value: "none", label: "None" },
  { value: "video", label: "Video meeting" },
  { value: "audio", label: "Audio call" },
];

export function isMeetingChoice(value: string): value is MeetingChoice {
  return MEETING_CHOICE_OPTIONS.some((option) => option.value === value);
}

/**
 * What the form says under the choice, once one is made.
 *
 * It states the limit of what this does in the words a member needs, because the alternative is
 * discovering it from a client who never arrived: only colleagues are invited, and a client or
 * another party from the Directory has no way in yet.
 */
export const MEETING_GUESTS_SENTENCE =
  "Everyone at the firm on this event is invited. A client or another party from the Directory is " +
  "not sent a way in yet.";

/** The meeting an event draft sends, or null where it carries none. */
export function meetingInput(choice: MeetingChoice): EventMeetingInput | null {
  return choice === "none" ? null : { medium: choice };
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
  /**
   * The rule this setting repeats on, or null for a one-off. Held as the ANSWER rather than the
   * stored line so the form edits a structure and the line is written once, at the send.
   */
  recurrence: RecurrenceRule | null;
  participants: ParticipantDraft[];
  /** Whether this setting is also a meeting, and what kind. */
  meeting: MeetingChoice;
}

export function emptyEventDraft(
  timeZone: string,
  startsOn: string | null = null,
  meeting: MeetingChoice = "none",
): EventDraft {
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
    recurrence: null,
    participants: [],
    meeting,
  };
}

/**
 * The fields the shared timing asks about, as a shortfall names them.
 *
 * They are the SUFFIXES the record forms mint their ids from, so a form marks the control a
 * shortfall names without a second table mapping one to the other.
 */
export const TIMING_FIELDS = {
  startsOn: "startsOn",
  startsAtTime: "startsAtTime",
  endsOn: "endsOn",
  endsAtTime: "endsAtTime",
  timeZone: "timeZone",
} as const;

/** The other fields an event draft asks about. */
export const EVENT_FIELDS = {
  title: "title",
  conferenceUrl: "conferenceUrl",
  meeting: "meeting",
} as const;

/**
 * Whether a draft's timing reads as ALL DAY: a day with no hour on either end. What the record
 * stores for all day is an empty time — a filing has no hour — so the form's All Day control is a
 * reading of the times rather than a column of its own, and choosing it clears them.
 */
export function readsAsAllDay(draft: EventTimingDraft): boolean {
  return draft.startsOn !== null && draft.startsAtTime === "" && draft.endsAtTime === "";
}

/** The timing with its hours cleared, which is what choosing All Day means. */
export function asAllDay(draft: EventTimingDraft): EventTimingDraft {
  return { ...draft, startsAtTime: "", endsAtTime: "" };
}

/**
 * WHO AN EVENT BELONGS TO, which is the record it writes. A matter writes a matter event; the firm
 * and a staff member both write a firm event, because a person's own appointment is a firm event
 * with only that person on it — the `participants` audience already means exactly that — and a
 * third table for one would put two records on the calendar that nothing could tell apart. The
 * staff arm exists so that a reader can put something on ONE colleague's calendar without first
 * working out that "the firm, audience the people listed, participant: them" is how that is said
 * (owner, 2026-09-18).
 */
export type EventOwner = "matter" | "firm" | "staff";

export const EVENT_OWNER_OPTIONS: readonly { value: EventOwner; label: string }[] = [
  { value: "matter", label: "A matter" },
  { value: "firm", label: "The firm" },
  { value: "staff", label: "A staff member" },
];

export function isEventOwner(value: string): value is EventOwner {
  return EVENT_OWNER_OPTIONS.some((option) => option.value === value);
}

/**
 * The list with a member on it, once and first: a staff member's own event lists them whether or
 * not the reader also picked them among the participants, and never lists them twice.
 */
export function withMemberListed(
  participants: readonly ParticipantDraft[],
  userId: string,
  displayName: string,
): ParticipantDraft[] {
  const member = memberParticipant(userId, displayName);
  return [member, ...participants.filter((participant) => participant.key !== member.key)];
}

/**
 * WHERE A PARTICIPANT CAME FROM, in the vocabulary's words: a colleague from the roster is Staff, a
 * client or opposing counsel from the Directory is Directory, and a judge or a witness named once
 * is Other. The chips are bundled under these so a reader can tell which is which (owner,
 * 2026-09-18); the order is the picker's own, and the words are `PARTICIPANT_KIND_WORDS` so the
 * picker, the bundles and the record pane cannot call one kind two things.
 */
export const PARTICIPANT_SOURCES: readonly { kind: ParticipantKind; label: string }[] = (
  ["member", "entity", "external"] as const
).map((kind) => ({ kind, label: PARTICIPANT_KIND_WORDS[kind] }));

export interface ParticipantBundle {
  readonly kind: ParticipantKind;
  readonly label: string;
  readonly participants: readonly ParticipantDraft[];
}

/** The participants bundled by source, in source order; a source with nobody on it is left out. */
export function participantsBySource(
  participants: readonly ParticipantDraft[],
): ParticipantBundle[] {
  return PARTICIPANT_SOURCES.map((source) => ({
    kind: source.kind,
    label: source.label,
    participants: participants.filter((participant) => participant.participantKind === source.kind),
  })).filter((bundle) => bundle.participants.length > 0);
}

/**
 * THE FORM'S TABS, and which one each answer is on. The event form asks about a matter, a title,
 * a type, two dates, two times, a zone, a repeat, a location, a court reference, a link, a
 * description and a list of people — one column of that scrolled beside a calendar, and the owner
 * asked for the left side in tabs so each group of answers has a place of its own (2026-09-18).
 */
export type EventFormTab = "details" | "when" | "where" | "who";

export const EVENT_FORM_TABS: readonly { value: EventFormTab; label: string }[] = [
  { value: "details", label: "Details" },
  { value: "when", label: "When" },
  { value: "where", label: "Where" },
  { value: "who", label: "Who" },
];

/** The tab a shortfall's field is on, so a refused save can open the tab that still needs an answer. */
export function eventFormTabOf(field: string): EventFormTab {
  // The meeting sits beside the conference link, because both answer where the setting is JOINED.
  if (field === EVENT_FIELDS.conferenceUrl || field === EVENT_FIELDS.meeting) return "where";
  if (Object.values(TIMING_FIELDS).some((timingField) => timingField === field)) return "when";
  return "details";
}

/** The shortfalls in the timing every event shares, in the order a person meets them. */
export function timingShortfalls(draft: EventTimingDraft): Shortfall[] {
  const shortfalls: Shortfall[] = [];
  if (draft.startsOn === null || !isCivilDate(draft.startsOn)) {
    shortfalls.push(shortfall(TIMING_FIELDS.startsOn, "A date is needed."));
  }
  if (draft.startsAtTime !== "" && !isWallClockTime(draft.startsAtTime)) {
    shortfalls.push(
      shortfall(TIMING_FIELDS.startsAtTime, "The start time does not read as a time of day."),
    );
  }
  if (draft.endsOn !== null && !isCivilDate(draft.endsOn)) {
    shortfalls.push(shortfall(TIMING_FIELDS.endsOn, "The end date does not read as a date."));
  } else if (draft.endsOn !== null && draft.startsOn !== null && draft.endsOn < draft.startsOn) {
    shortfalls.push(shortfall(TIMING_FIELDS.endsOn, "The end date is before the start."));
  }
  if (draft.endsAtTime !== "" && !isWallClockTime(draft.endsAtTime)) {
    shortfalls.push(
      shortfall(TIMING_FIELDS.endsAtTime, "The end time does not read as a time of day."),
    );
  } else if (
    draft.endsAtTime !== "" &&
    draft.startsAtTime !== "" &&
    (draft.endsOn === null || draft.endsOn === draft.startsOn) &&
    draft.endsAtTime <= draft.startsAtTime
  ) {
    shortfalls.push(
      shortfall(TIMING_FIELDS.endsAtTime, "The end time is not after the start time."),
    );
  }
  if (draft.timeZone.trim() === "") {
    shortfalls.push(
      shortfall(TIMING_FIELDS.timeZone, "A time zone is needed: the one the event happens in."),
    );
  } else if (!isResolvableTimeZone(draft.timeZone)) {
    shortfalls.push(
      shortfall(TIMING_FIELDS.timeZone, "The time zone is not one a date can be read in."),
    );
  }
  return shortfalls;
}

/** Every reason the event cannot be recorded yet. Empty means it can. */
export function eventDraftShortfalls(draft: EventDraft): Shortfall[] {
  const shortfalls: Shortfall[] = [];
  if (draft.title.trim() === "") {
    shortfalls.push(shortfall(EVENT_FIELDS.title, "A title is needed."));
  }
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
export function conferenceShortfalls(conferenceUrl: string): Shortfall[] {
  const trimmed = conferenceUrl.trim();
  if (trimmed === "") return [];
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return [
      shortfall(EVENT_FIELDS.conferenceUrl, "The conference link does not read as a web address."),
    ];
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return [shortfall(EVENT_FIELDS.conferenceUrl, "The conference link has to be a web address.")];
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
    draft.meeting !== since.meeting ||
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

/**
 * Whether two repeat answers differ.
 *
 * Compared through the STORED LINE rather than field by field, because that is the only difference
 * that reaches the record: `formatRecurrence` leaves out the parts a frequency ignores, so a person
 * who ticked Tuesday, switched to Monthly and left it there has changed nothing the server will see.
 * An unsaved-changes prompt over a difference that cannot be saved is a prompt nobody can satisfy.
 */
export function recurrenceChanged(
  draft: RecurrenceRule | null,
  since: RecurrenceRule | null,
): boolean {
  if (draft === null || since === null) return draft !== since;
  return formatRecurrence(draft) !== formatRecurrence(since);
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
    recurrenceRule: draft.recurrence === null ? null : formatRecurrence(draft.recurrence),
    participants: draft.participants.map(participantInput),
    meeting: meetingInput(draft.meeting),
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
    recurrence: parseRecurrence(event.recurrenceRule),
    participants: participants.map((participant) =>
      participantDraftFrom(participant, displayNames),
    ),
    // A recorded event's meeting is a row of its own, read beside the event rather than off it, and
    // a correction never takes one off — so the draft opens on None and choosing a medium ADDS a
    // room where there is none. The entry window is what says one is already there.
    meeting: "none",
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
