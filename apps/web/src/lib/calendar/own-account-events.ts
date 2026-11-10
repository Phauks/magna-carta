/*
 * The reader's own events from their connected calendar account: the read, and whether there is
 * anything to read.
 *
 * ONLY EVER THE READER'S OWN. The server finds the account through the session and answers nobody
 * else's, so this takes no member and there is nothing here to point at a colleague.
 *
 * Through the generated client, like every read written since the transport module stopped
 * growing; the bridge to the three outcomes a calendar read plan renders from is `outcomeOf`.
 */
import {
  calendarSyncListMyAccountEvents,
  type CalendarSyncAccountEvent,
  type CalendarSyncAccountEventList,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type OwnAccountEvent = CalendarSyncAccountEvent;

export async function readOwnAccountEvents(window: {
  readonly from: string;
  readonly to: string;
}): Promise<ApiOutcome<CalendarSyncAccountEventList>> {
  try {
    const { data } = await calendarSyncListMyAccountEvents({
      query: { from: window.from, to: window.to },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/**
 * Whether the reader has chosen any of their own calendars to be shown, asked with a one-day
 * window so the answer costs a read of nothing. A failure reads as "no": a row that could be
 * turned on and paint nothing is the one thing the catalog refuses to list.
 */
export async function readHasOwnAccountCalendars(today: string): Promise<boolean> {
  const outcome = await readOwnAccountEvents({ from: today, to: today });
  return outcome.kind === "ok" && outcome.value.shownCalendars.length > 0;
}
