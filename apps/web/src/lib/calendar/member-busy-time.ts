/*
 * When a colleague is busy, from the calendars of their own Outlook or Google account they chose
 * to share as busy.
 *
 * HOURS ONLY. The server answers no title, place or calendar name, so there is nothing here to
 * paint but the word Busy. A colleague who shared nothing answers nothing, and the reader's own
 * member answers nothing either: they read their own events, titles and all, from their own row.
 *
 * Through the generated client; the bridge to the outcomes a read plan renders from is `outcomeOf`.
 */
import {
  calendarMemberBusyTime,
  type CalendarMemberBusyTime,
  type CalendarMemberBusyTimeList,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type MemberBusyTime = CalendarMemberBusyTime;

export async function readMemberBusyTime(
  memberUserId: string,
  window: { readonly from: string; readonly to: string },
  // The fetch the caller was handed, so this read travels with the rest of the caller's reads.
  fetchImpl?: typeof fetch,
): Promise<ApiOutcome<CalendarMemberBusyTimeList>> {
  try {
    const { data } = await calendarMemberBusyTime({
      path: { memberUserId },
      query: { from: window.from, to: window.to },
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}
