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

export interface CalendarSyncPort {
  listCalendars(): Promise<Dispatch<readonly ProviderCalendar[]>>;
}

// The operation names an adapter's capability descriptor declares, so a caller can ask what an
// adapter supports before calling it.
export const CALENDAR_SYNC_CATEGORY = "calendar-sync";
export const CALENDAR_SYNC_OPERATIONS = ["listCalendars"] as const;
export type CalendarSyncOperation = (typeof CALENDAR_SYNC_OPERATIONS)[number];
