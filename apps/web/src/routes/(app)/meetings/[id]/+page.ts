/*
 * The meeting's own read, started where the hover preload can reach it.
 *
 * One read: the meeting's summary, which carries the event's title and time, the meeting's standing
 * and whether this deployment has meetings configured at all. Nothing is awaited — `warm` fires and
 * the screen reads the same question back out of the cache, whichever of the two got there first.
 *
 * The JOIN is not warmed and must not be: it is a write that opens an attendance row, and a hover
 * over a link is not somebody arriving in a room.
 *
 * `shell: "none"`: the room opens in a tab of its own (`$lib/meetings/meeting-tab.ts`) and has the
 * whole window, with no rail and no top bar, the way the document editor does.
 */
import { meetingsGetOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  warm(meetingsGetOptions({ path: { meetingId: params.id } }));
  return { shell: "none" as const };
};
