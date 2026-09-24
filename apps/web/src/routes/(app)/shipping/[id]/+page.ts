/*
 * A shipment's address.
 *
 * A shipment has no screen of its own: it opens in a window over the register, and from the register
 * that window is what the shipment's address names. This route survives so that a link written
 * anywhere else — a matter, a cost entry, an email — still lands on the shipment, by redirecting to
 * the register with its window open.
 *
 * The same shape as a directory record's former address ((app)/directory/[id]/+page.ts), for the same
 * reason: a record opened in place needs no way back, and the reader who followed a link to one still
 * needs an address that resolves.
 *
 * The handle's own prefix says whether it could name a shipment at all; anything else is a 404 inside
 * the app chrome rather than a register opening a window on nothing.
 */
import { error, redirect } from "@sveltejs/kit";
import { shipmentWindowHref } from "$lib/shipping/shipment-window-href.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  if (!params.id.startsWith("shipment_")) error(404, "Not Found");
  redirect(307, shipmentWindowHref(params.id));
};
