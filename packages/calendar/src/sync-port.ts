import type { RecurrenceRule } from "@magna-carta/civil-time/recurrence";
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
  // Present when the event is a series, absent or null when it happens once. `startsOn` is then
  // the series' first day.
  readonly repeats?: ProviderEventRepeat | null;
}

// How a series repeats, in the calendar's own terms. An adapter converts the rule to its
// provider's shape and refuses, as a validation problem, a rule the provider cannot repeat on
// exactly the same days: a series that falls on different days in two calendars is worse than one
// that is plainly missing from the second.
export interface ProviderEventRepeat {
  // The rule as stored. Part of what a write is compared by.
  readonly line: string;
  // The rule as read, or null where the stored line is one this platform cannot itself read.
  readonly rule: RecurrenceRule | null;
  // Days the series does not fall on although its rule says so: each has an event of its own, or
  // was called off. Sorted.
  readonly skippedDays: readonly string[];
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

// One event in one of the member's calendars, whoever made it. A day of a series names the series
// it belongs to, which is how a caller tells a day of a series this platform wrote from one the
// member made themselves.
export interface ProviderCalendarEvent extends ProviderEventSnapshot {
  readonly seriesRemoteId: string | null;
}

// A calendar's events inside a window. `complete` is false when the provider had more than the
// adapter was willing to page through, in which case an event missing from the list proves nothing.
export interface ProviderCalendarEvents {
  readonly events: readonly ProviderCalendarEvent[];
  readonly complete: boolean;
}

// One day of a series this platform wrote, as the member changed it on its own without touching
// the rest. `originalStartsAtMilliseconds` is when that day began before they changed it, which
// is the only thing that says which day of the series it was once it has been moved.
export interface ProviderSeriesChangedDay extends ProviderEventSnapshot {
  readonly originalStartsAtMilliseconds: number;
}

// Two instants. An event that touches the time between them is inside.
export interface ProviderEventWindow {
  readonly fromInstant: string;
  readonly toInstant: string;
}

// A standing request that the provider say when anything in the member's calendar changes, so a
// change is picked up when it happens instead of at the next pass that happened to run. The notice
// carries nothing about the change: it only says "look again", and the look is the ordinary pass.
// A provider keeps a watch for a limited time; `expiresAt` is the instant it stops unless renewed.
export interface ProviderChangeWatch {
  readonly watchId: string;
  readonly expiresAt: string;
}

export interface ProviderChangeWatchRequest {
  // Where the provider sends its notices. A public https address of this deployment.
  readonly address: string;
  // Sent back with every notice. The receiver compares it and ignores a notice without it, which
  // is what tells the provider's notice from anybody else's request to the same address.
  readonly secret: string;
  // When the caller would like the watch to last until. The provider answers the instant it
  // gave, which may be sooner.
  readonly expiresAt: string;
}

// One notice as a provider sent it, read into the calendar's terms by that provider's own reader.
// `lifecycle` is present on a notice about the watch itself: `renew` when the provider wants the
// watch renewed before its time, `replace` when the watch is gone and a new one must be begun,
// `missed` when the provider admits it dropped notices. Absent on a notice that something changed.
export interface ProviderNotice {
  readonly secret: string;
  readonly lifecycle?: "renew" | "replace" | "missed";
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
  // Everything in one calendar inside a window: the member's own events and this platform's copies
  // alike, a series as one entry per day it falls on, an event called off left out. Null when the
  // account no longer has the calendar. Nothing is changed at the provider.
  listCalendarEvents(
    calendarRemoteId: string,
    window: ProviderEventWindow,
  ): Promise<Dispatch<ProviderCalendarEvents | null>>;
  // The days of one series the member changed on their own, each still part of the series. A day
  // they deleted is not among them: a provider's series does not say which days were taken out of
  // it by whom. Null when the provider no longer has the series.
  listSeriesChangedDays(
    seriesRemoteId: string,
  ): Promise<Dispatch<readonly ProviderSeriesChangedDay[] | null>>;
  // Writes one day of a series, by that day's own identifier, and leaves the series alone. Only
  // what a member can see is written: when, the title and the place.
  updateSeriesDay(
    dayRemoteId: string,
    event: ProviderEventWrite,
  ): Promise<Dispatch<ProviderEventPresence>>;
  // Begins a watch on the member's whole calendar account.
  watchChanges(request: ProviderChangeWatchRequest): Promise<Dispatch<ProviderChangeWatch>>;
  // Keeps a watch going until a later instant. Null when the provider no longer has the watch, in
  // which case the caller begins a new one.
  renewWatch(watchId: string, expiresAt: string): Promise<Dispatch<ProviderChangeWatch | null>>;
  // Ending a watch that is already gone succeeds.
  stopWatch(watchId: string): Promise<Dispatch<null>>;
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
  "listCalendarEvents",
  "listSeriesChangedDays",
  "updateSeriesDay",
  "watchChanges",
  "renewWatch",
  "stopWatch",
] as const;
export type CalendarSyncOperation = (typeof CALENDAR_SYNC_OPERATIONS)[number];
