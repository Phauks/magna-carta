/*
 * A meeting by its nine-digit address. The code is resolved to the meeting first, warmed here where
 * the hover preload can reach it; the room then reads and joins the meeting by id like any other.
 *
 * `shell: "none"`, as the room at its other address: it has the whole window.
 */
import { meetingsGetByCodeOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import { parseMeetingCode } from "$lib/meetings/meeting-tab.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  const joinCode = parseMeetingCode(params.code);
  if (joinCode !== undefined) warm(meetingsGetByCodeOptions({ path: { joinCode } }));
  return { shell: "none" as const };
};
