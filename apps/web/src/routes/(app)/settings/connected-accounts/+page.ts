/*
 * The member's connected accounts, started where the hover preload can reach it. One read: which
 * providers this workspace can connect, and which of the member's own accounts are connected.
 */
import { connectedAccountsListOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warm(connectedAccountsListOptions());
};
