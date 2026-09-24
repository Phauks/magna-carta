/*
 * The register's connection read, started where the hover preload can reach it.
 *
 * `data-sveltekit-preload-data="hover"` (app.html) runs this when the pointer settles on the rail's
 * Shipping row, so the answer to "is an account connected" is usually in the cache before the click
 * lands. That matters more than it looks: the register says something different when no account is
 * connected, and a read that started on mount would make the screen change its mind in front of the
 * reader a moment after they arrived.
 *
 * The shipments themselves are read by the screen's paged list rather than warmed here — it holds a
 * cursor and accumulates pages, which is a different mechanism from a cached single answer.
 */
import { shippingReadConnectionOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warm(shippingReadConnectionOptions());
};
