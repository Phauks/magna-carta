/*
 * The calendar's response shapes and calls — every read and write a calendar surface makes, in one
 * home. Mirrors the calendar operations in apps/api-worker/openapi/openapi.json; the transport
 * envelope lives in $lib/api/request.ts.
 *
 * Three kinds of record, kept apart because they answer different questions. An EVENT is a setting
 * that was recorded on a matter — a hearing, a deposition, a meeting — and it has a place and
 * people. A DEADLINE is a date something must happen by; nothing here computes one, every date is
 * one a person recorded, and whether it has been missed is worked out when the page is read rather
 * than stored. A FIRM EVENT belongs to the firm rather than to any case — a meeting, a closure, a
 * holiday — and carries an audience instead of a matter.
 *
 * The FEDERATED read spans every matter a member can see and therefore carries no titles: its rows
 * are kinds, dates, matter identifiers and a declared non-privileged label, with a deep link to the
 * record's own access-gated read. That is the backend's rule, not this module's, and it is why a
 * firm-wide grid paints kinds and the window that opens on a press fetches the one row it needs.
 */
import { describeTimeZone } from "@magna-carta/design-system/formatters";
import { viewerTimeZone } from "$lib/dates";
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

/** The permission every calendar read is behind. */
export const READ_CALENDAR_PERMISSION = "calendar:read";
/** The permission every calendar write is behind: recording, editing, cancelling, settling. */
export const MANAGE_CALENDAR_PERMISSION = "calendar:manage";

export type EventStatus = "scheduled" | "occurred" | "cancelled";
export type DeadlineState = "open" | "satisfied" | "vacated" | "superseded";
export type DeadlineSource = "member" | "court_order";
export type FirmEventAudience = "all_members" | "participants";
export type ParticipantKind = "member" | "entity" | "external";
export type EventTypeCategory = "litigation" | "transaction" | "firm" | "other";

export interface CalendarEvent {
  id: string;
  matterId: string;
  eventTypeId: string | null;
  /** Resolved by the listing; null when the event is classified under nothing. */
  eventTypeName: string | null;
  title: string;
  description: string | null;
  status: EventStatus;
  /** Why the setting is no longer happening. Set by a cancellation or a continuance. */
  statusReason: string | null;
  startsOn: string;
  startsAtTime: string | null;
  endsOn: string | null;
  endsAtTime: string | null;
  /** The zone the wall-clock times above are read in. Never assume it is the reader's. */
  timeZone: string;
  locationText: string | null;
  /**
   * Where an online setting is JOINED — the meeting's own link, whoever hosts it. A DIFFERENT fact
   * from where it is held: a deposition can be in a conference room and on a call at once, and a
   * firm that typed "Zoom" where the room goes has lost the room.
   */
  conferenceUrl: string | null;
  /**
   * The RFC 5545 rule a repeating setting runs on, null on a one-off. ONE record carries the whole
   * series: the dates it falls on are read back from this rule, never stored as rows, so a series
   * that changes changes in one place.
   */
  recurrenceRule: string | null;
  courtReference: string | null;
  recordedAt: string;
  recordedBy: string | null;
  continuedFromEventId: string | null;
  continuedToEventId: string | null;
}

export interface CalendarDeadline {
  id: string;
  matterId: string;
  title: string;
  dueOn: string;
  dueAtTime: string | null;
  timeZone: string;
  source: string;
  /** The rule, statute, or order the firm says this comes from. Recorded, never resolved. */
  authorityText: string | null;
  triggerEventId: string | null;
  state: DeadlineState;
  satisfiedAt: string | null;
  satisfiedBy: string | null;
  satisfyingEventId: string | null;
  stateReason: string | null;
  priority: number | null;
  /** Derived at read time in the deadline's own zone. No column anywhere says a firm missed one. */
  overdue: boolean;
}

export interface FirmEvent {
  id: string;
  eventTypeId: string | null;
  title: string;
  description: string | null;
  status: EventStatus;
  statusReason: string | null;
  startsOn: string;
  startsAtTime: string | null;
  endsOn: string | null;
  endsAtTime: string | null;
  timeZone: string;
  /** all_members puts it on every member's calendar with no list to decay; participants lists them. */
  audience: FirmEventAudience;
  locationId: string | null;
  locationText: string | null;
  /**
   * Where an online setting is JOINED — the meeting's own link, whoever hosts it. A DIFFERENT fact
   * from where it is held: a deposition can be in a conference room and on a call at once, and a
   * firm that typed "Zoom" where the room goes has lost the room.
   */
  conferenceUrl: string | null;
  /**
   * The RFC 5545 rule a repeating setting runs on, null on a one-off. ONE record carries the whole
   * series: the dates it falls on are read back from this rule, never stored as rows, so a series
   * that changes changes in one place.
   */
  recurrenceRule: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

/** One person at an event: a firm member, a directory entity, or somebody who is neither. */
export interface EventParticipant {
  id: string;
  participantKind: ParticipantKind;
  memberUserId: string | null;
  entityId: string | null;
  participantName: string | null;
  role: string | null;
}

/** The same person, as a write names them. */
export interface ParticipantInput {
  participantKind: ParticipantKind;
  memberUserId?: string | null;
  entityId?: string | null;
  participantName?: string | null;
  role?: string | null;
}

/** One row of the firm's event-type catalog: the platform vocabulary plus the firm's own additions. */
export interface EventType {
  id: string;
  name: string;
  code: string | null;
  category: EventTypeCategory;
  origin: "platform" | "firm";
  active: boolean;
}

/**
 * One row of the federated read. A POINTER, not a copy: the kind, the civil-date sort key, the
 * matter it belongs to, the source's declared non-privileged label (a matter event's platform type
 * code, a deadline's state, a firm event's type name and audience), and the deep link into the
 * owning record's own read. Never a title, a narrative, or a person's name.
 */
export interface TimelineEntry {
  sourceKey: string;
  kind: string;
  sortKey: string;
  rowId: string;
  matterId: string | null;
  actorUserId: string | null;
  label: string | null;
  link: string;
  /**
   * The hour the row falls at, `HH:MM`, read in `timeZone` — the record's own zone, never
   * converted. Null where the row has no hour, which is what a filing due on a day is. It is the
   * one thing beyond the sort key the federated projection says about WHEN, and it is what lets a
   * day grid put a hearing on the ten o'clock row without the projection ever naming it.
   */
  timeOfDay: string | null;
  timeZone: string | null;
}

// ---- reads -------------------------------------------------------------------------------------

function withQuery(path: string, parameters: URLSearchParams): string {
  const suffix = parameters.toString();
  return suffix === "" ? path : `${path}?${suffix}`;
}

/**
 * The matter's own events, without the federated timeline — the read an editing surface makes.
 * Ordered by the date they are set for, furthest ahead first, so what is still coming leads.
 */
export function listMatterEvents(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<CalendarEvent>>> {
  const parameters = new URLSearchParams(cursor === undefined ? {} : { cursor });
  return requestJson(
    fetchImpl,
    withQuery(`/api/v1/matters/${encodeURIComponent(matterId)}/events`, parameters),
  );
}

export interface DeadlineQuery {
  matterId?: string;
  state?: DeadlineState;
  /** Civil dates, inclusive. The horizon is capped server-side and refused, never clamped. */
  from?: string;
  through?: string;
  /** Only the ones genuinely overdue in their own zones; implies open. */
  overdue?: boolean;
  cursor?: string;
}

/**
 * Deadlines across every matter the member can see, soonest first, in every state unless one is
 * named. A matter's deadline record includes the ones already satisfied and the ones vacated, and
 * narrowing to the open ones is a different question a different caller asks.
 */
export function listDeadlines(
  fetchImpl: typeof fetch,
  query: DeadlineQuery,
): Promise<ApiOutcome<Page<CalendarDeadline>>> {
  const parameters = new URLSearchParams();
  if (query.matterId !== undefined) parameters.set("matterId", query.matterId);
  if (query.state !== undefined) parameters.set("state", query.state);
  if (query.from !== undefined) parameters.set("from", query.from);
  if (query.through !== undefined) parameters.set("through", query.through);
  if (query.overdue === true) parameters.set("overdue", "true");
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  return requestJson(fetchImpl, withQuery("/api/v1/calendar/deadlines", parameters));
}

/** Every deadline on one matter, soonest first, in every state. */
export function listMatterDeadlines(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<CalendarDeadline>>> {
  return listDeadlines(fetchImpl, { matterId, cursor });
}

/** Which side of the calendar a federated read covers. */
export type CalendarSide = "matter" | "firm" | "all";

export interface FirmCalendarQuery {
  /** Civil dates, inclusive; required, and refused past the server's window cap. */
  from: string;
  to: string;
  side?: CalendarSide;
  /** Narrows the source registry before any statement is built; a kind no source carries is refused. */
  kinds?: readonly string[];
  matterId?: string;
  /** A participant, the matter's responsible member, or an all-members audience. */
  memberId?: string;
  cursor?: string;
}

/**
 * The firm's calendar across every matter a member can see, over a window. Rows are pointers (see
 * `TimelineEntry`); a month grid paints from them and the entry window fetches the one row opened.
 */
export function readFirmCalendar(
  fetchImpl: typeof fetch,
  query: FirmCalendarQuery,
): Promise<ApiOutcome<Page<TimelineEntry>>> {
  const parameters = new URLSearchParams({ from: query.from, to: query.to });
  if (query.side !== undefined) parameters.set("scope", query.side);
  for (const kind of query.kinds ?? []) parameters.append("kind", kind);
  if (query.matterId !== undefined) parameters.set("matterId", query.matterId);
  if (query.memberId !== undefined) parameters.set("memberId", query.memberId);
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  return requestJson(fetchImpl, withQuery("/api/v1/calendar/events", parameters));
}

export interface FirmEventQuery {
  from: string;
  to: string;
  status?: EventStatus;
  eventTypeId?: string;
  cursor?: string;
}

/** The firm's own events over a window, with their titles: the firm's scope is not per-matter. */
export function listFirmEvents(
  fetchImpl: typeof fetch,
  query: FirmEventQuery,
): Promise<ApiOutcome<Page<FirmEvent>>> {
  const parameters = new URLSearchParams({ from: query.from, to: query.to });
  if (query.status !== undefined) parameters.set("status", query.status);
  if (query.eventTypeId !== undefined) parameters.set("eventTypeId", query.eventTypeId);
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  return requestJson(fetchImpl, withQuery("/api/v1/firm-events", parameters));
}

/** One matter event with everybody at it — the read the entry window makes. */
export function readMatterEvent(
  fetchImpl: typeof fetch,
  eventId: string,
): Promise<ApiOutcome<{ event: CalendarEvent; participants: EventParticipant[] }>> {
  return requestJson(fetchImpl, `/api/v1/events/${encodeURIComponent(eventId)}`);
}

/** One firm event with everybody on it. An all-members event lists nobody: it needs no list. */
export function readFirmEvent(
  fetchImpl: typeof fetch,
  firmEventId: string,
): Promise<ApiOutcome<{ event: FirmEvent; participants: EventParticipant[] }>> {
  return requestJson(fetchImpl, `/api/v1/firm-events/${encodeURIComponent(firmEventId)}`);
}

/**
 * The event-type catalog. Un-paged on the contract: the vocabulary is bounded by what a firm has
 * named, and a picker missing a type would say the type does not exist.
 */
export function listEventTypes(
  fetchImpl: typeof fetch,
  includeInactive = false,
): Promise<ApiOutcome<{ data: EventType[] }>> {
  const parameters = new URLSearchParams(includeInactive ? { includeInactive: "true" } : {});
  return requestJson(fetchImpl, withQuery("/api/v1/calendar/event-types", parameters));
}

// ---- writes ------------------------------------------------------------------------------------
//
// Every write takes the caller's idempotency key: a retried submit must not put a second hearing
// on the calendar, and the server refuses the call outright when the header is absent.

/**
 * THE MEETING AN EVENT CARRIES. Scheduling a meeting is recording an event with a medium on it:
 * there is no second record and no second form, and the entry window offers Join from the moment
 * the event exists rather than from the moment somebody presses Start.
 *
 * Absent or null means no meeting. On a correction it means "leave the meeting exactly as it
 * stands" — a meeting is never taken off an event by an edit, because ending a gathering is an act
 * with its own route.
 */
export interface EventMeetingInput {
  /** Sound alone, or sound and pictures. Chosen once and never changed. */
  medium: "video" | "audio";
}

export interface CreateEventRequest {
  eventTypeId?: string | null;
  title: string;
  description?: string | null;
  status?: EventStatus;
  startsOn: string;
  /** Null or omitted means all day, which is what a filing is. */
  startsAtTime?: string | null;
  endsOn?: string | null;
  endsAtTime?: string | null;
  /** An IANA identifier — the zone the COURT sits in, which is frequently not the firm's own. */
  timeZone: string;
  locationText?: string | null;
  conferenceUrl?: string | null;
  courtReference?: string | null;
  /** An RFC 5545 rule the record form wrote. The server refuses one it could not read back. */
  recurrenceRule?: string | null;
  participants?: ParticipantInput[];
  meeting?: EventMeetingInput | null;
}

export type UpdateEventRequest = Partial<CreateEventRequest>;

export interface CreateDeadlineRequest {
  title: string;
  dueOn: string;
  /** Many filing deadlines are five in the afternoon; one whose hour nobody recorded is not midnight. */
  dueAtTime?: string | null;
  timeZone: string;
  source?: DeadlineSource;
  authorityText?: string | null;
  /** The event that started the clock. A link, never an input to a calculation. */
  triggerEventId?: string | null;
  priority?: number | null;
}

export type UpdateDeadlineRequest = Partial<Omit<CreateDeadlineRequest, "source">>;

export interface CreateFirmEventRequest {
  eventTypeId?: string | null;
  title: string;
  description?: string | null;
  status?: EventStatus;
  startsOn: string;
  startsAtTime?: string | null;
  endsOn?: string | null;
  endsAtTime?: string | null;
  timeZone: string;
  audience?: FirmEventAudience;
  locationId?: string | null;
  locationText?: string | null;
  conferenceUrl?: string | null;
  /** An RFC 5545 rule the record form wrote. The server refuses one it could not read back. */
  recurrenceRule?: string | null;
  participants?: ParticipantInput[];
  meeting?: EventMeetingInput | null;
}

export type UpdateFirmEventRequest = Partial<CreateFirmEventRequest>;

export interface ContinueEventRequest {
  startsOn: string;
  startsAtTime?: string | null;
  endsOn?: string | null;
  endsAtTime?: string | null;
  timeZone?: string;
  locationText?: string | null;
  conferenceUrl?: string | null;
  courtReference?: string | null;
  /** Why the old setting is not happening ("Continued on defendant's motion"). */
  statusReason?: string | null;
}

export interface ContinuanceDeadlineReference {
  id: string;
  title: string;
  dueOn: string;
  dueAtTime: string | null;
  timeZone: string;
  state: DeadlineState;
}

export interface ContinueEventResponse {
  newEventId: string;
  oldEventId: string;
  /** Purely informational: nothing moved, because what a continuance does to a schedule is a judgement. */
  triggerLinkedOpenDeadlines: ContinuanceDeadlineReference[];
  releasedBookings: {
    bookingId: string;
    eventKind: "matterEvent" | "firmEvent";
    eventId: string;
  }[];
}

export interface CreatedRecord {
  id: string;
}

export interface Acknowledged {
  ok: true;
}

/**
 * A recorded event answers with the meeting it carries, so a caller that asked for one can open it
 * without a second round trip to find out what it got. Null where the event has no meeting, which
 * is almost every event.
 */
export interface RecordedEvent extends CreatedRecord {
  meetingId: string | null;
}

export interface UpdatedEvent extends Acknowledged {
  meetingId: string | null;
}

export function createMatterEvent(
  fetchImpl: typeof fetch,
  matterId: string,
  request: CreateEventRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<RecordedEvent>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/events`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** A correction. The record misdescribed reality; fixing it is one change with the audit trail behind it. */
export function updateMatterEvent(
  fetchImpl: typeof fetch,
  eventId: string,
  request: UpdateEventRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<UpdatedEvent>> {
  return requestJson(fetchImpl, `/api/v1/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}

/** A setting that comes off entirely is cancelled, not deleted: that it was vacated is a fact. */
export function cancelMatterEvent(
  fetchImpl: typeof fetch,
  eventId: string,
  statusReason: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/events/${encodeURIComponent(eventId)}/cancel`, {
    method: "POST",
    body: { statusReason },
    idempotencyKey,
  });
}

/**
 * Reality moved: the court vacated a setting and made a new one. The old row stays byte-untouched
 * and marked cancelled, the new one is minted, and the two are linked. Never a correction.
 */
export function continueMatterEvent(
  fetchImpl: typeof fetch,
  eventId: string,
  request: ContinueEventRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<ContinueEventResponse>> {
  return requestJson(fetchImpl, `/api/v1/events/${encodeURIComponent(eventId)}/continue`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function createDeadline(
  fetchImpl: typeof fetch,
  matterId: string,
  request: CreateDeadlineRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<CreatedRecord>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/deadlines`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function updateDeadline(
  fetchImpl: typeof fetch,
  deadlineId: string,
  request: UpdateDeadlineRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/deadlines/${encodeURIComponent(deadlineId)}`, {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}

/** The firm did the thing. The filing that discharged it turns "we did it" into "here is what we did". */
export function satisfyDeadline(
  fetchImpl: typeof fetch,
  deadlineId: string,
  request: { satisfyingEventId?: string | null; satisfactionNote?: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/deadlines/${encodeURIComponent(deadlineId)}/satisfy`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** No longer in force, and the reason is required: silence is the only bad answer six months on. */
export function vacateDeadline(
  fetchImpl: typeof fetch,
  deadlineId: string,
  request: { stateReason: string },
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/deadlines/${encodeURIComponent(deadlineId)}/vacate`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** A new deadline replaces this one. Both stay on the record and the old one names the new. */
export function supersedeDeadline(
  fetchImpl: typeof fetch,
  deadlineId: string,
  request: { stateReason: string; supersededByDeadlineId: string },
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/deadlines/${encodeURIComponent(deadlineId)}/supersede`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function createFirmEvent(
  fetchImpl: typeof fetch,
  request: CreateFirmEventRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<RecordedEvent>> {
  return requestJson(fetchImpl, "/api/v1/firm-events", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** A moved staff meeting is an edit, with the move on the audit trail; continuance is a litigation fact. */
export function updateFirmEvent(
  fetchImpl: typeof fetch,
  firmEventId: string,
  request: UpdateFirmEventRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<UpdatedEvent>> {
  return requestJson(fetchImpl, `/api/v1/firm-events/${encodeURIComponent(firmEventId)}`, {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}

export function cancelFirmEvent(
  fetchImpl: typeof fetch,
  firmEventId: string,
  statusReason: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/firm-events/${encodeURIComponent(firmEventId)}/cancel`, {
    method: "POST",
    body: { statusReason },
    idempotencyKey,
  });
}

// ---- presentation helpers shared by every calendar surface --------------------------------------

const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "Scheduled",
  occurred: "Occurred",
  cancelled: "Cancelled",
};

export function eventStatusLabel(status: EventStatus): string {
  return EVENT_STATUS_LABELS[status];
}

/**
 * Only "cancelled" earns a warning tone: it is the one status meaning the setting is not happening,
 * and a reader scanning a column of dates has to see that without reading. Scheduled and occurred
 * are ordinary progress and stay neutral rather than turning the list into a traffic light.
 */
export function eventStatusTone(status: EventStatus): "neutral" | "warning" {
  return status === "cancelled" ? "warning" : "neutral";
}

const DEADLINE_STATE_LABELS: Record<DeadlineState, string> = {
  open: "Open",
  satisfied: "Satisfied",
  vacated: "Vacated",
  superseded: "Superseded",
};

export function deadlineStateLabel(state: DeadlineState): string {
  return DEADLINE_STATE_LABELS[state];
}

/**
 * A deadline that is open and past its moment is the only thing on a screen a person has to act
 * on, so it is the only thing that gets the danger tone. A satisfied or vacated deadline is settled
 * history however late it was met.
 */
/**
 * The word a deadline's badge carries: its state, except that an OPEN deadline past its day says
 * so, because that is the one fact a reader opened the calendar to find. Decided once, so the entry
 * window and the matter's List cannot disagree about which deadline is late.
 */
export function deadlineStateBadgeLabel(deadline: CalendarDeadline): string {
  return deadline.overdue && deadline.state === "open"
    ? "Past due"
    : deadlineStateLabel(deadline.state);
}

export function deadlineTone(deadline: CalendarDeadline): "neutral" | "success" | "danger" {
  if (deadline.overdue && deadline.state === "open") return "danger";
  if (deadline.state === "satisfied") return "success";
  return "neutral";
}

const AUDIENCE_LABELS: Record<FirmEventAudience, string> = {
  all_members: "Everyone",
  participants: "Participants",
};

export function firmEventAudienceLabel(audience: FirmEventAudience): string {
  return AUDIENCE_LABELS[audience];
}

/**
 * A wall-clock time as it was recorded, in the zone it was recorded for. The zone is shown only
 * when it is not the reader's own: a hearing at nine in the morning two zones away is a different
 * fact from one at nine here, and a reader who shares the zone does not need to be told.
 *
 * THE ZONE IS ITS CODE ON THE DAY — "5:00 PM PST" — never the identifier. A chip printed
 * "(America/Los_Angeles)" beside the hour while the form that recorded it said "PST", which was
 * one of the four shapes a zone wore on this calendar (owner, 2026-09-18). The code is the display
 * vocabulary's own (`describeTimeZone`), worked out for the civil day the time is on, because the
 * same zone is PST in January and PDT in July; a caller with no day gets today's.
 */
export function formatWallClock(
  time: string | null,
  timeZone: string,
  readerZone: string = readerTimeZone(),
  on: string | null = null,
): string | null {
  if (time === null) return null;
  const parts = time.split(":");
  const hour = Number(parts[0]);
  const minute = Number(parts[1] ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const clock = `${String(hour12)}:${String(minute).padStart(2, "0")} ${suffix}`;
  if (timeZone === readerZone) return clock;
  // Noon UTC on the civil day: inside that day in every zone, so the code is the day's own.
  const day = on === null ? new Date() : new Date(`${on}T12:00:00Z`);
  return `${clock} ${describeTimeZone(timeZone, day).abbreviation}`;
}

/**
 * The zone the reader's own day is measured in, or an empty string where the runtime cannot say.
 *
 * The empty answer is this surface's own: a calendar row that cannot name the reader's zone drops
 * the "(America/Denver)" suffix rather than showing one it guessed. Everywhere else the zone is
 * required and `viewerTimeZone` is the function.
 */
export function readerTimeZone(): string {
  try {
    return viewerTimeZone();
  } catch {
    return "";
  }
}

/** How many deadlines are open and past due — the count that decides whether a screen alarms. */
export function overdueCount(deadlines: readonly CalendarDeadline[]): number {
  return deadlines.filter((deadline) => deadline.overdue && deadline.state === "open").length;
}

// ---- the firm's calendar settings --------------------------------------------------------------
//
// What the firm decides once about how it reads its own calendar. One setting today: the day the
// week begins on. A FIRM setting rather than a personal preference, by the owner's ruling — two
// members of one firm looking at the same week must see the same grid, so that "next week" names
// the same seven days to everybody.

/** The two week starts practice actually uses: 0 is Sunday, 1 is Monday. */
export type WeekStartsOn = 0 | 1;

export interface CalendarSettings {
  weekStartsOn: WeekStartsOn;
}

/** The firm's settings as they stand. Readable by every member who can read the calendar. */
export function readCalendarSettings(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<CalendarSettings>> {
  return requestJson(fetchImpl, "/api/v1/calendar/settings");
}

export interface UpdateCalendarSettingsRequest {
  weekStartsOn?: WeekStartsOn;
}

/** Moves the firm's week for everybody; audited, and behind `calendar:manage`. */
export function updateCalendarSettings(
  fetchImpl: typeof fetch,
  request: UpdateCalendarSettingsRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<CalendarSettings>> {
  return requestJson(fetchImpl, "/api/v1/calendar/settings", {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}

// ---- resources and bookings --------------------------------------------------------------------
//
// A resource is something bookable the firm owns; a booking always hangs off exactly one event and
// blocks the resource while that event is not cancelled. Double-booking is warn-and-allow: a write
// lands and reports the conflicts it made, and the availability read pre-pairs every overlap.

export type FirmResourceKind = "room" | "vehicle" | "equipment" | "other";

export interface FirmResource {
  id: string;
  name: string;
  kind: FirmResourceKind;
  locationId: string | null;
  capacity: number | null;
  notes: string | null;
  active: boolean;
}

/** The catalog, un-paged and capped; `capped` says when a firm has more resources than the cap. */
export function listResources(
  fetchImpl: typeof fetch,
  includeInactive = false,
): Promise<ApiOutcome<{ data: FirmResource[]; capped: boolean }>> {
  const parameters = new URLSearchParams(includeInactive ? { includeInactive: "true" } : {});
  return requestJson(fetchImpl, withQuery("/api/v1/calendar/resources", parameters));
}

export interface CreateResourceRequest {
  name: string;
  kind: FirmResourceKind;
  locationId?: string | null;
  capacity?: number | null;
  notes?: string | null;
}

export interface UpdateResourceRequest {
  name?: string;
  kind?: FirmResourceKind;
  locationId?: string | null;
  capacity?: number | null;
  notes?: string | null;
  active?: boolean;
}

export function createResource(
  fetchImpl: typeof fetch,
  request: CreateResourceRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<FirmResource>> {
  return requestJson(fetchImpl, "/api/v1/calendar/resources", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function updateResource(
  fetchImpl: typeof fetch,
  resourceId: string,
  request: UpdateResourceRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/calendar/resources/${encodeURIComponent(resourceId)}`, {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}

export type BookingEventKind = "matterEvent" | "firmEvent";

/** One live booking on a resource's schedule, with the bookings it overlaps already paired. */
export interface ResourceAvailabilityEntry {
  bookingId: string;
  startsOn: string;
  startsAtTime: string | null;
  endsOn: string | null;
  endsAtTime: string | null;
  timeZone: string;
  eventKind: BookingEventKind;
  eventId: string;
  eventTypeName: string | null;
  link: string;
  overlappingBookingIds: string[];
}

/** A resource's window. Un-paged: a room's bookings over a month are a handful by construction. */
export function readResourceAvailability(
  fetchImpl: typeof fetch,
  resourceId: string,
  window: { from: string; to: string },
): Promise<ApiOutcome<{ data: ResourceAvailabilityEntry[] }>> {
  const parameters = new URLSearchParams({ from: window.from, to: window.to });
  return requestJson(
    fetchImpl,
    withQuery(
      `/api/v1/calendar/resources/${encodeURIComponent(resourceId)}/availability`,
      parameters,
    ),
  );
}

/** One of an event's own bookings, as the event's window lists them. */
export interface EventBooking {
  id: string;
  resourceId: string;
  startsOn: string;
  startsAtTime: string | null;
  endsOn: string | null;
  endsAtTime: string | null;
  timeZone: string;
}

/** The bookings an event holds. A matter event's through its own path, a firm event's through the firm's. */
export function listEventBookings(
  fetchImpl: typeof fetch,
  event: { kind: BookingEventKind; id: string },
): Promise<ApiOutcome<{ data: EventBooking[] }>> {
  const path =
    event.kind === "matterEvent"
      ? `/api/v1/events/${encodeURIComponent(event.id)}/bookings`
      : `/api/v1/firm-events/${encodeURIComponent(event.id)}/bookings`;
  return requestJson(fetchImpl, path);
}

export interface BookingConflict {
  bookingId: string;
  startsOn: string;
  startsAtTime: string | null;
  endsOn: string | null;
  endsAtTime: string | null;
  timeZone: string;
  eventKind: BookingEventKind;
  eventId: string;
  link: string;
}

export interface CreateBookingRequest {
  resourceId: string;
  matterEventId?: string | null;
  firmEventId?: string | null;
  /** Omitted, the booking takes the event's own window. */
  startsOn?: string;
  startsAtTime?: string | null;
  endsOn?: string | null;
  endsAtTime?: string | null;
  timeZone?: string;
}

/** Books a resource for an event. Lands even when it double-books, and says so in `conflicts`. */
export function createBooking(
  fetchImpl: typeof fetch,
  request: CreateBookingRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string; conflicts: BookingConflict[] }>> {
  return requestJson(fetchImpl, "/api/v1/resource-bookings", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** Releases a resource. The only way a booking goes, other than its event being cancelled. */
export function deleteBooking(
  fetchImpl: typeof fetch,
  bookingId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/resource-bookings/${encodeURIComponent(bookingId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** Every kind a resource can be, in the order a catalog offers them. */
export const FIRM_RESOURCE_KINDS: readonly FirmResourceKind[] = [
  "room",
  "vehicle",
  "equipment",
  "other",
];

/** How a resource is named wherever it is picked or listed beside its kind: "Boardroom · Room". */
export function resourceChipLabel(resource: { name: string; kind: FirmResourceKind }): string {
  return `${resource.name} · ${resourceKindLabel(resource.kind)}`;
}

/** The word a resource kind reads as. */
export function resourceKindLabel(kind: FirmResourceKind): string {
  switch (kind) {
    case "room":
      return "Room";
    case "vehicle":
      return "Vehicle";
    case "equipment":
      return "Equipment";
    case "other":
      return "Other";
  }
}

// ---- the event-type catalog's writes -----------------------------------------------------------
//
// A platform type's name and code are the shared vocabulary and immutable to a firm; a firm adds its
// own types, recategorizes any, and retires the ones it does not use. Nothing here reactivates a
// retired type: the contract carries no such write, and the page says so.

export interface CreateEventTypeRequest {
  name: string;
  code?: string | null;
  category?: EventTypeCategory;
}

export type UpdateEventTypeRequest = Partial<CreateEventTypeRequest>;

export function createEventType(
  fetchImpl: typeof fetch,
  request: CreateEventTypeRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<CreatedRecord>> {
  return requestJson(fetchImpl, "/api/v1/calendar/event-types", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function updateEventType(
  fetchImpl: typeof fetch,
  eventTypeId: string,
  request: UpdateEventTypeRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/calendar/event-types/${encodeURIComponent(eventTypeId)}`, {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}

export function deactivateEventType(
  fetchImpl: typeof fetch,
  eventTypeId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(
    fetchImpl,
    `/api/v1/calendar/event-types/${encodeURIComponent(eventTypeId)}/deactivate`,
    { method: "POST", idempotencyKey },
  );
}

/** The word a category reads as. */
/** Every category an event type can take, in the order a catalog offers them. */
export const EVENT_TYPE_CATEGORIES: readonly EventTypeCategory[] = [
  "litigation",
  "transaction",
  "firm",
  "other",
];

export function eventTypeCategoryLabel(category: EventTypeCategory): string {
  switch (category) {
    case "litigation":
      return "Litigation";
    case "transaction":
      return "Transaction";
    case "firm":
      return "Firm";
    case "other":
      return "Other";
  }
}

// ---- links between events ----------------------------------------------------------------------
//
// Two kinds: `continuance_of`, which only the continue operation writes, and `related`, which a
// person records between two settings that belong together. Ends are identifiers; the other end's
// record is read on its own path.

export type EventLinkKind = "continuance_of" | "related";

export interface EventLinkEnd {
  matterEventId: string | null;
  firmEventId: string | null;
}

export interface EventLink {
  id: string;
  kind: EventLinkKind;
  from: EventLinkEnd;
  to: EventLinkEnd;
  note: string | null;
  createdAt: string;
}

/** Every link touching an event, from either side. */
export function listEventLinks(
  fetchImpl: typeof fetch,
  event: { kind: BookingEventKind; id: string },
): Promise<ApiOutcome<{ data: EventLink[] }>> {
  const path =
    event.kind === "matterEvent"
      ? `/api/v1/events/${encodeURIComponent(event.id)}/links`
      : `/api/v1/firm-events/${encodeURIComponent(event.id)}/links`;
  return requestJson(fetchImpl, path);
}

export interface CreateEventLinkRequest {
  fromMatterEventId?: string | null;
  fromFirmEventId?: string | null;
  toMatterEventId?: string | null;
  toFirmEventId?: string | null;
  note?: string | null;
}

/** Relates two events. A continuance link is never written here; the continue operation writes it. */
export function createEventLink(
  fetchImpl: typeof fetch,
  request: CreateEventLinkRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<CreatedRecord>> {
  return requestJson(fetchImpl, "/api/v1/event-links", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** Removes a related link. A continuance link is refused: the chain is the record. */
export function deleteEventLink(
  fetchImpl: typeof fetch,
  linkId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<Acknowledged>> {
  return requestJson(fetchImpl, `/api/v1/event-links/${encodeURIComponent(linkId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

// ---- the matter timeline -----------------------------------------------------------------------

export type TimelineDirection = "past" | "future" | "all";
