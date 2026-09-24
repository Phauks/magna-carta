/*
 * What the editor's container has been doing, as this worker can see it: the phases of one
 * document's container from the moment it is asked for to the moment its page is served, kept so
 * the screen framing the editor can say what the wait actually is.
 *
 * WHAT CAN AND CANNOT BE SEEN. The platform gives this worker the container's lifecycle (asked
 * for, started, its port answering, stopped, an error) and nothing of its output: coolwsd's own
 * log goes to the platform's log store, not to the Worker. So the record is the phases the
 * runtime reports plus the one fact this worker adds, the editor page being served, which is the
 * moment the browser can begin. Between "started" and "listening" is coolwsd booting inside the
 * image, the longest stretch of a cold open, and the record shows it as exactly that: a gap.
 *
 * The record is a short list in the Durable Object's storage, never on the instance, so it
 * survives the object being evicted between requests. A new "requested" after the container
 * stopped or failed starts a fresh list: the screen reads the open it is watching, not the one
 * before. The list is capped so a container that flaps cannot grow it without bound.
 */

export type ContainerPhase = "requested" | "started" | "listening" | "served" | "stopped" | "error";

export interface ContainerEvent {
  readonly phase: ContainerPhase;
  /** ISO 8601, the worker's clock. */
  readonly at: string;
  /** A short fact beside the phase: an exit code, the runtime's error sentence. Never document data. */
  readonly detail: string | null;
}

/** How many events one container keeps. A clean open is five; the rest is room for a restart. */
export const MAX_CONTAINER_EVENTS = 40;

/** How much of an error's sentence is kept. Enough to read; never a whole stack. */
const MAX_DETAIL_CHARACTERS = 160;

/** The storage key the list lives under in the container's Durable Object. */
export const CONTAINER_EVENTS_KEY = "magna-carta:container-events";

/** A detail cut to size, or null for nothing worth keeping. */
export function detailOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = value instanceof Error ? value.message : String(value);
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return trimmed.length > MAX_DETAIL_CHARACTERS
    ? `${trimmed.slice(0, MAX_DETAIL_CHARACTERS - 1)}…`
    : trimmed;
}

/** Whether the list ended: the container stopped or failed, so the next request is a new open. */
function ended(events: readonly ContainerEvent[]): boolean {
  const last = events.at(-1);
  return last !== undefined && (last.phase === "stopped" || last.phase === "error");
}

/**
 * The list with one more event. A "requested" after the list ended, or on an empty list, opens a
 * fresh list; a "requested" while the container is up is the next document request and is not
 * recorded, since the phase already happened. Every other phase is appended once per occurrence.
 */
export function withEvent(
  events: readonly ContainerEvent[],
  event: ContainerEvent,
): readonly ContainerEvent[] {
  if (event.phase === "requested") {
    if (events.length === 0 || ended(events)) return [event];
    return events;
  }
  const next = [...events, event];
  return next.length > MAX_CONTAINER_EVENTS ? next.slice(next.length - MAX_CONTAINER_EVENTS) : next;
}

/** Whether a phase has already been recorded on the current (unended) list. */
export function hasPhase(events: readonly ContainerEvent[], phase: ContainerPhase): boolean {
  return !ended(events) && events.some((event) => event.phase === phase);
}

/** The path, on a document's origin, the record is read from. */
export const CONTAINER_STATUS_PATH = "/magna-carta/status";

/** Whether a request on a document's origin asks for the container's record. */
export function isStatusRequest(request: Request): boolean {
  return request.method === "GET" && new URL(request.url).pathname === CONTAINER_STATUS_PATH;
}

/**
 * The record as the app worker reads it over the service binding. Not cached: the point is what
 * happened in the last second. Nothing here is the document's; the events are phases, instants and
 * the runtime's own sentences.
 */
export function statusResponse(events: readonly ContainerEvent[]): Response {
  return Response.json({ events }, { headers: { "cache-control": "no-store" } });
}
