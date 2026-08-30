/**
 * An instant, in any of the forms a caller is likely to hold one: a `Date`, the UTC ISO string an
 * API returns, or epoch milliseconds. Stored instants are UTC; the rail renders them in the
 * viewer's own local time.
 *
 * The rail keeps its own name for the platform's instant type so its existing callers are
 * undisturbed, but it is an alias and not a second declaration — two structurally identical types
 * drift the moment one of them grows a form the other does not accept.
 */
import type { Instant } from "../../formatters/instant.ts";

export type EventInstant = Instant;

/**
 * One recorded event on an EventRail: what happened, when, what caused it, and any detail that was
 * recorded with it.
 *
 * The shape is deliberately domain-free. The same rail presents a record's history, a document's
 * version history, a safety-check history and a history view's details panel, so nothing here may
 * name a time entry, a file, an invoice or any other kind of thing — a caller states what happened
 * in `action` and the rail presents it.
 */
export interface EventRailEvent {
  /** Stable identity for this event. Used as the render key, so it is unique within a rail. */
  id: string;
  /**
   * What happened, as a short phrase in the caller's own words ("Entered as a draft", "Moved from
   * Costs to Time"). It leads the event, set semibold.
   */
  action: string;
  /** When it happened. Rendered as an actual instant in local time, never as elapsed time. */
  at: EventInstant;
  /**
   * What caused the event. A person's name where a person acted, and the platform's own name where
   * it acted on its own — an automatic re-scan, a retention sweep, an inbound filing. It is called
   * the source rather than the actor precisely because it is not always a person, and a rail that
   * called it "Person" would start lying the first time the platform acted by itself.
   */
  source: string;
  /**
   * Anything recorded alongside the event in someone's own words — a kick-back reason, a note left
   * with an approval. Presented quoted beneath the event, because it is text somebody wrote rather
   * than the platform's account of what happened.
   */
  detail?: string;
}
