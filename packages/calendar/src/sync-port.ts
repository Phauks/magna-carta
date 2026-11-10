import type { Dispatch } from "@magna-carta/integrations/dispatch";

// What calendar sync needs from a member's own calendar account, in the calendar's vocabulary rather
// than any provider's. One adapter implements it per provider. Every method answers a typed outcome
// instead of throwing, because the caller is a background pass that has to decide between retrying,
// asking the member to sign in again, and raising an issue, and it can only do that from a category.

// One calendar inside the member's account. A member picks a destination per event type from this
// list, and picks which of them Magna Carta may show back to them.
export interface ProviderCalendar {
  readonly remoteId: string;
  readonly name: string;
  // The account's own default calendar: the destination a new rule starts on.
  readonly isDefault: boolean;
  // A calendar shared to the member read-only can be shown but can never be a destination.
  readonly canWrite: boolean;
}

// One event as it is written to a provider, in the calendar's own terms: civil dates and wall-clock
// times in a named zone, with an inclusive last day. An adapter converts to whatever its provider
// wants (an exclusive end, midnight boundaries for a whole day) and that conversion is the
// adapter's alone, so no caller ever holds a provider's shape.
export interface ProviderEventWrite {
  readonly title: string;
  readonly notes: string | null;
  readonly location: string | null;
  readonly startsOn: string; // YYYY-MM-DD
  // HH:MM, or null for an event that takes the whole day.
  readonly startsAtTime: string | null;
  // The last day the event covers; null when it starts and ends on the same day.
  readonly endsOn: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
}

// What a provider answers a write with: its own identifier for the copy, and a tag that changes
// every time the copy does.
export interface ProviderEventReceipt {
  readonly remoteId: string;
  readonly versionTag: string | null;
}

// Whether the copy was there to act on. A copy the member deleted at the provider is `missing`,
// which is an answer and not a failure: the caller decides what a missing copy means.
export type ProviderEventPresence =
  | { readonly found: true; readonly versionTag: string | null }
  | { readonly found: false };

// One copy as the provider holds it now, read back in the calendar's terms. A whole-day copy is
// civil dates with an inclusive last day; a timed one is two instants, because the provider answers
// in its own zone and only the caller knows which zone the event was written in.
export interface ProviderEventSnapshot {
  readonly remoteId: string;
  readonly versionTag: string | null;
  readonly title: string;
  readonly location: string | null;
  readonly when:
    | { readonly kind: "days"; readonly startsOn: string; readonly endsOn: string }
    | {
        readonly kind: "instants";
        readonly startsAtMilliseconds: number;
        readonly endsAtMilliseconds: number;
      };
}

// The copies this platform wrote that the provider still holds. `complete` is false when the
// provider had more than the adapter was willing to page through, in which case a copy missing
// from the list proves nothing.
export interface ProviderWrittenEvents {
  readonly events: readonly ProviderEventSnapshot[];
  readonly complete: boolean;
}

export interface CalendarSyncPort {
  listCalendars(): Promise<Dispatch<readonly ProviderCalendar[]>>;
  // `transactionId` is chosen by the caller and repeated on a retry, so a create whose answer was
  // lost makes one copy and not two.
  createEvent(
    calendarRemoteId: string,
    event: ProviderEventWrite,
    transactionId: string,
  ): Promise<Dispatch<ProviderEventReceipt>>;
  updateEvent(
    remoteId: string,
    event: ProviderEventWrite,
  ): Promise<Dispatch<ProviderEventPresence>>;
  // Deleting a copy that is already gone succeeds: the caller wanted it gone.
  deleteEvent(remoteId: string): Promise<Dispatch<null>>;
  // Every copy this platform wrote into the account, whichever calendar it sits in. Only those:
  // an event the member made themselves is never read by this method.
  listWrittenEvents(): Promise<Dispatch<ProviderWrittenEvents>>;
  // One copy by its identifier, or null when the provider no longer has it. The answer that
  // settles whether a copy missing from the list is really gone.
  readEvent(remoteId: string): Promise<Dispatch<ProviderEventSnapshot | null>>;
}

// The operation names an adapter's capability descriptor declares, so a caller can ask what an
// adapter supports before calling it.
export const CALENDAR_SYNC_CATEGORY = "calendar-sync";
export const CALENDAR_SYNC_OPERATIONS = [
  "listCalendars",
  "createEvent",
  "updateEvent",
  "deleteEvent",
  "listWrittenEvents",
  "readEvent",
] as const;
export type CalendarSyncOperation = (typeof CALENDAR_SYNC_OPERATIONS)[number];
