/*
 * The postage account's state, started where the hover preload can reach it.
 *
 * One read: whether an account is connected and how healthy it is. Nothing about the credential is
 * read here or anywhere else — a stored key is write-only from the app's side, which is why this
 * page can offer to REPLACE one and never to show it.
 */
import { shippingReadConnectionOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warm(shippingReadConnectionOptions());
};
