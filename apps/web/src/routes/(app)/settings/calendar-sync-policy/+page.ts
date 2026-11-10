/*
 * The firm's limit on calendar sync, started where the hover preload can reach it.
 */
import { calendarSyncReadFirmLimitsOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warm(calendarSyncReadFirmLimitsOptions());
};
