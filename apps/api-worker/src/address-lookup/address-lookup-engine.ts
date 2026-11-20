/*
 * Which address-lookup engine a request gets.
 *
 * ONE ENGINE: GOOGLE. Google Places answers every country while its key is set. The owner chose it
 * as the only engine on 2026-11-20, after trying it from 2026-11-13; the platform's own US index and
 * the Smarty adapter that stood beside it were removed then.
 *
 * ABSENT IS STILL A STATE THAT SHIPS. Without the key every request gets the deferred port, which
 * answers `engine-not-implemented` to everything, and the address form behaves exactly as it did
 * before autocomplete existed: a person types the address themselves.
 */
import {
  deferredAddressLookupPort,
  type AddressLookupPort,
} from "@magna-carta/address-lookup/port";
import { googleAddressLookupPort } from "@magna-carta/address-lookup/google";
import type { Bindings } from "../bindings.ts";

/** Which engine served a request: a metric dimension, so an operator can see what is live. */
export type AddressLookupEngine = "google" | "deferred";

export interface ResolvedAddressLookup {
  readonly port: AddressLookupPort;
  readonly engine: AddressLookupEngine;
}

export function resolveAddressLookupPort(
  env: Pick<Bindings, "GOOGLE_PLACES_API_KEY">,
): ResolvedAddressLookup {
  const googleKey = env.GOOGLE_PLACES_API_KEY?.trim() ?? "";
  return googleKey === ""
    ? { port: deferredAddressLookupPort(), engine: "deferred" }
    : { port: googleAddressLookupPort(googleKey), engine: "google" };
}
