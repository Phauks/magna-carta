/*
 * The member's calendar sync settings, started where the hover preload can reach it. One read:
 * their account, its calendars, every event type with the firm's limit, and their own rules.
 * Beside it, the copies they changed in their own calendar and have not yet answered for.
 */
import {
  calendarSyncListMyIssuesOptions,
  calendarSyncReadMineOptions,
} from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warm(calendarSyncReadMineOptions());
  warm(calendarSyncListMyIssuesOptions());
};
