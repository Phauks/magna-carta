/*
 * The matter Calendar section's response shapes and calls. Mirrors the calendar operations in
 * apps/worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * Two reads, because a matter's calendar is two different questions. An EVENT is a setting that was
 * recorded — a hearing, a deposition, a meeting — and it has a place and people. A DEADLINE is a
 * date something must happen by; nothing here computes one, every date is one a person recorded,
 * and whether it has been missed is worked out when the page is read rather than stored.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

export type EventStatus = "scheduled" | "occurred" | "cancelled";
export type DeadlineState = "open" | "satisfied" | "vacated" | "superseded";

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

/**
 * The matter's own events, without the federated timeline — the read an editing surface makes.
 * Ordered by the date they are set for, furthest ahead first, so what is still coming leads.
 */
export function listMatterEvents(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<CalendarEvent>>> {
  const query = new URLSearchParams(cursor === undefined ? {} : { cursor });
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/events${suffix}`);
}

/**
 * Every deadline on the matter, soonest first, in every state. State is deliberately not passed:
 * a matter's deadline record includes the ones already satisfied and the ones vacated, and
 * narrowing to the open ones is a different question a different caller asks.
 */
export function listMatterDeadlines(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<CalendarDeadline>>> {
  const query = new URLSearchParams({ matterId, ...(cursor === undefined ? {} : { cursor }) });
  return requestJson(fetchImpl, `/api/v1/calendar/deadlines?${query.toString()}`);
}

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
 * A deadline that is open and past its moment is the only thing on this screen a person has to act
 * on, so it is the only thing that gets the danger tone. A satisfied or vacated deadline is settled
 * history however late it was met.
 */
export function deadlineTone(deadline: CalendarDeadline): "neutral" | "success" | "danger" {
  if (deadline.overdue && deadline.state === "open") return "danger";
  if (deadline.state === "satisfied") return "success";
  return "neutral";
}

/**
 * A wall-clock time as it was recorded, in the zone it was recorded for. The zone is shown only
 * when it is not the reader's own: a hearing at nine in the morning two zones away is a different
 * fact from one at nine here, and a reader who shares the zone does not need to be told.
 */
export function formatWallClock(time: string | null, timeZone: string): string | null {
  if (time === null) return null;
  const parts = time.split(":");
  const hour = Number(parts[0]);
  const minute = Number(parts[1] ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const clock = `${String(hour12)}:${String(minute).padStart(2, "0")} ${suffix}`;
  return timeZone === readerTimeZone() ? clock : `${clock} (${timeZone})`;
}

function readerTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

/** How many deadlines are open and past due — the count that decides whether the screen alarms. */
export function overdueCount(deadlines: readonly CalendarDeadline[]): number {
  return deadlines.filter((deadline) => deadline.overdue && deadline.state === "open").length;
}
