/*
 * An entry's recorded events, in the words a reader uses.
 *
 * The audit trail names events the way the write path does — `time_entry.captured`, `.kicked_back`
 * — which is exactly right for a record nobody reads by eye and exactly wrong for a history rail. A
 * reader wants "Entered as a draft", so the translation happens here, once, rather than in a
 * template where a new event would silently render its own raw handle.
 *
 * AN UNKNOWN EVENT STILL RENDERS. The server will grow events this file has not been told about,
 * and the honest answer to one is the event's own name read back — not a blank row, and not a
 * guess at what it meant. That is why the fallback tidies rather than invents.
 *
 * THE DETAIL IS SOMEBODY'S OWN WORDS, OR NOTHING. The audit's metadata is redacted by construction:
 * it records WHICH fields an edit touched, never their text, so the only thing worth quoting under
 * an event is a reason a person actually wrote. Everything else that comes back is a field list,
 * and a field list is what the event already says.
 */
import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
import { personName } from "@magna-carta/design-system/formatters";
import type { TimeEntryEvent } from "./time-operations.ts";

/** The platform's own name, where an event had no person behind it. */
const THE_PLATFORM = "Magna Carta";

/** What each recorded event is called on screen. */
const EVENT_WORDS: Readonly<Record<string, string>> = {
  "time_entry.captured": "Entered as a draft",
  "time_entry.updated": "Changed",
  "time_entry.submitted": "Submitted for review",
  "time_entry.approved": "Approved",
  "time_entry.kicked_back": "Kicked back to draft",
  "time_entry.voided": "Voided",
  "time_entry.billed": "Billed",
  "time_entry.file_attached": "A file was attached",
  "time_entry.file_detached": "A file was detached",
  "time_entry.converted_to_cost": "Converted to a cost",
  "time_entry.re_rated": "Re-rated",
};

/**
 * An event's own name, read back as a sentence.
 *
 * The handle is `namespace.event_name`, so the tail with its underscores opened out is a legible
 * account of what happened even when nothing here has been taught the event.
 */
function wordsFor(event: string): string {
  const known = EVENT_WORDS[event];
  if (known !== undefined) return known;
  const tail = event.includes(".") ? (event.split(".").at(-1) ?? event) : event;
  const opened = tail.replaceAll("_", " ");
  return opened.charAt(0).toUpperCase() + opened.slice(1);
}

/** The one thing worth quoting beneath an event: a reason somebody wrote. */
function reasonIn(detail: unknown): string | undefined {
  if (typeof detail !== "object" || detail === null) return undefined;
  const reason = (detail as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.trim() !== "" ? reason : undefined;
}

/**
 * The entry's events as the rail takes them.
 *
 * The identity is the instant and the event together: two events can share an instant (a capture
 * and the audit row that rides with it), and the pair is stable across re-reads in a way an index
 * is not.
 */
export function historyEvents(events: readonly TimeEntryEvent[]): readonly EventRailEvent[] {
  return events.map((event, index) => ({
    id: `${event.at}:${event.event}:${String(index)}`,
    action: wordsFor(event.event),
    at: event.at,
    // A person where a person acted, the platform where it acted alone. A departed member still
    // reads as their name, because a name on a record is history and not a join.
    source: event.actorName === null ? THE_PLATFORM : personName(event.actorName),
    ...(reasonIn(event.detail) === undefined ? {} : { detail: reasonIn(event.detail) }),
  }));
}
