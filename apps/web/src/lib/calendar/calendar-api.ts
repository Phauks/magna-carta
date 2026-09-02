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
  courtReference?: string | null;
  participants?: ParticipantInput[];
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
  participants?: ParticipantInput[];
}

export type UpdateFirmEventRequest = Partial<CreateFirmEventRequest>;

export interface ContinueEventRequest {
  startsOn: string;
  startsAtTime?: string | null;
  endsOn?: string | null;
  endsAtTime?: string | null;
  timeZone?: string;
  locationText?: string | null;
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

export function createMatterEvent(
  fetchImpl: typeof fetch,
  matterId: string,
  request: CreateEventRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<CreatedRecord>> {
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
): Promise<ApiOutcome<Acknowledged>> {
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
): Promise<ApiOutcome<CreatedRecord>> {
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
): Promise<ApiOutcome<Acknowledged>> {
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
 */
export function formatWallClock(
  time: string | null,
  timeZone: string,
  readerZone: string = readerTimeZone(),
): string | null {
  if (time === null) return null;
  const parts = time.split(":");
  const hour = Number(parts[0]);
  const minute = Number(parts[1] ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const clock = `${String(hour12)}:${String(minute).padStart(2, "0")} ${suffix}`;
  return timeZone === readerZone ? clock : `${clock} (${timeZone})`;
}

/** The zone the reader's own day is measured in, or an empty string where the runtime cannot say. */
export function readerTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

/** How many deadlines are open and past due — the count that decides whether a screen alarms. */
export function overdueCount(deadlines: readonly CalendarDeadline[]): number {
  return deadlines.filter((deadline) => deadline.overdue && deadline.state === "open").length;
}
