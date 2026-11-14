/*
 * A colleague's room, read where the hover preload can reach it: whether the room is open is the
 * one thing the page needs before it can draw anything.
 */
import { meetingsReadRoomLinkOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  warm(meetingsReadRoomLinkOptions({ path: { linkCode: params.name } }));
};
