/*
 * Which address-lookup engine a request gets.
 *
 * ABSENT IS THE SHIPPED STATE. With no Smarty credentials provisioned, every request gets the deferred
 * port, which answers `engine-not-implemented` to everything, and the address form behaves exactly as
 * it did before autocomplete existed: a person types the address themselves. Provisioning the two
 * secrets is the whole of switching it on, and removing either switches it off again — the same
 * shape the conversion engines take with their service bindings (conversions/conversion-engine.ts).
 *
 * Both secrets or neither. One without the other is a half-finished provisioning rather than a
 * request to call the service with a missing credential, so it resolves to the deferred port too.
 */
import {
  deferredAddressLookupPort,
  type AddressLookupPort,
} from "@magna-carta/address-lookup/port";
import { smartyAddressLookupPort } from "@magna-carta/address-lookup/smarty";
import type { Bindings } from "../app.ts";

/** Which engine served a request — a metric dimension, so an operator can see what is live. */
export type AddressLookupEngine = "smarty" | "deferred";

export interface ResolvedAddressLookup {
  readonly port: AddressLookupPort;
  readonly engine: AddressLookupEngine;
}

export function resolveAddressLookupPort(
  env: Pick<Bindings, "SMARTY_AUTH_ID" | "SMARTY_AUTH_TOKEN">,
): ResolvedAddressLookup {
  const authenticationIdentifier = env.SMARTY_AUTH_ID?.trim() ?? "";
  const authenticationToken = env.SMARTY_AUTH_TOKEN?.trim() ?? "";
  if (authenticationIdentifier === "" || authenticationToken === "") {
    return { port: deferredAddressLookupPort(), engine: "deferred" };
  }
  return {
    port: smartyAddressLookupPort({ authenticationIdentifier, authenticationToken }),
    engine: "smarty",
  };
}
