/*
 * Which address-lookup engine a request gets.
 *
 * TWO ENGINES, COMPOSED BY COUNTRY. The platform's own index (the address worker, over a service
 * binding) answers the United States for nothing; Smarty, when its key pair is set, answers every
 * other country — and the United States too when the platform's index is not bound. Each is switched
 * on by provisioning it and off by removing it, the shape the conversion engines take with their
 * service bindings (conversions/conversion-engine.ts).
 *
 * ABSENT IS STILL A STATE THAT SHIPS. With neither provisioned, every request gets the deferred port,
 * which answers `engine-not-implemented` to everything, and the address form behaves exactly as it did
 * before autocomplete existed: a person types the address themselves.
 *
 * GOOGLE, WHEN ITS KEY IS SET, ANSWERS EVERY COUNTRY AND TAKES PRECEDENCE. The owner asked on
 * 2026-11-13 to try Google's addresses before deciding whether the platform's own index is needed, so
 * a set key routes every lookup to Google whatever else is provisioned; deleting the key hands the
 * lookups back to the others with nothing else changed.
 *
 * Smarty takes both secrets or neither. One without the other is a half-finished provisioning rather
 * than a request to call the service with a missing credential, so it counts as not provisioned.
 */
import {
  deferredAddressLookupPort,
  type AddressLookupPort,
} from "@magna-carta/address-lookup/port";
import {
  engineForCountry,
  engineForSuggestion,
  routedAddressLookupPort,
  type NamedAddressLookupPort,
  type RoutedAddressLookup,
} from "@magna-carta/address-lookup/routed";
import { googleAddressLookupPort } from "@magna-carta/address-lookup/google";
import { selfHostedAddressLookupPort } from "@magna-carta/address-lookup/self-hosted";
import { smartyAddressLookupPort } from "@magna-carta/address-lookup/smarty";
import type { Bindings } from "../bindings.ts";

/**
 * Which engine served a request — a metric dimension, so an operator can see what is live. The
 * platform's own engine is named for its data rather than for the worker, because the data is what
 * decides what it can answer.
 */
export type AddressLookupEngine = "google" | "openaddresses" | "smarty" | "deferred";

/** The only country the platform's own index covers. */
const SELF_HOSTED_COUNTRY = "US";

export interface ResolvedAddressLookup {
  readonly port: AddressLookupPort;
  /** The engine a suggestion for this country goes to. */
  engineForCountry(country: string): AddressLookupEngine;
  /** The engine that minted this identifier — the one a resolution goes to. */
  engineForSuggestion(suggestionId: string): AddressLookupEngine;
}

function engineNamed(engine: NamedAddressLookupPort | undefined): AddressLookupEngine {
  return engine?.name === "google" || engine?.name === "openaddresses" || engine?.name === "smarty"
    ? engine.name
    : "deferred";
}

export function resolveAddressLookupPort(
  env: Pick<
    Bindings,
    "ADDRESS_SERVICE" | "GOOGLE_PLACES_API_KEY" | "SMARTY_AUTH_ID" | "SMARTY_AUTH_TOKEN"
  >,
): ResolvedAddressLookup {
  const googleKey = env.GOOGLE_PLACES_API_KEY?.trim() ?? "";
  if (googleKey !== "") {
    const google: NamedAddressLookupPort = {
      name: "google",
      port: googleAddressLookupPort(googleKey),
    };
    const routes: RoutedAddressLookup = { byCountry: {}, otherwise: google };
    return {
      port: routedAddressLookupPort(routes),
      engineForCountry: () => "google",
      engineForSuggestion: (suggestionId) =>
        engineNamed(engineForSuggestion(routes, suggestionId)?.engine),
    };
  }

  const authenticationIdentifier = env.SMARTY_AUTH_ID?.trim() ?? "";
  const authenticationToken = env.SMARTY_AUTH_TOKEN?.trim() ?? "";
  const smarty: NamedAddressLookupPort | undefined =
    authenticationIdentifier === "" || authenticationToken === ""
      ? undefined
      : {
          name: "smarty",
          port: smartyAddressLookupPort({ authenticationIdentifier, authenticationToken }),
        };
  const selfHosted: NamedAddressLookupPort | undefined =
    env.ADDRESS_SERVICE === undefined
      ? undefined
      : { name: "openaddresses", port: selfHostedAddressLookupPort(env.ADDRESS_SERVICE) };

  if (smarty === undefined && selfHosted === undefined) {
    return {
      port: deferredAddressLookupPort(),
      engineForCountry: () => "deferred",
      engineForSuggestion: () => "deferred",
    };
  }

  const routes: RoutedAddressLookup = {
    byCountry: selfHosted === undefined ? {} : { [SELF_HOSTED_COUNTRY]: selfHosted },
    ...(smarty !== undefined && { otherwise: smarty }),
  };
  return {
    port: routedAddressLookupPort(routes),
    engineForCountry: (country) => engineNamed(engineForCountry(routes, country)),
    engineForSuggestion: (suggestionId) =>
      engineNamed(engineForSuggestion(routes, suggestionId)?.engine),
  };
}
